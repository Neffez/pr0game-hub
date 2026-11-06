/**
 * Ships, defense and missiles as a catalog that a universe can change: costs, requirements, cargo, drives, combat
 * values and names. The defaults are the values the hub always had (install.sql via `gen:costs`, the later ships from
 * their info pages); a universe stores only its differences (`UnitOverrides`), so changes of the defaults in code still
 * reach every universe.
 *
 * Code that runs for one universe at a time (the web app, a battle worker) sets the active catalog; everything else
 * passes a catalog explicitly or runs synchronously inside `withUnits`.
 */
import { CAPACITY, SHIPS as DRIVES, type ShipDrives } from '@pr0hub/flight';
import combatData from './data/combat.json' with { type: 'json' };
import costData from './data/costs.json' with { type: 'json' };
import shipData from './data/ships.json' with { type: 'json' };
import techData from './data/tech.json' with { type: 'json' };
import { LIVE_RAPIDFIRE_AGAINST, LIVE_UNITS } from './liveUnits.js';

export type UnitLang = 'de' | 'en';
export type { ShipDrives };

export interface UnitDef {
  /** 200-299 ships, 400-599 defense and missiles */
  id: number;
  name: Record<UnitLang, string>;
  /** short column label */
  short: Record<UnitLang, string>;
  /** metal, crystal, deuterium of one unit */
  cost: [number, number, number];
  /** element id -> level */
  req: Record<string, number>;
  /** once per planet (shield domes) */
  one: boolean;
  attack: number;
  shield: number;
  /** target id -> shots */
  rapidfire: Record<string, number>;
  /** cargo capacity (ships) */
  capacity: number;
  /** drives (ships; null: does not fly) */
  drives: ShipDrives | null;
}

/** Changes of a universe to one unit: changed fields, or `hidden` (the unit does not exist there). */
export type UnitPatch = Partial<Omit<UnitDef, 'id'>> & { hidden?: boolean };
export type UnitOverrides = Record<string, UnitPatch>;

export interface UnitCatalog {
  /** cache key (the overrides as JSON) */
  key: string;
  /** visible units by id */
  units: Readonly<Record<string, UnitDef>>;
  /** visible ids, sorted */
  ids: readonly number[];
  ships: readonly number[];
  defense: readonly number[];
  /** drives by ship id (for `@pr0hub/flight`) */
  drives: Readonly<Record<string, ShipDrives>>;
  /** cargo capacity by ship id */
  capacity: Readonly<Record<number, number>>;
}

export const MIN_UNIT_ID = 200;
export const MAX_UNIT_ID = 599;
export const MAX_UNITS = 100;
export const isUnitId = (id: number) => Number.isInteger(id) && id >= MIN_UNIT_ID && id <= MAX_UNIT_ID && (id < 300 || id >= 400);

/** Short column labels; English ones follow the game's English names. */
const SHORT: Record<UnitLang, Record<number, string>> = {
  de: {
    202: 'KT', 203: 'GT', 204: 'LJ', 205: 'SJ', 206: 'Xer', 207: 'SS', 208: 'Kolo', 209: 'Rec', 210: 'Spy', 211: 'B', 212: 'Sat',
    213: 'Zerri', 214: 'RIP', 215: 'SXer', 222: 'HXer', 225: 'ST', 227: 'ORec', 231: 'Beh', 232: 'VT',
    401: 'RW', 402: 'LL', 403: 'SL', 404: 'Gauß', 405: 'Ion', 406: 'Plas', 407: 'kSK', 408: 'gSK', 502: 'AR', 503: 'IPR',
  },
  en: {
    202: 'LC', 203: 'HC', 204: 'LF', 205: 'HF', 206: 'Cr', 207: 'BS', 208: 'Col', 209: 'Rec', 210: 'Probe', 211: 'Bomb', 212: 'Sat',
    213: 'Dest', 214: 'RIP', 215: 'BC', 222: 'HCr', 225: 'ST', 227: 'ORec', 231: 'Beh', 232: 'VT',
    401: 'ML', 402: 'LL', 403: 'HL', 404: 'Gauss', 405: 'Ion', 406: 'Plas', 407: 'SSD', 408: 'LSD', 502: 'ABM', 503: 'IPM',
  },
};

function defaults(): Record<string, UnitDef> {
  const names = techData as Record<string, Record<string, string>>;
  const costs = costData as Record<string, number[]>;
  const ships = shipData as Record<string, { one: boolean; req: Record<string, number> }>;
  const combat = combatData as Record<string, { attack: number; shield: number; rapidfire: Record<string, number> }>;
  const out: Record<string, UnitDef> = {};
  for (const [key, meta] of Object.entries(ships)) {
    const id = Number(key);
    const live = LIVE_UNITS[id];
    const base = combat[key];
    const rapidfire: Record<string, number> = { ...(live?.rapidfire ?? base?.rapidfire ?? {}) };
    Object.assign(rapidfire, LIVE_RAPIDFIRE_AGAINST[id]);
    const [m = 0, k = 0, d = 0] = costs[key] ?? [];
    const drives = DRIVES[id];
    out[key] = {
      id,
      name: { de: names.de[key] ?? `#${id}`, en: names.en[key] ?? names.de[key] ?? `#${id}` },
      short: { de: SHORT.de[id] ?? names.de[key] ?? `#${id}`, en: SHORT.en[id] ?? names.en[key] ?? `#${id}` },
      cost: [m, k, d],
      req: { ...meta.req },
      one: meta.one,
      attack: live?.attack ?? base?.attack ?? 0,
      shield: live?.shield ?? base?.shield ?? 0,
      rapidfire,
      capacity: CAPACITY[id] ?? 0,
      drives: drives ? { speed: [...drives.speed], tech: [...drives.tech], consumption: [...drives.consumption] } : null,
    };
  }
  return out;
}

/** The defaults by id, including units a universe may hide. */
export const DEFAULT_UNIT_DEFS: Readonly<Record<string, UnitDef>> = defaults();

/**
 * Units some universes have but the defaults do not (test server, 2026-11): the start of a new unit with that id
 * (admin, tools' editor, pasted pages). Names and costs from the test server's defense page, requirements given by
 * the project owner; attack, shield and rapidfire still unknown (0, from the info pages once pasted).
 */
const KNOWN: Record<number, Pick<UnitDef, 'name' | 'short' | 'cost' | 'req'>> = {
  412: { name: { de: 'Bunker', en: 'Bunker' }, short: { de: 'Bunk', en: 'Bunk' }, cost: [9000, 1000, 0], req: { 21: 5, 111: 6 } },
  413: { name: { de: 'Titan Laser', en: 'Titan Laser' }, short: { de: 'TL', en: 'TL' }, cost: [54000, 18000, 0], req: { 21: 7, 109: 6, 113: 6, 120: 6 } },
  414: { name: { de: 'Decoy', en: 'Decoy' }, short: { de: 'Decoy', en: 'Decoy' }, cost: [100, 0, 0], req: { 21: 2 } },
};
export const KNOWN_UNIT_IDS: readonly number[] = Object.keys(KNOWN).map(Number);

/** A unit that is new in a universe: the known values of its id, else empty. */
export function emptyUnit(id: number): UnitDef {
  const known = KNOWN[id];
  if (known) return { ...emptyUnit(0), ...JSON.parse(JSON.stringify(known)), id };
  return {
    id,
    name: { de: `#${id}`, en: `#${id}` },
    short: { de: `#${id}`, en: `#${id}` },
    cost: [0, 0, 0],
    req: {},
    one: false,
    attack: 0,
    shield: 0,
    rapidfire: {},
    capacity: 0,
    drives: null,
  };
}

function build(overrides: UnitOverrides, key: string): UnitCatalog {
  const units: Record<string, UnitDef> = {};
  const ids = new Set([...Object.keys(DEFAULT_UNIT_DEFS), ...Object.keys(overrides)]);
  for (const key of ids) {
    const patch = overrides[key];
    if (patch?.hidden) continue;
    const id = Number(key);
    if (!isUnitId(id)) continue;
    const base = DEFAULT_UNIT_DEFS[key] ?? emptyUnit(id);
    const { hidden: _, ...fields } = patch ?? {};
    const unit: UnitDef = { ...base, ...fields, id } as UnitDef;
    unit.name = { ...base.name, ...fields.name };
    unit.short = { ...base.short, ...fields.short };
    units[key] = unit;
  }
  const sorted = Object.keys(units).map(Number).sort((a, b) => a - b);
  const drives: Record<string, ShipDrives> = {};
  const capacity: Record<number, number> = {};
  for (const id of sorted) {
    const u = units[id];
    if (u.drives) drives[id] = u.drives;
    if (u.capacity) capacity[id] = u.capacity;
  }
  return deepFreeze({
    key,
    units,
    ids: sorted,
    ships: sorted.filter((id) => id < 300),
    defense: sorted.filter((id) => id >= 400),
    drives,
    capacity,
  });
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const cache = new Map<string, UnitCatalog>();

/** Catalog of a universe from its overrides (cached by their JSON). */
export function unitCatalog(overrides: UnitOverrides | null | undefined): UnitCatalog {
  const key = JSON.stringify(overrides ?? {});
  let c = cache.get(key);
  if (!c) {
    if (cache.size > 50) cache.clear();
    // a copy: the catalog is frozen and must not freeze (or share) the caller's objects
    c = build(JSON.parse(key) as UnitOverrides, key);
    cache.set(key, c);
  }
  return c;
}

export const DEFAULT_UNITS: UnitCatalog = unitCatalog({});

let active: UnitCatalog = DEFAULT_UNITS;

/** The catalog that functions use when none is passed. */
export const activeUnits = (): UnitCatalog => active;

/** Sets the active catalog (web app: the selected universe; battle worker: the job's universe). */
export function setActiveUnits(catalog: UnitCatalog | null | undefined): void {
  active = catalog ?? DEFAULT_UNITS;
}

const isThenable = (v: unknown): boolean => !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as { then?: unknown }).then === 'function';

/**
 * Runs `fn` synchronously with `catalog` as the active catalog (server: one universe per call). `fn` must not be
 * async: after an `await` the catalog would already be reset, or leak into other requests meanwhile. A promise
 * returned by `fn` throws.
 */
export function withUnits<T>(catalog: UnitCatalog | null | undefined, fn: () => T): T {
  const check = (out: T): T => {
    if (isThenable(out)) throw new Error('withUnits: fn must be synchronous (the active catalog does not survive an await)');
    return out;
  };
  if (!catalog || catalog === active) return check(fn());
  const before = active;
  active = catalog;
  try {
    return check(fn());
  } finally {
    active = before;
  }
}

/** Cost of one unit [metal, crystal, deuterium] in the active catalog, or undefined. */
export function unitCost(id: number | string, catalog: UnitCatalog = active): readonly [number, number, number] | undefined {
  return catalog.units[String(id)]?.cost;
}

/** Fields of a unit that differ from `base` (for storing a form as overrides). */
export function unitPatch(unit: UnitDef, base: UnitDef | undefined): UnitPatch {
  if (!base) {
    const { id: _, ...all } = unit;
    return all;
  }
  const patch: UnitPatch = {};
  for (const key of Object.keys(unit) as (keyof UnitDef)[]) {
    if (key === 'id') continue;
    if (JSON.stringify(unit[key]) !== JSON.stringify(base[key])) (patch as Record<string, unknown>)[key] = unit[key];
  }
  return patch;
}

const num = (v: unknown, max = 1e12) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 64;
const levels = (v: unknown, ok: (id: number) => boolean, max: number) =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 100
  && Object.entries(v).every(([k, n]) => ok(Number(k)) && num(n, max) && Number.isInteger(n));

/**
 * Checks stored overrides; returns the first problem as a path ("222.cost") or null. Requirements name buildings or
 * research (0-199), rapidfire targets units.
 */
export function validateUnits(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_UNITS) return 'size';
  for (const [key, patch] of entries) {
    const id = Number(key);
    if (!isUnitId(id) || String(id) !== key) return key;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return key;
    const p = patch as Record<string, unknown>;
    for (const [field, v] of Object.entries(p)) {
      const bad = `${key}.${field}`;
      switch (field) {
        case 'hidden':
        case 'one':
          if (typeof v !== 'boolean') return bad;
          break;
        case 'name':
        case 'short':
          if (!v || typeof v !== 'object' || Object.entries(v).some(([l, s]) => (l !== 'de' && l !== 'en') || !str(s))) return bad;
          break;
        case 'cost':
          if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => num(n) && Number.isInteger(n))) return bad;
          break;
        case 'req':
          if (!levels(v, (r) => Number.isInteger(r) && r >= 1 && r < 200, 1000)) return bad;
          break;
        case 'rapidfire':
          if (!levels(v, isUnitId, 100000)) return bad;
          break;
        case 'attack':
        case 'shield':
        case 'capacity':
          if (!num(v)) return bad;
          break;
        case 'drives': {
          if (v === null) break;
          const d = v as Record<string, unknown>;
          const triple = (a: unknown) => Array.isArray(a) && a.length === 3 && a.every((n) => num(n) && Number.isInteger(n));
          if (!d || typeof d !== 'object' || !triple(d.speed) || !triple(d.tech) || !triple(d.consumption)) return bad;
          break;
        }
        default:
          return bad;
      }
    }
    if (!DEFAULT_UNIT_DEFS[key] && !p.hidden && (!p.name || !p.cost)) return `${key}.name`;
  }
  return null;
}
