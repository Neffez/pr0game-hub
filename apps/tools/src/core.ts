/**
 * Flight calculator core: the calculator's own data shapes (universe settings as in the game config, ships with
 * speed1-3/tech1-3/consumption1-3, custom ships) on top of @pr0hub/flight, plus the input parsers.
 */
import {
  delayedFlightTimes,
  distance,
  fleetConsumption,
  flightDuration,
  flightTimes,
  flightTimesFromArrival,
  recallFor as libRecallFor,
  recallHome,
  shipSpeed,
  slowestShip,
  type Drives,
  type FlightTimes,
  type ShipCatalog,
  type Universe,
} from '@pr0hub/flight';
import { TECH_NAMES } from '@pr0hub/core/tech';
import { activeUnits, DEFAULT_UNIT_DEFS, type UnitOverrides } from '@pr0hub/core/units';

/** Universe settings with the game's config keys (kept for stored settings and share links). */
export interface UniSettings {
  /** galaxies: 0 linear, 1 ring, 2 sphere */
  uni_type: number;
  /** systems: 0 linear, 1 ring, 2 sphere */
  galaxy_type: number;
  max_galaxy: number;
  max_system: number;
  max_planets: number;
  galaxy_distance_factor: number;
  system_distance_factor: number;
  system_distance: number;
  planet_distance_factor: number;
  planet_distance: number;
  /** 1 = normal (game config fleet_speed / 2500) */
  game_speed: number;
  expo_hold_multiplier: number;
  honor_boost: number;
  clock_offset: number;
}

export const DEFAULT_UNI: UniSettings = {
  uni_type: 0,
  galaxy_type: 0,
  max_galaxy: 9,
  max_system: 400,
  max_planets: 15,
  galaxy_distance_factor: 20000,
  system_distance_factor: 95,
  system_distance: 2700,
  planet_distance_factor: 5,
  planet_distance: 1000,
  game_speed: 1,
  expo_hold_multiplier: 1,
  honor_boost: 1,
  clock_offset: 0,
};

export interface Ship {
  id: number | string;
  /** English name (fallback) */
  name: string;
  /** names by language (unit catalog) */
  names?: Record<'de' | 'en', string>;
  /** a unit the tools' own values add (not one of the hub's defaults) */
  custom?: boolean;
  speed1: number;
  speed2: number;
  speed3: number;
  tech1: number;
  tech2: number;
  tech3: number;
  consumption1: number;
  consumption2: number;
  consumption3: number;
}

/**
 * Element name in the page language: units by the active unit catalog (own values), short names (tight spots) the
 * game's short names of the battle reports where there are some.
 */
export function elementLabel(id: number, lang: 'de' | 'en', short = false): string {
  const names = TECH_NAMES as unknown as Record<string, Record<string, string>>;
  const unit = activeUnits().units[id];
  if (short && names[`${lang}Short`]?.[id] && (!unit || unit.name[lang] === names[lang]?.[id])) return names[`${lang}Short`][id];
  return unit?.name[lang] ?? names[lang]?.[id] ?? String(id);
}

/** Ship name in the page language. */
export function shipLabel(ship: Pick<Ship, 'id' | 'name' | 'names'>, lang: 'de' | 'en'): string {
  return ship.names?.[lang] ?? ship.name;
}

/** Flying ships of the active unit catalog (with the tools' own values); reassigned by rebuildShips (live bindings). */
export let SHIPS: Ship[] = [];
export let SHIP_BY_ID: Record<string, Ship> = {};
let CATALOG: ShipCatalog = {};

/** Takes the ships with drives from the active unit catalog (after the own values changed). */
export function rebuildShips(): void {
  const units = activeUnits();
  CATALOG = { ...units.drives };
  SHIPS = Object.keys(units.drives).map(Number).sort((a, b) => a - b).map((id) => {
    const u = units.units[id];
    const d = units.drives[id];
    return {
      id,
      name: u.name.en,
      names: { ...u.name },
      custom: !DEFAULT_UNIT_DEFS[id],
      speed1: d.speed[0],
      speed2: d.speed[1],
      speed3: d.speed[2],
      tech1: d.tech[0],
      tech2: d.tech[1],
      tech3: d.tech[2],
      consumption1: d.consumption[0],
      consumption2: d.consumption[1],
      consumption3: d.consumption[2],
    };
  });
  SHIP_BY_ID = {};
  for (const ship of SHIPS) SHIP_BY_ID[ship.id] = ship;
}
rebuildShips();

/** Custom ships of older versions (`pr0fc.ships.v1`, link key `cs`): ids "c1", "c2" … with speed1-3/tech1-3/consumption1-3. */
export interface LegacyShip {
  id: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Turns custom ships of older versions into new units of the unit catalog: free ids from 299 down, the drives as
 * entered, no costs. Returns the units and the old id → new id.
 */
export function legacyShipUnits(list: unknown, taken: (id: number) => boolean): { units: UnitOverrides; ids: Record<string, number> } {
  const units: UnitOverrides = {};
  const ids: Record<string, number> = {};
  let next = 299;
  for (const raw of Array.isArray(list) ? list : []) {
    const c = raw as LegacyShip;
    if (!c || !/^c\d+$/.test(String(c.id))) continue;
    while (next >= 200 && (taken(next) || units[next])) next--;
    if (next < 200) break;
    const v = (key: string) => Math.max(0, Math.floor(Number(c[key]) || 0));
    const name = String(c.name || c.id).trim().slice(0, 40) || String(c.id);
    units[next] = {
      name: { de: name, en: name },
      short: { de: name.slice(0, 6).trim(), en: name.slice(0, 6).trim() },
      cost: [0, 0, 0],
      drives: { speed: [v('speed1'), v('speed2'), v('speed3')], tech: [v('tech1'), v('tech2'), v('tech3')], consumption: [v('consumption1'), v('consumption2'), v('consumption3')] },
    };
    ids[c.id] = next;
  }
  return { units, ids };
}

export const STAY_PRESETS: Record<string, number[]> = {
  hold: [1, 2, 4, 8, 12, 16, 32],
  trade: [1, 2, 4, 8, 12, 24, 48, 168],
};

export interface Coords {
  g: number;
  s: number;
  p: number;
}

export type Techs = Drives;
export type Amounts = Record<string, number | string>;

function universe(cfg: UniSettings): Universe {
  return {
    galaxies: Number(cfg.max_galaxy),
    systems: Number(cfg.max_system),
    circularGalaxies: Number(cfg.uni_type) === 1,
    circularSystems: Number(cfg.galaxy_type) === 1,
    sphereGalaxies: Number(cfg.uni_type) === 2,
    sphereSystems: Number(cfg.galaxy_type) === 2,
    galaxyDistanceFactor: Number(cfg.galaxy_distance_factor),
    systemDistanceFactor: Number(cfg.system_distance_factor),
    systemDistance: Number(cfg.system_distance),
    planetDistanceFactor: Number(cfg.planet_distance_factor),
    planetDistance: Number(cfg.planet_distance),
    fleetSpeed: gameSpeedConfig(cfg.game_speed),
  };
}

/** Game speed factor (1 = normal) -> game config fleet_speed. */
const gameSpeedConfig = (gameSpeed: number) => (Number(gameSpeed) || 1) * 2500;

const techs = (t: Partial<Techs>): Techs => ({
  combustion: Number(t.combustion) || 0,
  impulse: Number(t.impulse) || 0,
  hyperspace: Number(t.hyperspace) || 0,
  fuelEfficiency: Number(t.fuelEfficiency) || 0,
});

/** Numeric amounts of the ships in the catalog. */
function fleet(amounts: Amounts): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of activeShips(amounts)) out[id] = Number(amounts[id]);
  return out;
}

export const getTargetDistance = (start: Coords, target: Coords, cfg: UniSettings) =>
  distance(universe(cfg), [start.g, start.s, start.p], [target.g, target.s, target.p]);

export const getShipSpeed = (ship: Ship, t: Partial<Techs>) => shipSpeed(ship.id, techs(t), CATALOG);

export function activeShips(amounts: Amounts): string[] {
  return Object.keys(amounts).filter((id) => Number(amounts[id]) > 0 && SHIP_BY_ID[id]);
}

/** Slowest ship of the fleet; speed 0 and id null when empty. */
export function getFleetSlowest(amounts: Amounts, t: Partial<Techs>): { speed: number; id: string | null } {
  return slowestShip(fleet(amounts), techs(t), CATALOG) ?? { speed: 0, id: null };
}

/** One-way duration in seconds (float). speedFactor 1-10 (10 = 100 %). */
export const getMissionDuration = (speedFactor: number, maxFleetSpeed: number, dist: number, gameSpeed: number) =>
  flightDuration({ fleetSpeed: gameSpeedConfig(gameSpeed) }, dist, maxFleetSpeed, speedFactor * 10);

export const getFleetConsumption = (
  amounts: Amounts,
  duration: number,
  dist: number,
  t: Partial<Techs>,
  gameSpeed: number,
  honorBoost: number,
) => fleetConsumption({ fleetSpeed: gameSpeedConfig(gameSpeed) }, fleet(amounts), duration, dist, techs(t), honorBoost || 1, CATALOG);

export interface Times {
  start: number;
  arrival: number;
  stayEnd: number;
  home: number;
}

export const getTimestamps = (departure: number, duration: number, staySeconds: number): Times =>
  flightTimes(departure, duration, staySeconds);
export const getTimestampsFromArrival = (arrival: number, duration: number, staySeconds: number): Times =>
  flightTimesFromArrival(arrival, duration, staySeconds);
/** Enemy fleet arriving at `shown`; `orig` is its arrival before any ACS delay. */
export const getDelayedTimestamps = (shown: number, orig: number, duration: number, staySeconds: number): Times =>
  delayedFlightTimes(shown, orig, duration, staySeconds);

export const abortHome = (recall: number, t: FlightTimes, holdAbortable: boolean) => recallHome(recall, t, holdAbortable);

/** Inverse of abortHome; keeps the calculator's reason key `no_abort_needed`. */
export function recallFor(wanted: number, t: FlightTimes, holdAbortable: boolean) {
  const r = libRecallFor(wanted, t, holdAbortable);
  return r.recall === null && r.reason === 'no_recall_needed' ? { recall: null, reason: 'no_abort_needed' as const } : r;
}

export function mkDate(y: number, mo: number, d: number, h: number, mi: number, s: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (date.getDate() !== d) return null;
  return Math.floor(date.getTime() / 1000);
}

export function nearest(candidates: (number | null)[], now: number): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    if (c !== null && (best === null || Math.abs(c - now) < Math.abs(best - now))) best = c;
  }
  return best;
}

/**
 * Parses absolute and relative time input into unix seconds.
 * Time-only and year-less input resolves to the occurrence nearest to now.
 */
export function parseTimeInput(raw: unknown, now: number): number | null {
  const str = String(raw || '').trim().toLowerCase();
  if (!str) return null;
  let m = str.match(/^([+-]|in\s+|vor\s+)?\s*(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/);
  if (m && (m[2] || m[3] || m[4] || m[5])) {
    const secs = Number(m[2] || 0) * 86400 + Number(m[3] || 0) * 3600 + Number(m[4] || 0) * 60 + Number(m[5] || 0);
    const neg = m[1] && (m[1].trim() === '-' || m[1].trim() === 'vor');
    return now + (neg ? -secs : secs);
  }
  m = str.match(/^([+-]|in\s+|vor\s+)\s*(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (m) {
    const rel = Number(m[2] || 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
    const back = m[1].trim() === '-' || m[1].trim() === 'vor';
    return now + (back ? -rel : rel);
  }
  m = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})[t\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return mkDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
  m = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?[\s,]*(?:um\s+|at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const d = m;
    if (d[3]) {
      const year = +d[3] < 100 ? 2000 + +d[3] : +d[3];
      return mkDate(year, +d[2], +d[1], +d[4], +d[5], +(d[6] || 0));
    }
    const nowYear = new Date(now * 1000).getFullYear();
    return nearest([nowYear - 1, nowYear, nowYear + 1].map((y) => mkDate(y, +d[2], +d[1], +d[4], +d[5], +(d[6] || 0))), now);
  }
  m = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const d = m;
    const base = new Date(now * 1000);
    return nearest(
      [-1, 0, 1].map((offset) => {
        const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
        return mkDate(day.getFullYear(), day.getMonth() + 1, day.getDate(), +d[1], +d[2], +(d[3] || 0));
      }),
      now,
    );
  }
  return null;
}

/** "1.234" -> 1234, "2,5k" -> 2500, "1m" -> 1000000. */
export function parseAmount(raw: unknown): number {
  const str = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!str) return 0;
  const m = str.match(/^(\d+(?:[.,]\d+)?)([km])$/);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * (m[2] === 'k' ? 1e3 : 1e6));
  if (/^[\d.,]+$/.test(str)) return parseInt(str.replace(/[.,]/g, ''), 10) || 0;
  return NaN;
}

export function parseCoords(raw: unknown): Coords | null {
  const m = String(raw || '').match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m ? { g: +m[1], s: +m[2], p: +m[3] } : null;
}
