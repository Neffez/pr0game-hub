import type { EmpireRecord } from '@pr0hub/core';
import { CLASS_FLEET, classOf, costOf, elementPoints } from '@pr0hub/core/tech';
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
 * as someone overtakes; `profitRatio` looks only at the last `PROFIT_WINDOW` before each instant.
 */

/** The window of `profitRatio` (seconds): one perfect battle must not hold it forever. */
export const PROFIT_WINDOW = 30 * 86_400;

export const RANK_CONDITIONS = [
  /** most fleet points: the newer of the fleet statistics and the empire page (ships on the planets and in flight) */
  'fleetPoints',
  /** most research points */
  'researchPoints',
  /** most building points */
  'buildingPoints',
  /** most total points */
  'totalPoints',
  /**
   * most units destroyed by the member's own fleets ("real" on the game's player card): the newest synced player card
   * plus the battle reports after it, without a card the battle reports alone (in an ACS a share, see `realUnits`)
   */
  'unitsDestroyed',
  /** most resources gained: loot of the member's attacks plus recycled debris */
  'resources',
  /** most units lost by the member's own fleets (like `unitsDestroyed`) */
  'unitsLost',
  /** longest win streak: wins where the opponent lost units, broken by a defeat against someone outside the alliance */
  'winStreak',
  /** best ratio of resources gained to units lost in the last 30 days (gained / max(lost, 1), see `PROFIT_WINDOW`) */
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
  /** units destroyed and lost: the time of the player card they start from (battle reports after it added), null for battle reports only */
  combatCard: number | null;
}

/** A fleet of a stored combat report: side (0 attacker, 1 defender), name, ships [element, before, after]. */
type CombatFleet = [number, string, [number, number, number][], unknown?];

/**
 * Units (metal + crystal, like the game) the member's own fleets destroyed and lost in a battle of a stored combat
 * report: the losses of the fleets under the member's names, the opponents' losses (`enemyLost`, from the battle
 * message) in the share of the member's fleets in the value of their side. Null when no fleet of the member's side
 * carries one of the names.
 */
export function realUnits(fleets: CombatFleet[], side: 0 | 1, names: Set<string>, enemyLost: number): { destroyed: number; lost: number } | null {
  const value = (id: number, n: number) => {
    const c = costOf(id);
    return c ? (c[0] + c[1]) * n : 0;
  };
  const mine = fleets.filter((f) => f[0] === side && names.has(f[1].toLowerCase()));
  if (!mine.length) return null;
  const start = (list: CombatFleet[]) => list.reduce((s, f) => s + f[2].reduce((x, [id, before]) => x + value(id, before), 0), 0);
  const lost = mine.reduce((s, f) => s + f[2].reduce((x, [id, before, after]) => x + value(id, Math.max(0, before - after)), 0), 0);
  const all = start(fleets.filter((f) => f[0] === side));
  const share = all > 0 ? start(mine) / all : 1;
  return { destroyed: Math.round(enemyLost * share), lost: Math.round(lost) };
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
  /** when the battle took place (the sync time without one) */
  at: number;
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
      `SELECT user_id, created_at AS t, COALESCE(time, created_at) AS at, g, s, p, outcome, lost_attacker, lost_defender, loot_metal + loot_crystal + loot_deuterium AS loot, report_id
       FROM battle_reports WHERE group_id = ? AND user_id IS NOT NULL AND created_at < ? AND p <= ? ORDER BY COALESCE(time, created_at), id`,
    )
    // fights on expeditions (pirates, aliens: the position behind the last planet) do not count, like in the game
    .all(g, last, ctx.universe.settings.positions) as BattleRow[];
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

  // units destroyed and lost: the member's newest player card, their names in combat reports
  const cardAt = db.prepare(
    'SELECT seen_at, real_destroyed, real_lost FROM player_combat_stats WHERE group_id = ? AND player_id = ? AND seen_at < ? ORDER BY seen_at DESC LIMIT 1',
  );
  const fleetsOf = db.prepare('SELECT fleets FROM combat_reports WHERE group_id = ? AND report_id = ?').pluck();
  const names = new Map<number, Set<string>>();
  for (const r of db
    .prepare('SELECT m.user_id, m.ingame_name, u.username FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
    .all(g) as { user_id: number; ingame_name: string | null; username: string }[]) {
    const pid = players.get(r.user_id);
    const player = pid == null ? undefined : (db.prepare('SELECT name FROM players WHERE id = ?').pluck().get(pid) as string | undefined);
    names.set(r.user_id, new Set([player, r.ingame_name, r.username].filter((n): n is string => !!n).map((n) => n.toLowerCase())));
  }
  const fleetCache = new Map<string, CombatFleet[] | null>();
  const reportFleets = (id: string) => {
    if (!fleetCache.has(id)) {
      const json = fleetsOf.get(g, id) as string | undefined;
      fleetCache.set(id, json ? (JSON.parse(json) as CombatFleet[]) : null);
    }
    return fleetCache.get(id)!;
  };
  const catalog = catalogOf(ctx.universe);

  const empireAt = db.prepare(
    'SELECT created_at AS time, data FROM empire_snapshots WHERE group_id = ? AND user_id = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT 1',
  );

  const out = new Map<number, Map<number, MemberRank>>();
  for (const end of ends) {
    const values = new Map<number, Record<RankCondition, number>>(userIds.map((u) => [u, Object.fromEntries(RANK_CONDITIONS.map((k) => [k, 0])) as Record<RankCondition, number>]));
    const gained = new Map<number, number>();
    /** resources gained and units lost within the profit window */
    const recent = new Map<number, { gained: number; lost: number }>();
    const since = end - PROFIT_WINDOW;
    const recentOf = (u: number) => {
      let r = recent.get(u);
      if (!r) recent.set(u, (r = { gained: 0, lost: 0 }));
      return r;
    };
    const attacked = new Map<number, Set<number>>();
    const streak = new Map<number, { n: number; best: number }>();

    const ids = userIds.map((u) => players.get(u)).filter((x): x is number => x != null);
    const scores = latestScores(db, g, ids, [1, 2, 3, 4], end);
    const sources = new Map<number, MemberRank['fleetSource']>();
    const cards = new Map<number, number>();
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
      // units: the newest player card ("real" block) as the start, the battles after it added below
      const card = pid == null ? undefined : (cardAt.get(g, pid, end) as { seen_at: number; real_destroyed: number; real_lost: number } | undefined);
      if (card) {
        values.get(u)!.unitsDestroyed = card.real_destroyed;
        values.get(u)!.unitsLost = card.real_lost;
        cards.set(u, card.seen_at);
      }
    }

    for (const b of battles) {
      const v = values.get(b.user_id);
      if (!v || b.t >= end) continue;
      const defense = own.get(b.user_id)?.has(`${b.g}:${b.s}:${b.p}`) ?? false;
      const lost = defense ? b.lost_defender : b.lost_attacker;
      const destroyed = defense ? b.lost_attacker : b.lost_defender;
      // what the member's own fleets destroyed and lost: from the combat report when stored (an ACS shares the side),
      // else the side of the battle message; battles before the player card are in it already
      const card = cards.get(b.user_id);
      const inWindow = b.at >= since;
      if (card == null || b.at > card || inWindow) {
        const fleets = b.report_id ? reportFleets(b.report_id) : null;
        const real = fleets ? withUnits(catalog, () => realUnits(fleets, defense ? 1 : 0, names.get(b.user_id) ?? new Set(), destroyed)) : null;
        if (card == null || b.at > card) {
          v.unitsDestroyed += real?.destroyed ?? destroyed;
          v.unitsLost += real?.lost ?? lost;
        }
        if (inWindow) recentOf(b.user_id).lost += real?.lost ?? lost;
      }
      /** the opponent is known to be of the own alliance */
      let friendly = false;
      if (!defense) {
        gained.set(b.user_id, (gained.get(b.user_id) ?? 0) + b.loot);
        if (inWindow) recentOf(b.user_id).gained += b.loot;
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
    for (const r of recycled) {
      if (r.t >= end || !values.has(r.user_id)) continue;
      gained.set(r.user_id, (gained.get(r.user_id) ?? 0) + r.n);
      if (r.t >= since) recentOf(r.user_id).gained += r.n;
    }

    for (const [u, v] of values) {
      const gain = gained.get(u) ?? 0;
      v.resources = gain;
      const r = recent.get(u);
      v.profitRatio = r ? Math.round((r.gained / Math.max(r.lost, 1)) * 100) / 100 : 0;
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
    out.set(end, new Map(userIds.map((u) => [u, { points: holds.get(u)!.length, holds: holds.get(u)!, values: values.get(u)!, fleetSource: sources.get(u) ?? null, combatCard: cards.get(u) ?? null }])));
  }
  return out;
}
