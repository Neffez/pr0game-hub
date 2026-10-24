import { distance, drivesFromResearch, fleetConsumption, flightDuration, slowestShip } from '@pr0hub/flight';
import { cleanState, emptyState, MAX_PARTICIPANTS, SHARE_WITHIN, type Battle, type BattleFleet, type LootState, type Ships } from '@pr0hub/loot';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { REPORT_SLACK } from '../store.js';
import { memberPlayers } from './members.js';
import { launchedOf, planDrives, type LaunchFleet, type PlanRow } from './plans.js';

/** Battles count for a plan from an hour before its time until an hour after its (day/hour) window. */
const BATTLE_SLACK = 3600;
/** Share a recycling helper keeps by default (%). */
export const HELPER_KEEP = 20;

/** Id of a member in a settlement. */
export const memberKey = (userId: number) => `u${userId}`;

/** Where the hub took a value of the draft from, for the web view. */
export interface DraftSources {
  /** per battle: report id (null: battle message without report) and whether the fleets come from the battle report */
  battles: { reportId: string | null; time: number | null; fleets: 'report' | 'plan' }[];
  /** participant id -> battle index -> loot of their fleets by the fleet return messages (wins over the share by cargo space) */
  returnLoot: Record<string, Record<number, { m: number; k: number; d: number }>>;
  /** participant id -> deuterium of the attack flights computed from the plan fleet */
  flightDeut: Record<string, number>;
  /** recycling reports taken (id of the person, time) */
  recycling: { by: string; time: number | null }[];
}

type PlanFleet = LaunchFleet & { member: string; speed: number; manual: string | null; drives_time: number | null };
/** `name`: a guest taken from a battle report whose player is not in the galaxy data */
type Guest = { player: { id: number; name: string } | null; name?: string; ships: Record<number, number> };
const guestName = (g: Guest) => g.player?.name ?? g.name ?? null;

const lower = (s: string) => s.trim().toLowerCase();

/**
 * Settlement prefilled from the hub's data: participants from the plan's fleets (members first, then guest fleets),
 * battles at the target around the plan's time (fleets and losses from the archived battle report, else the planned
 * ships), loot by cargo space like the game unless the members' fleet return messages tell what each fleet brought home, recycling
 * reports at the target within 24 hours (members outside the plan as helpers) and the deuterium of the attack flights.
 * A hold is settled like an ACS: the defenders (hold fleets and the attacked member) share the debris to cover their
 * lost ships; the attacker's loot is not theirs.
 */
export function settlementDraft(db: DB, ctx: GroupContext, plan: PlanRow & { time_precision: string; guests: string | null }): { state: LootState; sources: DraftSources } {
  const state = emptyState();
  const hold = plan.mission === 'hold';
  const sources: DraftSources = { battles: [], returnLoot: {}, flightDeut: {}, recycling: [] };
  const fleets = db
    .prepare(
      `SELECT f.id, f.plan_id, f.user_id, COALESCE(gm.ingame_name, u.username) AS member, f.g, f.s, f.p, f.planet_type, f.ships, f.speed, f.status,
         f.drives AS manual, f.drives_time
       FROM attack_plan_fleets f JOIN users u ON u.id = f.user_id LEFT JOIN group_members gm ON gm.group_id = ? AND gm.user_id = f.user_id
       WHERE f.plan_id = ? AND f.status <> 'withdrawn' ORDER BY f.id`,
    )
    .all(ctx.groupId, plan.id) as PlanFleet[];
  const seen = launchedOf(db, ctx, [plan], fleets);
  const shipsOf = (f: PlanFleet): Ships => seen.get(f.id)?.ships ?? (JSON.parse(f.ships) as Ships);

  // participants: members of the plan, then guest fleets (at most the game's ACS limit)
  const names = new Map<string, string>();
  for (const f of fleets) {
    const id = memberKey(f.user_id);
    if (state.participants.some((p) => p.id === id) || state.participants.length >= MAX_PARTICIPANTS) continue;
    state.participants.push({ id, name: f.member, flightDeut: 0, recDeut: 0, missiles: 0 });
  }
  // a hold: the attacked member defends with the ships on the planet
  const attacked = hold
    ? (db
        .prepare(
          `SELECT e.member_id AS id, COALESCE(gm.ingame_name, u.username) AS name FROM attack_plan_enemy e JOIN users u ON u.id = e.member_id
           LEFT JOIN group_members gm ON gm.group_id = ? AND gm.user_id = e.member_id WHERE e.plan_id = ?`,
        )
        .get(ctx.groupId, plan.id) as { id: number; name: string } | undefined)
    : undefined;
  if (attacked && !state.participants.some((p) => p.id === memberKey(attacked.id)) && state.participants.length < MAX_PARTICIPANTS) {
    state.participants.push({ id: memberKey(attacked.id), name: attacked.name, flightDeut: 0, recDeut: 0, missiles: 0 });
  }
  const guests = (plan.guests ? (JSON.parse(plan.guests) as Guest[]) : []).filter((g) => guestName(g));
  guests.forEach((g, i) => {
    const name = guestName(g)!;
    if (state.participants.length >= MAX_PARTICIPANTS || state.participants.some((p) => lower(p.name) === lower(name))) return;
    state.participants.push({ id: `g${i + 1}`, name, flightDeut: 0, recDeut: 0, missiles: 0 });
  });
  // battle report names -> participant: in-game name, hub name and the member's player in the galaxy data
  const players = memberPlayers(db, ctx);
  const playerName = db.prepare('SELECT name FROM players WHERE id = ?').pluck();
  for (const p of state.participants) {
    names.set(lower(p.name), p.id);
    const userId = p.id.startsWith('u') ? Number(p.id.slice(1)) : null;
    const player = userId != null ? players.get(userId) : null;
    const name = player ? (playerName.get(player) as string | undefined) : undefined;
    if (name) names.set(lower(name), p.id);
  }
  const username = db.prepare('SELECT username FROM users WHERE id = ?').pluck();
  for (const f of fleets) names.set(lower(username.get(f.user_id) as string), memberKey(f.user_id));
  if (attacked) names.set(lower(username.get(attacked.id) as string), memberKey(attacked.id));

  // flight deuterium of the plan fleets (as the game charges it at launch)
  const u = ctx.universe.settings;
  const drivesOf = planDrives(db, ctx);
  if (plan.g != null) {
    for (const f of fleets) {
      if (f.g == null) continue;
      const ships = shipsOf(f);
      const drives = drivesFromResearch(drivesOf({ user_id: f.user_id, manual: f.manual, drives_time: f.drives_time })?.research ?? {});
      const slowest = slowestShip(ships, drives);
      if (!slowest) continue;
      const dist = distance(u, [f.g, f.s!, f.p!], [plan.g, plan.s!, plan.p!]);
      const deut = fleetConsumption(u, ships, flightDuration(u, dist, slowest.speed, f.speed), dist, drives);
      const p = state.participants.find((x) => x.id === memberKey(f.user_id));
      if (!p) continue;
      p.flightDeut = (p.flightDeut ?? 0) + deut;
      sources.flightDeut[p.id] = p.flightDeut;
    }
  }

  if (plan.g == null) return { state, sources };
  const window = plan.time_precision === 'day' ? 86400 : plan.time_precision === 'hour' ? 3600 : 0;
  const since = plan.target_time - BATTLE_SLACK;
  const until = plan.target_time + window + BATTLE_SLACK;
  type BattleRow = {
    report_id: string | null; c_report_id: string | null; time: number | null; loot_metal: number; loot_crystal: number; loot_deuterium: number;
    fleets: string | null; c_metal: number | null; c_crystal: number | null; c_deuterium: number | null; debris_metal: number | null; debris_crystal: number | null;
  };
  // battle messages with their archived report (by id, or a report pasted as text at the same target and time)
  const sameReport = `c.group_id = b.group_id AND (c.report_id = b.report_id OR (c.g = b.g AND c.s = b.s AND c.p = b.p AND c.planet_type = b.planet_type
    AND ABS(c.time - b.time) <= ${REPORT_SLACK}))`;
  const battleRows = [
    ...(db
      .prepare(
        `SELECT b.report_id, c.report_id AS c_report_id, b.time, b.loot_metal, b.loot_crystal, b.loot_deuterium, c.fleets,
           c.loot_metal AS c_metal, c.loot_crystal AS c_crystal, c.loot_deuterium AS c_deuterium,
           COALESCE(c.debris_metal, b.debris_metal) AS debris_metal, COALESCE(c.debris_crystal, b.debris_crystal) AS debris_crystal
         FROM battle_reports b LEFT JOIN combat_reports c ON ${sameReport}
         WHERE b.group_id = ? AND b.g = ? AND b.s = ? AND b.p = ? AND b.planet_type = ? AND b.time BETWEEN ? AND ?
         ORDER BY b.time, b.id, c.report_id = b.report_id DESC`,
      )
      .all(ctx.groupId, plan.g, plan.s, plan.p, plan.planet_type, since, until) as BattleRow[]),
    // archived reports at the target without a battle message (e.g. pasted as text only)
    ...(db
      .prepare(
        `SELECT NULL AS report_id, c.report_id AS c_report_id, c.time, c.loot_metal, c.loot_crystal, c.loot_deuterium, c.fleets,
           c.loot_metal AS c_metal, c.loot_crystal AS c_crystal, c.loot_deuterium AS c_deuterium, c.debris_metal, c.debris_crystal
         FROM combat_reports c
         WHERE c.group_id = ? AND c.g = ? AND c.s = ? AND c.p = ? AND c.planet_type = ? AND c.time BETWEEN ? AND ?
           AND NOT EXISTS (SELECT 1 FROM battle_reports b WHERE ${sameReport})`,
      )
      .all(ctx.groupId, plan.g, plan.s, plan.p, plan.planet_type, since, until) as BattleRow[]),
  ].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  // one battle synced by several members: same report id, or the same time and loot
  const keys = new Set<string>();
  // per battle and participant: how many fleets they had in the report (each one flies home)
  const fleetCounts: Map<string, number>[] = [];
  for (const b of battleRows) {
    const key = b.report_id ?? b.c_report_id ?? `${b.time}:${b.loot_metal}:${b.loot_crystal}:${b.loot_deuterium}`;
    if (keys.has(key) || state.battles.length >= 20) continue;
    keys.add(key);
    const loot = hold ? { m: 0, k: 0, d: 0 } : { m: b.loot_metal, k: b.loot_crystal, d: b.loot_deuterium };
    if (!hold && !loot.m && !loot.k && !loot.d && b.c_metal != null) Object.assign(loot, { m: b.c_metal, k: b.c_crystal, d: b.c_deuterium });
    const battleFleets = new Map<string, BattleFleet>();
    const add = (participant: string, start: Ships, end: Ships) => {
      const f = battleFleets.get(participant) ?? { participant, start: {}, end: {} };
      for (const [id, n] of Object.entries(start)) f.start[Number(id)] = (f.start[Number(id)] ?? 0) + n;
      for (const [id, n] of Object.entries(end)) f.end[Number(id)] = (f.end[Number(id)] ?? 0) + n;
      battleFleets.set(participant, f);
    };
    const counts = new Map<string, number>();
    if (b.fleets) {
      // attackers, or the defenders of a hold (ships only: defence is rebuilt)
      for (const [side, name, all] of JSON.parse(b.fleets) as [number, string, [number, number, number][]][]) {
        const participant = side === (hold ? 1 : 0) ? names.get(lower(name)) : undefined;
        const ships = hold ? all.filter(([id]) => id >= 200 && id < 300) : all;
        if (!participant) continue;
        add(participant, Object.fromEntries(ships.map(([id, before]) => [id, before])), Object.fromEntries(ships.map(([id, , after]) => [id, after])));
        counts.set(participant, (counts.get(participant) ?? 0) + 1);
      }
    } else {
      // no archived report: the fleets as planned or seen flying, losses unknown
      for (const f of fleets) add(memberKey(f.user_id), shipsOf(f), shipsOf(f));
      guests.forEach((g, i) => {
        const p = state.participants.find((x) => x.id === `g${i + 1}`);
        if (p) add(p.id, g.ships, g.ships);
      });
    }
    const battle: Battle = { time: b.time, loot, fleets: [...battleFleets.values()].filter((f) => state.participants.some((p) => p.id === f.participant)) };
    // the field at the target after the battle
    if (b.debris_metal || b.debris_crystal) battle.debris = { m: b.debris_metal ?? 0, k: b.debris_crystal ?? 0 };
    state.battles.push(battle);
    fleetCounts.push(counts);
    sources.battles.push({ reportId: b.c_report_id ?? b.report_id, time: b.time, fleets: b.fleets ? 'report' : 'plan' });
  }

  // loot each fleet brought home by the members' fleet return messages (only with one battle: several waves cannot be
  // told apart): per participant the first returns after the battle, one per fleet in the report, to planets they
  // started from; they win over the shares by cargo space
  if (!hold && state.battles.length === 1) {
    const battle = state.battles[0];
    const at = battle.time ?? plan.target_time;
    const returns = db
      .prepare(
        `SELECT user_id, home_g, home_s, home_p, metal, crystal, deuterium FROM fleet_returns
         WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND time > ? AND time <= ? ORDER BY time, id`,
      )
      .all(ctx.groupId, plan.g, plan.s, plan.p, at, at + SHARE_WITHIN) as {
      user_id: number; home_g: number; home_s: number; home_p: number; metal: number; crystal: number; deuterium: number;
    }[];
    for (const p of state.participants) {
      if (!p.id.startsWith('u')) continue;
      const userId = Number(p.id.slice(1));
      const homes = fleets.filter((f) => f.user_id === userId && f.g != null).map((f) => `${f.g}:${f.s}:${f.p}`);
      const theirs = returns.filter((r) => r.user_id === userId && (!homes.length || homes.includes(`${r.home_g}:${r.home_s}:${r.home_p}`)));
      const taken = theirs.slice(0, fleetCounts[0]?.get(p.id) ?? theirs.length);
      const fleet = battle.fleets.find((f) => f.participant === p.id);
      if (!taken.length || !fleet) continue;
      const carried = taken.reduce((a, r) => ({ m: a.m + r.metal, k: a.k + r.crystal, d: a.d + r.deuterium }), { m: 0, k: 0, d: 0 });
      fleet.loot = carried;
      sources.returnLoot[p.id] = { 0: carried };
    }
    // more than the battle's loot on the way home (cargo from the way out): the shares by cargo space count
    const home = battle.fleets.reduce((a, f) => ({ m: a.m + (f.loot?.m ?? 0), k: a.k + (f.loot?.k ?? 0), d: a.d + (f.loot?.d ?? 0) }), { m: 0, k: 0, d: 0 });
    if (home.m > battle.loot.m + 10 || home.k > battle.loot.k + 10 || home.d > battle.loot.d + 10) {
      for (const f of battle.fleets) delete f.loot;
      sources.returnLoot = {};
    }
  }

  // recycling at the target within 24 hours of the first battle
  const from = state.battles[0]?.time ?? plan.target_time - BATTLE_SLACK;
  const recycled = db
    .prepare(
      `SELECT r.user_id, COALESCE(gm.ingame_name, u.username) AS member, r.time, r.metal, r.crystal, r.total_metal, r.total_crystal
       FROM recycle_reports r JOIN users u ON u.id = r.user_id LEFT JOIN group_members gm ON gm.group_id = r.group_id AND gm.user_id = r.user_id
       WHERE r.group_id = ? AND r.g = ? AND r.s = ? AND r.p = ? AND r.time BETWEEN ? AND ? ORDER BY r.time, r.id`,
    )
    .all(ctx.groupId, plan.g, plan.s, plan.p, from - 60, from + SHARE_WITHIN) as {
    user_id: number; member: string; time: number | null; metal: number; crystal: number; total_metal: number; total_crystal: number;
  }[];
  for (const r of recycled) {
    const id = memberKey(r.user_id);
    if (!state.participants.some((p) => p.id === id) && !state.helpers.some((h) => h.id === id)) {
      state.helpers.push({ id, name: r.member, keepPct: HELPER_KEEP, recDeut: 0 });
    }
    state.recycling.push({
      by: id, m: r.metal, k: r.crystal, time: r.time, ...(r.total_metal || r.total_crystal ? { field: { m: r.total_metal, k: r.total_crystal } } : {}),
    });
    sources.recycling.push({ by: id, time: r.time });
  }
  return { state: cleanState(state), sources };
}

export interface SavedSettlement {
  state: LootState;
  done: string[];
  updated_at: number;
  updated_by: string | null;
}

export function savedSettlement(db: DB, ctx: GroupContext, planId: number): SavedSettlement | null {
  const row = db
    .prepare(
      `SELECT s.data, s.done, s.updated_at, COALESCE(gm.ingame_name, u.username) AS updated_by
       FROM raid_settlements s LEFT JOIN users u ON u.id = s.updated_by LEFT JOIN group_members gm ON gm.group_id = s.group_id AND gm.user_id = s.updated_by
       WHERE s.plan_id = ? AND s.group_id = ?`,
    )
    .get(planId, ctx.groupId) as { data: string; done: string; updated_at: number; updated_by: string | null } | undefined;
  if (!row) return null;
  return { state: cleanState(JSON.parse(row.data)), done: JSON.parse(row.done) as string[], updated_at: row.updated_at, updated_by: row.updated_by };
}
