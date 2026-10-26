/** Glue of the battle simulator page on top of @pr0hub/battle: state, link, spy report, setup and flight times. */
import { DEFENSE_IDS, SHIP_IDS, type BattleSetup, type Resources, type ShareSlot, type ShareState, type SimSettings, type SimSummary } from '@pr0hub/battle';
import { parseSpyReportsText, spyValues } from '@pr0hub/core/spy';
import { ACS_LIMITS } from '@pr0hub/flight';
import { getFleetConsumption, getFleetSlowest, getMissionDuration, getTargetDistance, type UniSettings } from './core';

export { DEFENSE_IDS, SHIP_IDS };
export { elementName } from './missile';

export type Coords3 = [number, number, number];

/** Research of a slot: weapons, shields, armour (battle), combustion, impulse, hyperspace, fuel efficiency (flight). */
export const COMBAT_TECHS = [109, 110, 111] as const;
export const DRIVE_TECHS = [115, 117, 118, 134] as const;
const TECHS = [...COMBAT_TECHS, ...DRIVE_TECHS];

/** Most fleets of an ACS; the defending side takes as many. */
export const MAX_SLOTS = ACS_LIMITS.maxFleets;
/** Runs per simulation: the battle is random, more runs give steadier averages. */
export const MAX_RUNS = 1000;
export const DEFAULT_RUNS = 20;

export interface Slot {
  units: Record<string, number>;
  research: Record<string, number>;
  /** attackers: start planet (flight time and fuel) */
  from: Coords3 | null;
  /** attackers: speed in percent (10-100) */
  speed: number;
}

export interface BattleState {
  attackers: Slot[];
  /** the planet first, then fleets holding there */
  defenders: Slot[];
  target: Coords3 | null;
  resources: Resources;
  runs: number;
  /** who gets the debris field in the balance; null: the winner */
  debrisTo: 'attacker' | 'defender' | null;
}

export const emptySlot = (): Slot => ({ units: {}, research: {}, from: null, speed: 100 });

export const emptyState = (): BattleState => ({
  attackers: [emptySlot()],
  defenders: [emptySlot()],
  target: null,
  resources: { metal: 0, crystal: 0, deuterium: 0 },
  runs: DEFAULT_RUNS,
  debrisTo: null,
});

const int = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

function cleanCoords(v: unknown): Coords3 | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n > 0) ? [v[0], v[1], v[2]] : null;
}

function cleanSlot(raw: unknown, defender: boolean): Slot {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Slot>;
  const allowed = defender ? [...SHIP_IDS, ...DEFENSE_IDS] : SHIP_IDS.filter((id) => id !== 212);
  const units: Record<string, number> = {};
  for (const id of allowed) if (int(o.units?.[id]) > 0) units[id] = int(o.units?.[id]);
  const research: Record<string, number> = {};
  for (const id of TECHS) if (int(o.research?.[id]) > 0) research[id] = int(o.research?.[id], 0, 99);
  return { units, research, from: cleanCoords(o.from), speed: int(o.speed ?? 100, 10, 100) };
}

/** A stored or linked state, with everything out of range dropped. */
export function cleanState(raw: unknown): BattleState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<BattleState>;
  const slots = (list: unknown, defender: boolean) =>
    (Array.isArray(list) && list.length ? list.slice(0, MAX_SLOTS) : [{}]).map((s) => cleanSlot(s, defender));
  const r = (o.resources ?? {}) as Partial<Resources>;
  return {
    attackers: slots(o.attackers, false),
    defenders: slots(o.defenders, true),
    target: cleanCoords(o.target),
    resources: { metal: int(r.metal), crystal: int(r.crystal), deuterium: int(r.deuterium) },
    runs: o.runs == null ? DEFAULT_RUNS : int(o.runs, 1, MAX_RUNS),
    debrisTo: o.debrisTo === 'attacker' || o.debrisTo === 'defender' ? o.debrisTo : null,
  };
}

// ---- link ---------------------------------------------------------------------------------------------------------

/** The state of a link (hub or share link); `uni` are the universe values by hash key. */
export function stateFromShare(share: ShareState): BattleState {
  return cleanState({
    attackers: share.attackers,
    defenders: share.defenders,
    target: share.target,
    resources: share.resources ?? undefined,
    runs: share.runs,
  });
}

export function shareFromState(s: BattleState, uni: Record<string, number>): ShareState {
  const slot = (x: Slot): ShareSlot => ({ units: x.units, research: x.research, from: x.from, speed: x.speed });
  return {
    attackers: s.attackers.map(slot),
    defenders: s.defenders.map((x) => ({ units: x.units, research: x.research })),
    target: s.target,
    resources: s.resources,
    runs: s.runs,
    uni,
  };
}

// ---- spy report ---------------------------------------------------------------------------------------------------

export type SpyApplyResult =
  | { ok: false }
  | { ok: true; coords: Coords3; moon: boolean; fleet: boolean; defense: boolean; research: boolean; resources: boolean };

/**
 * Takes the newest spy report of a pasted text into the planet slot: target, resources, ships and defense and the
 * combat research, each only when its section was visible (else the values stay).
 */
export function applySpyReport(s: BattleState, text: string): SpyApplyResult {
  const report = parseSpyReportsText(text)[0];
  if (!report) return { ok: false };
  const values = spyValues(report);
  const planet = s.defenders[0];
  s.target = [report.coords.g, report.coords.s, report.coords.p];
  const seen = (cls: number) => report.sections[cls] != null;
  if (seen(900)) s.resources = { metal: values[901] ?? 0, crystal: values[902] ?? 0, deuterium: values[903] ?? 0 };
  const keep = (from: number, to: number) => Object.fromEntries(Object.entries(planet.units).filter(([id]) => Number(id) < from || Number(id) >= to));
  if (seen(200)) planet.units = { ...keep(200, 300), ...Object.fromEntries(SHIP_IDS.filter((id) => values[id]).map((id) => [id, values[id]])) };
  if (seen(400)) planet.units = { ...keep(400, 500), ...Object.fromEntries(DEFENSE_IDS.filter((id) => values[id]).map((id) => [id, values[id]])) };
  if (seen(100)) for (const id of COMBAT_TECHS) planet.research[id] = values[id] ?? 0;
  return { ok: true, coords: s.target, moon: report.planetType === 'moon', fleet: seen(200), defense: seen(400), research: seen(100), resources: seen(900) };
}

// ---- battle -------------------------------------------------------------------------------------------------------

const hasUnits = (x: Slot) => Object.values(x.units).some((n) => n > 0);

/** The battle of the state: slots without units are left out (the planet always fights, even empty). */
export function battleSetup(s: BattleState): BattleSetup {
  return {
    attackers: s.attackers.filter(hasUnits).map((x) => ({ units: x.units, research: x.research })),
    defenders: s.defenders.filter((x, i) => i === 0 || hasUnits(x)).map((x) => ({ units: x.units, research: x.research })),
    resources: s.resources,
  };
}

/** Indexes of the slots that fight (to map the result back to the slots). */
export function fightingSlots(s: BattleState): { attackers: number[]; defenders: number[] } {
  return {
    attackers: s.attackers.map((x, i) => (hasUnits(x) ? i : -1)).filter((i) => i >= 0),
    defenders: s.defenders.map((x, i) => (i === 0 || hasUnits(x) ? i : -1)).filter((i) => i >= 0),
  };
}

export function simSettings(u: Record<string, number>): SimSettings {
  return {
    fleetDebris: Number(u.fleet_debris ?? 30),
    defenseDebris: Number(u.defense_debris ?? 0),
    moonFactor: Number(u.moon_factor ?? 1),
    maxMoonChance: Number(u.max_moon_chance ?? 20),
    bigShields: Number(u.big_shields) === 1,
  };
}

export interface FlightInfo {
  distance: number;
  /** one way, seconds */
  duration: number;
  /** deuterium as the game charges it at launch (getFleetConsumption) */
  consumption: number;
}

/** Flight time and fuel of an attacker slot to the target (null without start, target or ships). */
export function slotFlight(s: BattleState, slot: Slot, u: UniSettings): FlightInfo | null {
  if (!slot.from || !s.target || !hasUnits(slot)) return null;
  const t = {
    combustion: slot.research[115] ?? 0,
    impulse: slot.research[117] ?? 0,
    hyperspace: slot.research[118] ?? 0,
    fuelEfficiency: slot.research[134] ?? 0,
  };
  const from = { g: slot.from[0], s: slot.from[1], p: slot.from[2] };
  const to = { g: s.target[0], s: s.target[1], p: s.target[2] };
  const slowest = getFleetSlowest(slot.units, t);
  if (!slowest.speed) return null;
  const distance = getTargetDistance(from, to, u);
  const duration = getMissionDuration(slot.speed / 10, slowest.speed, distance, u.game_speed);
  const consumption = getFleetConsumption(slot.units, duration, distance, t, u.game_speed, u.honor_boost);
  return { distance, duration, consumption };
}

// ---- balance ------------------------------------------------------------------------------------------------------

export type Side = 'attacker' | 'defender';

export interface BalanceRow {
  key: 'lost' | 'loot' | 'fuel' | 'debris' | 'net';
  metal: number;
  crystal: number;
  deuterium: number;
  /** value in deuterium at the market rates */
  dse: number;
}

/** Market rates for the value in deuterium: metal and crystal per deuterium (the loot calculator's default). */
export const DEFAULT_RATES = { metal: 2.8, crystal: 0.8 };

/** Who gets the debris field by default: the side that wins most often (a draw leaves it to the defender). */
export function defaultDebrisTo(summary: SimSummary): Side {
  const w = summary.wins;
  return w.attacker > w.defender && w.attacker >= w.draw ? 'attacker' : 'defender';
}

/**
 * Average gains and losses of each side in resources and DSE: lost units (rebuilt defense not counted), the loot
 * (gained by the attacker, lost by the defender), the attackers' fuel and the debris field for the side that gets it.
 */
export function balance(summary: SimSummary, debrisTo: Side, rates = DEFAULT_RATES, fuel = 0): Record<Side, BalanceRow[]> {
  const rm = rates.metal > 0 ? rates.metal : 1;
  const rk = rates.crystal > 0 ? rates.crystal : 1;
  const row = (key: BalanceRow['key'], metal: number, crystal: number, deuterium: number): BalanceRow => ({
    key, metal, crystal, deuterium, dse: metal / rm + crystal / rk + deuterium,
  });
  const neg = (r: Resources) => [-r.metal, -r.crystal, -r.deuterium] as const;
  const debris = { metal: summary.debris.metal.avg, crystal: summary.debris.crystal.avg, deuterium: 0 };
  const sides: Record<Side, BalanceRow[]> = {
    attacker: [row('lost', ...neg(summary.lostResources.attacker)), row('loot', summary.loot.metal, summary.loot.crystal, summary.loot.deuterium)],
    defender: [row('lost', ...neg(summary.lostResources.defender)), row('loot', ...neg(summary.loot))],
  };
  if (fuel > 0) sides.attacker.push(row('fuel', 0, 0, -fuel));
  sides[debrisTo].push(row('debris', debris.metal, debris.crystal, 0));
  for (const side of ['attacker', 'defender'] as const) {
    const rows = sides[side];
    rows.push(row('net', ...(['metal', 'crystal', 'deuterium'] as const).map((k) => rows.reduce((a, r) => a + r[k], 0)) as [number, number, number]));
  }
  return sides;
}
