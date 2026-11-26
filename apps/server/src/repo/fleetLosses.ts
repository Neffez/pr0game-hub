import { elementPoints } from '@pr0hub/core/tech';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { likeTerm } from './sql.js';

/**
 * Ships a player lost in battles (battle hall and members' messages, on either side): a fleet seen in a spy report,
 * on its way or in a battle is taken down by the ships destroyed in the battles after it (player page, farm finder,
 * defense advisor). Per type at most the ships seen, wherever the battle took place: what is left stays a lower bound.
 */

/** The ships one player lost in one battle. */
export interface BattleLoss {
  time: number;
  reportId: string;
  units: Record<string, number>;
}

type Fleets = [number, string, [number, number, number][]][];
const isShip = (id: number) => id >= 200 && id < 300;

/** The ships the players of `names` (lower case) lost in one battle (`fleets` of `combat_reports`), empty when none. */
export function lossOf(fleets: Fleets, names: Set<string>): Record<string, number> {
  const lost: Record<string, number> = {};
  for (const [, who, list] of fleets) {
    if (!who || !names.has(who.toLowerCase())) continue;
    for (const [id, before, after] of list) if (isShip(id) && before > after && before > 0) lost[id] = (lost[id] ?? 0) + before - Math.max(0, after);
  }
  return lost;
}

/** The names a player went by: the current one and the earlier ones. */
export function playerNames(db: DB, playerId: number | null, name: string): string[] {
  const aliases = playerId != null ? (db.prepare('SELECT name FROM player_aliases WHERE player_id = ?').pluck().all(playerId) as string[]) : [];
  return [...new Set([name, ...aliases])];
}

/** The battles since `since` in which a player (by any of `names`) lost ships. */
export function playerLosses(db: DB, ctx: GroupContext, names: string[], since = 0): BattleLoss[] {
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const q = db.prepare(`SELECT report_id, time, fleets FROM combat_reports WHERE group_id = ? AND time >= ? AND fleets LIKE ? ESCAPE '\\'`);
  const seen = new Set<string>();
  const out: BattleLoss[] = [];
  for (const n of new Set(names)) {
    // the name as it stands in the JSON, its LIKE wildcards escaped
    for (const r of q.all(ctx.groupId, since, likeTerm(JSON.stringify(n))) as { report_id: string; time: number; fleets: string }[]) {
      if (seen.has(r.report_id)) continue;
      seen.add(r.report_id);
      const units = lossOf(JSON.parse(r.fleets) as Fleets, lower);
      if (Object.keys(units).length) out.push({ time: r.time, reportId: r.report_id, units });
    }
  }
  return out;
}

/** The losses of every player in the battles since `since`, by lower-case name (many players at once: one scan). */
export function lossesByName(db: DB, ctx: GroupContext, since: number): Map<string, BattleLoss[]> {
  const out = new Map<string, BattleLoss[]>();
  const rows = db.prepare('SELECT report_id, time, fleets FROM combat_reports WHERE group_id = ? AND time >= ?').all(ctx.groupId, since) as {
    report_id: string; time: number; fleets: string;
  }[];
  for (const r of rows) {
    const fleets = JSON.parse(r.fleets) as Fleets;
    for (const who of new Set(fleets.map(([, n]) => n?.toLowerCase()).filter((n): n is string => !!n))) {
      const units = lossOf(fleets, new Set([who]));
      if (!Object.keys(units).length) continue;
      let list = out.get(who);
      if (!list) out.set(who, (list = []));
      list.push({ time: r.time, reportId: r.report_id, units });
    }
  }
  return out;
}

/** The losses of a player under any of their names from `lossesByName`. */
export function lossesOfNames(byName: Map<string, BattleLoss[]>, names: string[]): BattleLoss[] {
  const seen = new Set<string>();
  const out: BattleLoss[] = [];
  for (const n of new Set(names.map((x) => x.toLowerCase()))) {
    for (const l of byName.get(n) ?? []) {
      if (seen.has(l.reportId)) continue;
      seen.add(l.reportId);
      out.push(l);
    }
  }
  return out;
}

export interface AfterLosses {
  /** the ships seen less the ones lost since */
  units: Record<string, number>;
  /** ships of the sighting destroyed since */
  lost: Record<string, number>;
  lostPoints: number;
  /** battles since in which ships of `lost` were destroyed */
  lostBattles: number;
}

/**
 * Takes the ships lost in the battles after `time` off a fleet seen then (`inclusive`: a fleet seen in a battle, from
 * that battle on, itself included). Ships of other types (defense, ...) stay as they are. Call inside `withUnits`.
 */
export function afterLosses(units: Record<string, number>, time: number, losses: BattleLoss[], inclusive = false): AfterLosses {
  const since = losses.filter((l) => (inclusive ? l.time >= time : l.time > time));
  const sum: Record<string, number> = {};
  for (const l of since) for (const [id, n] of Object.entries(l.units)) sum[id] = (sum[id] ?? 0) + n;
  const lost: Record<string, number> = {};
  for (const [id, n] of Object.entries(sum)) {
    const m = Math.min(n, units[id] ?? 0);
    if (m > 0) lost[id] = m;
  }
  const left: Record<string, number> = { ...units };
  for (const [id, n] of Object.entries(lost)) left[id] -= n;
  return {
    units: left,
    lost,
    lostPoints: Math.round(Object.entries(lost).reduce((s, [id, n]) => s + elementPoints(id, n), 0)),
    lostBattles: Object.keys(lost).length ? since.filter((l) => Object.keys(l.units).some((id) => lost[id])).length : 0,
  };
}
