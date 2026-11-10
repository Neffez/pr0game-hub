import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { memberPlayers } from './members.js';
import { finalizedSettlements, memberKey } from './settlements.js';
import { latestScores } from './stats.js';

/**
 * Alliance health, for every member of the group: per member the points and their growth over a week against the alliance median,
 * the last sync of each page type, when they were last in the hub, raids and expeditions of the week and open loot
 * deliveries, with flags for who falls behind or no longer syncs. The last hub visit follows the member's online
 * setting (like the player page): hidden from the others unless the viewer is an admin.
 */

/** Growth and activity are counted over this time. */
export const HEALTH_WINDOW = 7 * 86400;
/** With an empire page (or a hub visit) older than this a member is flagged. */
export const STALE = 3 * 86400;
/** Growth below this share of the alliance median counts as falling behind. */
export const BEHIND = 0.5;

export type HealthFlag = 'behind' | 'noEmpire' | 'staleEmpire' | 'noStats' | 'away';

export interface MemberHealth {
  userId: number;
  name: string;
  role: string;
  /** last request in the hub (page open), null when never or hidden */
  lastSeen: number | null;
  /** the member hides their online status from the viewer (no last visit, no `away` flag) */
  onlineHidden: boolean;
  player: { id: number; name: string } | null;
  points: number | null;
  rank: number | null;
  /** total points gained over the window (from the newest update at or before its start; `partial` when the history is shorter) */
  growth: number | null;
  partial: boolean;
  /** newest sync per page type (empire, overview, fleets, buildings, research, galaxy, stats, messages, …) */
  syncs: Record<string, number>;
  /** battle reports and expeditions the member synced within the window, with the loot of the reports */
  battles: number;
  loot: number;
  expeditions: number;
  /** deliveries of finalized loot settlements the member still has to send */
  openDeliveries: number;
  flags: HealthFlag[];
}

export function allianceHealth(db: DB, ctx: GroupContext): { members: MemberHealth[]; medianGrowth: number | null; window: number } {
  const t = ctx.now;
  const since = t - HEALTH_WINDOW;
  const rows = db
    .prepare(
      `SELECT m.user_id, COALESCE(m.ingame_name, u.username) AS name, m.role, m.last_seen_at, u.show_online FROM group_members m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ? ORDER BY name COLLATE NOCASE`,
    )
    .all(ctx.groupId) as { user_id: number; name: string; role: string; last_seen_at: number | null; show_online: number }[];
  // admins see every last visit, the others only those of members who show their online status
  const privileged = ctx.user.isAdmin || ctx.role === 'admin';
  const players = memberPlayers(db, ctx);
  const ids = [...new Set([...players.values()].filter((id): id is number => id != null))];
  const scores = latestScores(db, ctx.groupId, ids, [1]);
  const names = new Map(
    ids.length ? (db.prepare('SELECT id, name FROM players WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as { id: number; name: string }[]).map((r) => [r.id, r.name]) : [],
  );
  // total points at the start of the window: the newest update at or before it, else the oldest after it
  const before = db.prepare('SELECT points FROM player_scores WHERE player_id = ? AND type = 1 AND stat_time <= ? ORDER BY stat_time DESC LIMIT 1').pluck();
  const oldest = db.prepare('SELECT points FROM player_scores WHERE player_id = ? AND type = 1 AND stat_time > ? ORDER BY stat_time LIMIT 1').pluck();

  // newest sync per member and page type: kept pages (14 days) and the snapshot tables (all of the time)
  const syncs = new Map<number, Record<string, number>>();
  const put = (userId: number | null, type: string, time: number | null) => {
    if (userId == null || time == null) return;
    const s = syncs.get(userId) ?? {};
    s[type] = Math.max(s[type] ?? 0, time);
    syncs.set(userId, s);
  };
  const grouped = (sql: string, type: string | null) => {
    for (const r of db.prepare(sql).all(ctx.groupId) as { user_id: number | null; type?: string; time: number }[]) put(r.user_id, type ?? r.type!, r.time);
  };
  grouped("SELECT user_id, page_type AS type, MAX(created_at) AS time FROM raw_ingests WHERE group_id = ? AND page_type <> 'unknown' GROUP BY user_id, page_type", null);
  grouped('SELECT user_id, MAX(created_at) AS time FROM empire_snapshots WHERE group_id = ? GROUP BY user_id', 'empire');
  grouped('SELECT user_id, MAX(page_time) AS time FROM overview_snapshots WHERE group_id = ? GROUP BY user_id', 'overview');
  grouped('SELECT user_id, MAX(page_time) AS time FROM fleet_snapshots WHERE group_id = ? GROUP BY user_id', 'fleets');
  grouped('SELECT user_id, MAX(page_time) AS time FROM building_snapshots WHERE group_id = ? GROUP BY user_id', 'buildings');
  grouped('SELECT user_id, MAX(page_time) AS time FROM research_snapshots WHERE group_id = ? GROUP BY user_id', 'research');
  grouped('SELECT user_id, MAX(seen_at) AS time FROM galaxy_views WHERE group_id = ? GROUP BY user_id', 'galaxy');

  const counts = (sql: string) =>
    new Map((db.prepare(sql).all(ctx.groupId, since) as { user_id: number; n: number; loot?: number }[]).map((r) => [r.user_id, r]));
  const battles = counts(
    `SELECT user_id, COUNT(*) AS n, SUM(loot_metal + loot_crystal + loot_deuterium) AS loot FROM battle_reports
     WHERE group_id = ? AND COALESCE(time, created_at) >= ? AND user_id IS NOT NULL GROUP BY user_id`,
  );
  const expeditions = counts('SELECT user_id, COUNT(*) AS n FROM expeditions WHERE group_id = ? AND COALESCE(time, created_at) >= ? AND user_id IS NOT NULL GROUP BY user_id');

  const open = new Map<number, number>();
  for (const f of finalizedSettlements(db, ctx, t).values()) {
    for (const d of f.deliveries) {
      if (d.done) continue;
      const id = rows.find((r) => memberKey(r.user_id) === d.from)?.user_id;
      if (id != null) open.set(id, (open.get(id) ?? 0) + 1);
    }
  }

  const members: MemberHealth[] = rows.map((r) => {
    const playerId = players.get(r.user_id) ?? null;
    const score = playerId != null ? scores.get(playerId)?.[1] : undefined;
    let growth: number | null = null;
    let partial = false;
    if (playerId != null && score) {
      const start = (before.get(playerId, since) as number | undefined) ?? (oldest.get(playerId, since) as number | undefined);
      partial = before.get(playerId, since) == null;
      if (start != null) growth = score.points - start;
    }
    const onlineHidden = !privileged && r.user_id !== ctx.user.id && !r.show_online;
    return {
      userId: r.user_id, name: r.name, role: r.role, lastSeen: onlineHidden ? null : r.last_seen_at, onlineHidden,
      player: playerId != null ? { id: playerId, name: names.get(playerId) ?? r.name } : null,
      points: score?.points ?? null, rank: score?.rank ?? null, growth, partial,
      syncs: syncs.get(r.user_id) ?? {},
      battles: battles.get(r.user_id)?.n ?? 0, loot: battles.get(r.user_id)?.loot ?? 0, expeditions: expeditions.get(r.user_id)?.n ?? 0,
      openDeliveries: open.get(r.user_id) ?? 0, flags: [],
    };
  });
  const growths = members.map((m) => m.growth).filter((g): g is number => g != null).sort((a, b) => a - b);
  const medianGrowth = growths.length ? (growths.length % 2 ? growths[(growths.length - 1) / 2] : (growths[growths.length / 2 - 1] + growths[growths.length / 2]) / 2) : null;
  for (const m of members) {
    if (medianGrowth != null && medianGrowth > 0 && m.growth != null && m.growth < medianGrowth * BEHIND) m.flags.push('behind');
    // never pasted, or pasted but outdated: two flags, "no empire" next to an age would contradict it
    if (m.syncs.empire == null) m.flags.push('noEmpire');
    else if (m.syncs.empire < t - STALE) m.flags.push('staleEmpire');
    if (m.points == null) m.flags.push('noStats');
    if (!m.onlineHidden && (m.lastSeen ?? 0) < t - STALE) m.flags.push('away');
  }
  return { members, medianGrowth, window: HEALTH_WINDOW };
}
