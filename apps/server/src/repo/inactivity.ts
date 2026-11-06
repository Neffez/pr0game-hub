import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { pointsStalls, stallSince, type PointsStall } from './stats.js';

/**
 * How sure the hub is that a player is inactive, before the game flags them (its flag comes after 7 days): one score
 * from the signals the hub already has.
 * - the game's own flag (`inactive` after 7, `longinactive` after 28 days without login),
 * - no gain in total points across synced statistics updates (points only grow by spending resources),
 * - activity seen after the last points gain (galaxy activity marks, fleet launches and recalls, reports by hand,
 *   espionage on members) speaks against it.
 */
export interface Inactivity {
  /** 0 (active) … 100 (inactive for sure) */
  score: number;
  level: 'inactive' | 'likely' | 'possible' | 'active' | 'unknown';
  /** probably inactive since (the game's flag, else the statistics update of the last points gain) */
  since: number | null;
  /** `since` is the oldest update the hub knows: the player may have stopped earlier */
  atLeast: boolean;
  /** the signals: the game's flag, the update of the last points gain, the newest activity the hub has seen */
  status: 'inactive' | 'longinactive' | null;
  stall: number | null;
  lastActive: number | null;
}

const HOUR = 3600;
/** A points stall this long counts as nearly sure (3 days: no build, research, ship or defense at all). */
const STALL_SURE = 72 * HOUR;
const STALL_MAX_SCORE = 85;
/** Activity seen after the last gain: at most this much is left of the stall. */
const ACTIVE_CAP = 15;

export const inactivityLevel = (score: number): Inactivity['level'] =>
  score >= 85 ? 'inactive' : score >= 50 ? 'likely' : score >= 20 ? 'possible' : 'active';

/** Score from the signals (pure, for tests and the routes). */
export function inactivityOf(s: {
  status: string[];
  inactiveSince: number | null;
  stall: PointsStall | null;
  /** newest synced total points update; null without statistics */
  newest: number | null;
  /** the player is in the newest statistics */
  inStats: boolean;
  lastActive: number | null;
}): Inactivity {
  const base = { stall: s.stall?.time ?? null, lastActive: s.lastActive, atLeast: false };
  const flag = s.status.includes('longinactive') ? 'longinactive' : s.status.includes('inactive') ? 'inactive' : null;
  if (flag) {
    return { ...base, score: flag === 'longinactive' ? 100 : 95, level: 'inactive', status: flag, since: s.inactiveSince ?? s.stall?.time ?? null, atLeast: s.inactiveSince == null && !!s.stall?.atLeast };
  }
  if (s.newest == null || !s.inStats) return { ...base, score: 0, level: 'unknown', status: null, since: null };
  if (!s.stall) return { ...base, score: 0, level: 'active', status: null, since: null };
  let score = Math.round(Math.min(1, (s.newest - s.stall.time) / STALL_SURE) * STALL_MAX_SCORE);
  if (s.lastActive != null && s.lastActive > s.stall.time) score = Math.min(score, ACTIVE_CAP);
  const level = inactivityLevel(score);
  return { ...base, score, level, status: null, since: level === 'active' ? null : s.stall.time, atLeast: level !== 'active' && s.stall.atLeast };
}

/** Inactivity of the group's players (all, or `playerIds`): player id → score and signals. */
export function inactivities(db: DB, ctx: GroupContext, playerIds?: number[]): Map<number, Inactivity> {
  const g = ctx.groupId;
  const only = playerIds ? JSON.stringify(playerIds) : null;
  const newest = db.prepare("SELECT MAX(stat_time) FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = 1").pluck().get(g) as number | null;
  const stalls = newest == null ? new Map<number, PointsStall>() : pointsStalls(db, g, { since: stallSince(ctx, newest), playerIds });
  const players = db
    .prepare(
      `SELECT p.id, p.name, p.status,
         (SELECT MIN(seen_at) FROM player_status_log l WHERE l.player_id = p.id AND l.status LIKE '%inactive%'
            AND l.seen_at >= COALESCE((SELECT MAX(seen_at) FROM player_status_log l2 WHERE l2.player_id = p.id AND l2.status NOT LIKE '%inactive%'), 0)
         ) AS inactive_since,
         (SELECT MAX(time) FROM player_activity a WHERE a.player_id = p.id AND a.source != 'offline') AS active,
         ${newest == null ? 'NULL' : '(SELECT MAX(stat_time) FROM player_scores ps WHERE ps.player_id = p.id AND ps.type = 1)'} AS stat
       FROM players p WHERE p.group_id = ? AND (? IS NULL OR p.id IN (SELECT value FROM json_each(?)))`,
    )
    .all(g, only, only ?? '[]') as { id: number; name: string; status: string; inactive_since: number | null; active: number | null; stat: number | null }[];
  // espionage on members: by name (the reports carry no player id)
  const spied = new Map(
    (db
      .prepare('SELECT lower(from_player) AS name, MAX(time) AS time FROM hostile_spying WHERE group_id = ? AND time IS NOT NULL GROUP BY lower(from_player)')
      .all(g) as { name: string; time: number }[]).map((r) => [r.name, r.time]),
  );
  const out = new Map<number, Inactivity>();
  for (const p of players) {
    const spy = spied.get(p.name.toLowerCase()) ?? null;
    out.set(
      p.id,
      inactivityOf({
        status: JSON.parse(p.status || '[]'),
        inactiveSince: p.inactive_since,
        stall: stalls.get(p.id) ?? null,
        newest,
        // the player's newest score belongs to the newest update (not dropped from the ranking)
        inStats: newest != null && p.stat != null && p.stat >= newest - 6 * HOUR,
        lastActive: Math.max(p.active ?? 0, spy ?? 0) || null,
      }),
    );
  }
  return out;
}
