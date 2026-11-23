import type { EmpireRecord } from '@pr0hub/core';
import { CLASS_FLEET, classOf, elementPoints } from '@pr0hub/core/tech';
import { withUnits } from '@pr0hub/core/units';
import { catalogOf, type GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { ownCoords } from './empire.js';
import { alliance, memberPlayers } from './members.js';
import { latestScores } from './stats.js';

/**
 * The dynamic rank badge: ten conditions, each held by the member(s) leading it among the group's members (all who
 * tie get it). Every held condition is one point; the points (0–10) are the rank, shown like a military rank before
 * the other badges. Read from the group's tables over the whole history (no stored state), so a rank moves as soon
 * as someone overtakes.
 */

export const RANK_CONDITIONS = [
  /** most fleet points: the newer of the fleet statistics and the empire page (ships on the planets and in flight) */
  'fleetPoints',
  /** most research points */
  'researchPoints',
  /** most building points */
  'buildingPoints',
  /** most total points */
  'totalPoints',
  /** most units destroyed (resource value) in the member's battle reports */
  'unitsDestroyed',
  /** most resources gained: loot of the member's attacks plus recycled debris */
  'resources',
  /** most units lost (a consolation rank) */
  'unitsLost',
  /** longest win streak: wins where the opponent lost units, broken by a defeat against someone outside the alliance */
  'winStreak',
  /** best ratio of resources gained to units lost (gained / max(lost, 1)) */
  'profitRatio',
  /** most different players attacked (outside the own alliance) */
  'playersAttacked',
] as const;
export type RankCondition = (typeof RANK_CONDITIONS)[number];

export interface MemberRank {
  /** held conditions = rank level, 0–10 */
  points: number;
  /** the conditions the member holds */
  holds: RankCondition[];
  /** the member's value of every condition (ratio rounded to two decimals) */
  values: Record<RankCondition, number>;
  /** where the fleet points come from: the statistics, the member's empire page, null for neither */
  fleetSource: 'stats' | 'empire' | null;
}

/** Ship points of an empire page (on the planets and in flight); `complete` false for an older page without the ships in flight. */
export function empireFleetPoints(ctx: GroupContext, e: EmpireRecord): { points: number; complete: boolean } {
  return withUnits(catalogOf(ctx.universe), () => {
    let points = 0;
    for (const pl of e.planets) for (const [id, n] of Object.entries(pl.values)) if (classOf(Number(id)) === CLASS_FLEET) points += elementPoints(id, n);
    for (const [id, n] of Object.entries(e.flyingShips ?? {})) points += elementPoints(id, n);
    return { points: Math.round(points), complete: e.flyingShips != null };
  });
}

/** Statistics categories of the point conditions. */
const STAT_TYPE: Partial<Record<RankCondition, number>> = { totalPoints: 1, fleetPoints: 2, researchPoints: 3, buildingPoints: 4 };

interface BattleRow {
  user_id: number;
  t: number;
  g: number;
  s: number;
  p: number;
  outcome: string | null;
  lost_attacker: number;
  lost_defender: number;
  loot: number;
  report_id: string | null;
}

/**
 * Ranks of every member as they were at the end of each instant in `ends` (Unix seconds, exclusive): statistics
 * updates before it, battle and recycling reports synced before it. userId → rank, per end.
 */
export function ranksAt(db: DB, ctx: GroupContext, userIds: number[], ends: number[]): Map<number, Map<number, MemberRank>> {
  const g = ctx.groupId;
  const players = memberPlayers(db, ctx);
  const own = ownCoords(db, ctx);
  const side = alliance(db, ctx);
  const last = Math.max(...ends);

  const battles = db
    .prepare(
      `SELECT user_id, created_at AS t, g, s, p, outcome, lost_attacker, lost_defender, loot_metal + loot_crystal + loot_deuterium AS loot, report_id
       FROM battle_reports WHERE group_id = ? AND user_id IS NOT NULL AND created_at < ? ORDER BY COALESCE(time, created_at), id`,
    )
    .all(g, last) as BattleRow[];
  const recycled = db
    .prepare('SELECT user_id, created_at AS t, metal + crystal AS n FROM recycle_reports WHERE group_id = ? AND user_id IS NOT NULL AND created_at < ?')
    .all(g, last) as { user_id: number; t: number; n: number }[];
  // owners of attacked planets (current owner) and the attackers of archived battles (by name)
  const ownerOf = db.prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND player_id IS NOT NULL').pluck();
  const attackersOf = db
    .prepare("SELECT json_extract(f.value, '$[1]') FROM combat_reports c, json_each(c.fleets) f WHERE c.group_id = ? AND c.report_id = ? AND json_extract(f.value, '$[0]') = 0")
    .pluck();
  const sideIds = new Set(
    db
      .prepare('SELECT id FROM players WHERE group_id = ? AND name COLLATE NOCASE IN (SELECT value FROM json_each(?))')
      .pluck()
      .all(g, JSON.stringify([...side.names])) as number[],
  );
  for (const id of players.values()) if (id != null) sideIds.add(id);

  const empireAt = db.prepare(
    'SELECT created_at AS time, data FROM empire_snapshots WHERE group_id = ? AND user_id = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT 1',
  );

  const out = new Map<number, Map<number, MemberRank>>();
  for (const end of ends) {
    const values = new Map<number, Record<RankCondition, number>>(userIds.map((u) => [u, Object.fromEntries(RANK_CONDITIONS.map((k) => [k, 0])) as Record<RankCondition, number>]));
    const gained = new Map<number, number>();
    const attacked = new Map<number, Set<number>>();
    const streak = new Map<number, { n: number; best: number }>();

    const ids = userIds.map((u) => players.get(u)).filter((x): x is number => x != null);
    const scores = latestScores(db, g, ids, [1, 2, 3, 4], end);
    const sources = new Map<number, MemberRank['fleetSource']>();
    for (const u of userIds) {
      const pid = players.get(u);
      const score = pid == null ? undefined : scores.get(pid);
      for (const [k, type] of Object.entries(STAT_TYPE)) values.get(u)![k as RankCondition] = score?.[type!]?.points ?? 0;
      // fleet: the member's newest empire page when it is newer than the fleet statistics (they need espionage 6 and
      // come only every few hours); a page without the ships in flight only when there are no statistics at all
      const stat = score?.[2];
      const page = empireAt.get(g, u, end) as { time: number; data: string } | undefined;
      const fleet = page ? empireFleetPoints(ctx, JSON.parse(page.data) as EmpireRecord) : null;
      if (page && fleet && (stat ? fleet.complete && page.time > stat.time : true)) {
        values.get(u)!.fleetPoints = fleet.points;
        sources.set(u, 'empire');
      } else sources.set(u, stat ? 'stats' : null);
    }

    for (const b of battles) {
      const v = values.get(b.user_id);
      if (!v || b.t >= end) continue;
      const defense = own.get(b.user_id)?.has(`${b.g}:${b.s}:${b.p}`) ?? false;
      const lost = defense ? b.lost_defender : b.lost_attacker;
      const destroyed = defense ? b.lost_attacker : b.lost_defender;
      v.unitsDestroyed += destroyed;
      v.unitsLost += lost;
      /** the opponent is known to be of the own alliance */
      let friendly = false;
      if (!defense) {
        gained.set(b.user_id, (gained.get(b.user_id) ?? 0) + b.loot);
        const target = ownerOf.get(g, b.g, b.s, b.p) as number | undefined;
        if (target != null) {
          friendly = sideIds.has(target);
          if (!sideIds.has(target)) {
            let set = attacked.get(b.user_id);
            if (!set) attacked.set(b.user_id, (set = new Set()));
            set.add(target);
          }
        }
      } else if (b.report_id) {
        const names = (attackersOf.all(g, b.report_id) as string[]).map((n) => n.toLowerCase());
        friendly = names.length > 0 && names.every((n) => side.names.has(n));
      }
      // win streak: a win counts when the opponent lost units; a defeat breaks it unless the opponent is known to be
      // of the own alliance; draws and battles without an outcome are neutral
      const st = streak.get(b.user_id) ?? { n: 0, best: 0 };
      if (b.outcome === 'win' && destroyed > 0) st.best = Math.max(st.best, ++st.n);
      else if (b.outcome === 'lose' && !friendly) st.n = 0;
      streak.set(b.user_id, st);
    }
    for (const r of recycled) if (r.t < end && values.has(r.user_id)) gained.set(r.user_id, (gained.get(r.user_id) ?? 0) + r.n);

    for (const [u, v] of values) {
      const gain = gained.get(u) ?? 0;
      v.resources = gain;
      v.profitRatio = Math.round((gain / Math.max(v.unitsLost, 1)) * 100) / 100;
      v.winStreak = streak.get(u)?.best ?? 0;
      v.playersAttacked = attacked.get(u)?.size ?? 0;
    }

    // each condition goes to everyone with the highest value above 0
    const holds = new Map<number, RankCondition[]>(userIds.map((u) => [u, []]));
    for (const k of RANK_CONDITIONS) {
      const top = Math.max(0, ...[...values.values()].map((v) => v[k]));
      if (top <= 0) continue;
      for (const [u, v] of values) if (v[k] === top) holds.get(u)!.push(k);
    }
    out.set(end, new Map(userIds.map((u) => [u, { points: holds.get(u)!.length, holds: holds.get(u)!, values: values.get(u)!, fleetSource: sources.get(u) ?? null }])));
  }
  return out;
}
