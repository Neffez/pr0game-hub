/* Interplanetary missile calculator: glue between the page (../ipm-calculator/main.js) and @pr0hub/flight. */
import { TECH_NAMES } from '@pr0hub/core/tech';
import { parseSpyReportsText, spyValues } from '@pr0hub/core/spy';
import {
  destroyedValue,
  INTERCEPTOR,
  INTERPLANETARY,
  inMissileRange,
  MISSILE_COST,
  MISSILE_TARGET_IDS,
  MISSILE_TARGETS,
  missileAttack,
  missileDamage,
  missileDuration,
  missileRange,
  missileSystemDistance,
  missilesNeeded,
  PRIMARY_TARGET_IDS,
  primaryTarget,
  siloSlots,
  structurePoints,
  type Coords,
} from '@pr0hub/flight';

export { MISSILE_COST, MISSILE_TARGET_IDS, MISSILE_TARGETS, PRIMARY_TARGET_IDS, missileDamage, structurePoints };

export type ToolLang = 'de' | 'en';

/** Smallest silo level that can launch missiles (ShowFleetMissilePage). */
export const MIN_SILO = 4;
/** Armour technology in a spy report's research. */
const ARMOR = 111;

export interface MissileState {
  start: Coords;
  target: Coords;
  /** target is a moon: the interceptors of its planet defend */
  moon: boolean;
  impulse: number;
  weapons: number;
  silo: number;
  missiles: number;
  /** primary target, 0 = none (missile launcher first) */
  primary: number;
  armor: number;
  interceptors: number;
  /** target's defense and interplanetary missiles by id */
  defense: Record<number, number>;
  uni: {
    systems: number;
    /** game config galaxy_type: 0 linear, 1 ring, 2 sphere */
    galaxyType: number;
    /** fleet speed as a multiple of normal (fleet_speed / 2500) */
    speed: number;
    rangeFactor: number;
    siloFactor: number;
  };
}

export function emptyState(): MissileState {
  return {
    start: [1, 1, 1],
    target: [1, 1, 1],
    moon: false,
    impulse: 0,
    weapons: 0,
    silo: 0,
    missiles: 0,
    primary: 0,
    armor: 0,
    interceptors: 0,
    defense: {},
    uni: { systems: 400, galaxyType: 0, speed: 1, rangeFactor: 1, siloFactor: 1 },
  };
}

/** Element name in the page language (short name for tight spots). */
export function elementName(id: number, lang: ToolLang, short = false): string {
  const names = TECH_NAMES as unknown as Record<string, Record<string, string>>;
  return names[short ? `${lang}Short` : lang]?.[id] ?? names[lang]?.[id] ?? String(id);
}

const int = (v: unknown, min = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, n) : min;
};
const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Coordinates "1:234:5" (also with brackets or spaces). */
export function parseCoordsText(text: string): Coords | null {
  const m = String(text).match(/(\d+)\s*:\s*(\d+)\s*:\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function fmtCoordsText(c: Coords): string {
  return c.join(':');
}

// ---- share link -------------------------------------------------------------------------------------------------

const COORD_KEYS: [string, 'start' | 'target', number][] = [
  ['sg', 'start', 0], ['ss', 'start', 1], ['sp', 'start', 2], ['tg', 'target', 0], ['ts', 'target', 1], ['tp', 'target', 2],
];
const NUM_KEYS: [string, 'impulse' | 'weapons' | 'silo' | 'missiles' | 'primary' | 'armor' | 'interceptors'][] = [
  ['i', 'impulse'], ['w', 'weapons'], ['sl', 'silo'], ['n', 'missiles'], ['pt', 'primary'], ['a', 'armor'], ['ic', 'interceptors'],
];

/**
 * Hash of a share link (keys like the flight calculator's: sg/ss/sp, tg/ts/tp, i, ms, gt, gs; plus m (moon), w, a,
 * sl, n, pt, ic, d401…d411 and d503, mrf, sf). Only what differs from the defaults is written.
 */
export function encodeHash(s: MissileState): string {
  const p = new URLSearchParams();
  for (const [key, which, i] of COORD_KEYS) p.set(key, String(s[which][i]));
  if (s.moon) p.set('m', '1');
  for (const [key, field] of NUM_KEYS) if (s[field]) p.set(key, String(s[field]));
  for (const id of MISSILE_TARGET_IDS) if (s.defense[id]) p.set(`d${id}`, String(s.defense[id]));
  p.set('ms', String(s.uni.systems));
  p.set('gt', String(s.uni.galaxyType));
  p.set('gs', String(s.uni.speed));
  if (s.uni.rangeFactor !== 1) p.set('mrf', String(s.uni.rangeFactor));
  if (s.uni.siloFactor !== 1) p.set('sf', String(s.uni.siloFactor));
  return p.toString();
}

/**
 * Applies a share link hash to the state; false when it holds nothing of this calculator. A link with a target
 * replaces everything about the target (values it leaves out are zero); own research and the universe stay unless
 * the link carries them.
 */
export function applyHash(s: MissileState, hash: string): boolean {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  let any = false;
  if (p.has('tg')) {
    const fresh = emptyState();
    s.moon = fresh.moon;
    s.primary = fresh.primary;
    s.armor = fresh.armor;
    s.interceptors = fresh.interceptors;
    s.defense = fresh.defense;
  }
  for (const [key, which, i] of COORD_KEYS) {
    if (p.has(key)) { s[which][i] = int(p.get(key), 1); any = true; }
  }
  if (p.has('m')) { s.moon = p.get('m') === '1'; any = true; }
  for (const [key, field] of NUM_KEYS) {
    if (p.has(key)) { s[field] = int(p.get(key)); any = true; }
  }
  const defense: Record<number, number> = {};
  let hasDefense = false;
  for (const id of MISSILE_TARGET_IDS) {
    if (p.has(`d${id}`)) { defense[id] = int(p.get(`d${id}`)); hasDefense = true; }
  }
  if (hasDefense) { s.defense = defense; any = true; }
  if (p.has('ms')) { s.uni.systems = int(p.get('ms'), 1); any = true; }
  if (p.has('gt')) { s.uni.galaxyType = Math.min(2, int(p.get('gt'))); any = true; }
  if (p.has('gs')) { s.uni.speed = Math.max(0.01, num(p.get('gs'), 1)); any = true; }
  if (p.has('mrf')) { s.uni.rangeFactor = Math.max(0, num(p.get('mrf'), 1)); any = true; }
  if (p.has('sf')) { s.uni.siloFactor = Math.max(0, num(p.get('sf'), 1)); any = true; }
  return any;
}

/** A stored state with every field present and in range (older or broken data falls back to the defaults). */
export function cleanState(saved: unknown): MissileState {
  const s = emptyState();
  if (!saved || typeof saved !== 'object') return s;
  const o = saved as Partial<MissileState>;
  const coords = (c: unknown, fallback: Coords): Coords =>
    Array.isArray(c) && c.length === 3 ? [int(c[0], 1), int(c[1], 1), int(c[2], 1)] : fallback;
  s.start = coords(o.start, s.start);
  s.target = coords(o.target, s.target);
  s.moon = !!o.moon;
  for (const [, field] of NUM_KEYS) s[field] = int(o[field]);
  for (const id of MISSILE_TARGET_IDS) if (o.defense && int(o.defense[id])) s.defense[id] = int(o.defense[id]);
  if (o.uni) {
    s.uni.systems = int(o.uni.systems, 1) || 400;
    s.uni.galaxyType = Math.min(2, int(o.uni.galaxyType));
    s.uni.speed = Math.max(0.01, num(o.uni.speed, 1));
    s.uni.rangeFactor = Math.max(0, num(o.uni.rangeFactor, 1));
    s.uni.siloFactor = Math.max(0, num(o.uni.siloFactor, 1));
  }
  return s;
}

// ---- spy report -------------------------------------------------------------------------------------------------

export type SpyApplyResult =
  | { ok: false }
  | { ok: true; coords: Coords; moon: boolean; defense: boolean; armor: boolean; interceptors: boolean };

/**
 * Takes the newest spy report of a pasted text: target coordinates and type, defense and missiles, armour. On a moon
 * the interceptors are left alone, as the game counts those of the planet.
 */
export function applySpyReport(s: MissileState, text: string): SpyApplyResult {
  const report = parseSpyReportsText(text)[0];
  if (!report) return { ok: false };
  const values = spyValues(report);
  const moon = report.planetType === 'moon';
  s.target = [report.coords.g, report.coords.s, report.coords.p];
  s.moon = moon;
  const defenseSeen = report.sections[400] != null;
  if (defenseSeen) {
    s.defense = {};
    for (const id of MISSILE_TARGET_IDS) if (values[id]) s.defense[id] = values[id];
    if (!moon) s.interceptors = values[INTERCEPTOR] ?? 0;
  }
  const armorSeen = values[ARMOR] != null;
  if (armorSeen) s.armor = values[ARMOR];
  return { ok: true, coords: s.target, moon, defense: defenseSeen, armor: armorSeen, interceptors: defenseSeen && !moon };
}

// ---- result -----------------------------------------------------------------------------------------------------

export interface TargetRow {
  id: number;
  count: number;
  structure: number;
  destroyed: number;
  remaining: number;
}

export interface MissileResult {
  range: number;
  /** systems between start and target as the game counts them for missiles */
  distance: number;
  sameGalaxy: boolean;
  inRange: boolean;
  duration: number;
  siloOk: boolean;
  impulseOk: boolean;
  /** missiles the silo holds (only interplanetary missiles, two places each) */
  siloCapacity: number;
  primary: number;
  intercepted: number;
  effective: number;
  interceptorsLeft: number;
  damage: number;
  rows: TargetRow[];
  neededAll: number | null;
  neededPrimary: number | null;
  cost: { m: number; k: number; d: number };
  value: { m: number; k: number; d: number };
}

const universe = (s: MissileState) => ({
  systems: s.uni.systems,
  circularSystems: s.uni.galaxyType === 1,
  sphereSystems: s.uni.galaxyType === 2,
  fleetSpeed: s.uni.speed * 2500,
});

export function calculate(s: MissileState): MissileResult {
  const u = universe(s);
  const input = { weapons: s.weapons, armor: s.armor, interceptors: s.interceptors, defense: s.defense, primary: s.primary };
  const attack = missileAttack({ ...input, missiles: s.missiles });
  const rows = MISSILE_TARGET_IDS.filter((id) => (s.defense[id] ?? 0) > 0).map((id) => ({
    id,
    count: s.defense[id],
    structure: structurePoints(id, s.armor),
    destroyed: attack.destroyed[id] ?? 0,
    remaining: attack.remaining[id] ?? 0,
  }));
  return {
    range: missileRange(s.impulse, s.uni.rangeFactor),
    distance: missileSystemDistance(u, s.start[1], s.target[1]),
    sameGalaxy: s.start[0] === s.target[0],
    inRange: inMissileRange(u, s.start, s.target, s.impulse, s.uni.rangeFactor),
    duration: missileDuration(u, s.start[1], s.target[1]),
    siloOk: s.silo >= MIN_SILO,
    impulseOk: s.impulse > 0,
    siloCapacity: Math.floor(siloSlots(s.silo, s.uni.siloFactor) / 2),
    primary: primaryTarget(s.primary),
    intercepted: attack.intercepted,
    effective: attack.effective,
    interceptorsLeft: attack.interceptorsLeft,
    damage: missileDamage(attack.effective, s.weapons),
    rows,
    neededAll: missilesNeeded(input, 'all'),
    neededPrimary: missilesNeeded(input, 'primary'),
    cost: { m: MISSILE_COST.m * s.missiles, k: MISSILE_COST.k * s.missiles, d: MISSILE_COST.d * s.missiles },
    value: destroyedValue(attack.destroyed),
  };
}

export { INTERCEPTOR, INTERPLANETARY };
