/**
 * Settings of a universe as a hub admin sets them (the game configuration the hub needs): one contract for the
 * server (stored JSON merged over `UNIVERSE_DEFAULTS`), the web app, the admin form and the tools' share links.
 */
import type { UnitOverrides } from './units.js';
import { validateUnits } from './units.js';
import { localToEpoch } from './util.js';

export interface UniverseSettings {
  galaxies: number;
  systems: number;
  positions: number;
  /** wrap-around for galaxy / system distance (uni_type / galaxy_type == 1) */
  circularGalaxies: boolean;
  circularSystems: boolean;
  galaxyDistanceFactor: number;
  systemDistanceFactor: number;
  systemDistance: number;
  planetDistanceFactor: number;
  planetDistance: number;
  /** game config fleet_speed (2500 = 1x) */
  fleetSpeed: number;
  /** game config building_speed (2500 = 1x) for build times; 0 unknown (derived from a synced buildings page) */
  buildingSpeed: number;
  /** game config research_speed (2500 = 1x) for research times; 0 unknown (derived from a synced research page) */
  researchSpeed: number;
  /** game config shipyard_speed (2500 = 1x) for shipyard build times; 0 unknown */
  shipyardSpeed: number;
  /** game config resource_multiplier (2500 = 1x) for resource production; 0 unknown */
  resourceMultiplier: number;
  /** game config storage_multiplier: capacity factor when not derived from a synced page */
  storageMultiplier: number;
  /** game config factor_university: research time −% per TechnoDome level (game default 8) */
  universityFactor: number;
  timezone: string;
  /** game base URL incl. universe path, e.g. https://pr0game.com/uni8/ (for simulator links) */
  gameUrl: string;
  /** pr0plan (build order planner) linked from the build order tab */
  pr0planUrl: string;

  // Optional: unset means the default in `OPTIONAL_DEFAULTS` (or, for the battle values, the tool's own value).
  /** days without login until the game flags a player inactive (see `inactiveDaysOf`) */
  inactiveDays?: number;
  /** game config phalanx_range_factor */
  phalanxRangeFactor?: number;
  /**
   * The game's weekly cleaner (`CleanerCronjob`, default Saturday 02:45 server time): it marks all debris fields
   * inactive, so a harvested empty field can no longer be flown to until a battle leaves debris there again. Weekday
   * like cron (0 Sunday … 6 Saturday), hour and minute in the universe's time zone.
   */
  debrisCleanupDay?: number;
  debrisCleanupHour?: number;
  debrisCleanupMinute?: number;
  /** game config missile_range_factor (passed on to the IPM calculator) */
  missileRangeFactor?: number;
  /** game config noob_protection_time (points; 0 unknown) */
  noobLimit?: number;
  /** game config noob_protection_multi */
  noobFactor?: number;
  /** game config noob_inactives */
  noobInactives?: boolean;
  /** game config fleet_debris_percentage */
  fleetDebrisPercent?: number;
  /** game config def_debris_percentage */
  defenseDebrisPercent?: number;
  /** shield domes must fall before other units can be hit */
  bigShields?: boolean;
  /**
   * Resources of a new planet (game config metal_start, crystal_start, deuterium_start): build orders planned before
   * the start or for planets without coordinates begin with them.
   */
  metalStart?: number;
  crystalStart?: number;
  deuteriumStart?: number;
  /** game config planet_size_factor: fields of new colonies (colonization planner) */
  planetSizeFactor?: number;
  /**
   * Planet limit of the game (`PlayerUtil::maxPlanetCount`): game config max_initial_planets, max_additional_planets
   * and planets_per_tech. Unlike the other optional settings they are not assumed when unset: `planetLimit` only
   * answers when an admin entered all three (a wrong guess would hide the warning of a colony save).
   */
  maxInitialPlanets?: number;
  maxAdditionalPlanets?: number;
  planetsPerTech?: number;
  /**
   * Production bonus of new colonies per position in percent, metal, crystal, deuterium (the game's `planet_data`
   * bonus columns, only with `planet_ressource_bonus`; not on any page players see): position → [m, k, d].
   */
  positionBonus?: Record<string, [number, number, number]>;
  /** legacy: the flight calculator of the tools (their base is taken from it); the server's TOOLS_URL is preferred */
  flightCalculatorUrl?: string;
}

export const UNIVERSE_DEFAULTS: UniverseSettings = {
  galaxies: 4,
  systems: 400,
  positions: 15,
  circularGalaxies: true,
  circularSystems: true,
  galaxyDistanceFactor: 20000,
  systemDistanceFactor: 95,
  systemDistance: 2700,
  planetDistanceFactor: 5,
  planetDistance: 1000,
  fleetSpeed: 2500,
  buildingSpeed: 0,
  researchSpeed: 0,
  shipyardSpeed: 0,
  resourceMultiplier: 0,
  storageMultiplier: 1,
  universityFactor: 8,
  timezone: 'Europe/Berlin',
  gameUrl: '',
  pr0planUrl: 'https://pr0sync.pages.dev/',
};

/** Values the optional settings stand for when unset (validation types, admin placeholders, calculations). */
export const OPTIONAL_DEFAULTS = {
  inactiveDays: 7,
  phalanxRangeFactor: 1,
  debrisCleanupDay: 6,
  debrisCleanupHour: 2,
  debrisCleanupMinute: 45,
  missileRangeFactor: 1,
  noobLimit: 0,
  noobFactor: 5,
  noobInactives: false,
  fleetDebrisPercent: 40,
  defenseDebrisPercent: 0,
  bigShields: false,
  planetSizeFactor: 1,
  metalStart: 5000,
  crystalStart: 1500,
  deuteriumStart: 0,
  // game defaults, for validation and the admin form's placeholders only (see `planetLimit`)
  maxInitialPlanets: 1,
  maxAdditionalPlanets: 11,
  planetsPerTech: 0.5,
} satisfies Partial<Record<keyof UniverseSettings, number | boolean>>;

/** Days without login until the game flags a player inactive, when the universe does not set it. */
export const INACTIVE_DAYS = OPTIONAL_DEFAULTS.inactiveDays;
export const inactiveDaysOf = (s: Pick<UniverseSettings, 'inactiveDays'>) => Number(s.inactiveDays) || INACTIVE_DAYS;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The newest run of the game's weekly debris cleaner at or before `t` (Unix seconds), by the universe's
 * `debrisCleanup*` settings in its time zone: empty debris fields known to be active (a battle left debris) only count
 * after it.
 */
export function lastDebrisCleanup(s: Pick<UniverseSettings, 'timezone' | 'debrisCleanupDay' | 'debrisCleanupHour' | 'debrisCleanupMinute'>, t: number): number {
  const day = s.debrisCleanupDay ?? OPTIONAL_DEFAULTS.debrisCleanupDay;
  const hour = s.debrisCleanupHour ?? OPTIONAL_DEFAULTS.debrisCleanupHour;
  const minute = s.debrisCleanupMinute ?? OPTIONAL_DEFAULTS.debrisCleanupMinute;
  const tz = s.timezone || 'Europe/Berlin';
  const format = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const pad = (n: number) => String(n).padStart(2, '0');
  for (let back = 0; back <= 8; back++) {
    const parts = Object.fromEntries(format.formatToParts(new Date((t - back * 86400) * 1000)).map((p) => [p.type, p.value]));
    if (WEEKDAYS.indexOf(parts.weekday) !== day) continue;
    const at = localToEpoch(`${parts.year}-${parts.month}-${parts.day} ${pad(hour)}:${pad(minute)}:00`, tz);
    if (at <= t) return at;
  }
  return t - 7 * 86400;
}

/** Resources of a new planet (901-903) by the universe's settings. */
export const startResourcesOf = (s: Pick<UniverseSettings, 'metalStart' | 'crystalStart' | 'deuteriumStart'>): Record<number, number> => ({
  901: s.metalStart ?? OPTIONAL_DEFAULTS.metalStart,
  902: s.crystalStart ?? OPTIONAL_DEFAULTS.crystalStart,
  903: s.deuteriumStart ?? OPTIONAL_DEFAULTS.deuteriumStart,
});

/** Astrophysics: its level raises the planet limit. */
export const ASTROPHYSICS = 124;

/**
 * Most planets a player with astrophysics level `astro` may own, like the game's `PlayerUtil::maxPlanetCount`
 * (0 initial planets lifts the cap of the additional ones). A colonization arriving at or above it founds nothing
 * and the fleet flies home. Null when the universe does not set all three values.
 */
export function planetLimit(s: Pick<UniverseSettings, 'maxInitialPlanets' | 'maxAdditionalPlanets' | 'planetsPerTech'>, astro: number): number | null {
  if (s.maxInitialPlanets == null || s.maxAdditionalPlanets == null || s.planetsPerTech == null) return null;
  const additional = s.maxInitialPlanets === 0 ? 999 : s.maxAdditionalPlanets;
  return Math.ceil(s.maxInitialPlanets + Math.min(additional, astro * s.planetsPerTech));
}

/** Stored settings over the defaults (unknown keys are kept, like the stored JSON). */
export const universeSettings = (stored: Partial<UniverseSettings> | null | undefined): UniverseSettings => ({ ...UNIVERSE_DEFAULTS, ...(stored ?? {}) });

export interface SettingError {
  code: 'timezone_invalid' | 'game_url_invalid' | 'pr0plan_url_invalid' | 'setting_invalid';
  message: string;
}

const KNOWN: Record<string, unknown> = { ...UNIVERSE_DEFAULTS, ...OPTIONAL_DEFAULTS };
/** at least 1 and whole */
const COUNTS = ['galaxies', 'systems', 'positions', 'fleetSpeed', 'storageMultiplier'];
/** whole numbers from 0 */
const WHOLE = ['maxInitialPlanets', 'maxAdditionalPlanets', 'metalStart', 'crystalStart', 'deuteriumStart'];
/** whole numbers with an upper bound */
const BOUNDED: Record<string, number> = { debrisCleanupDay: 6, debrisCleanupHour: 23, debrisCleanupMinute: 59 };
/** percentages */
const PERCENT = ['universityFactor', 'fleetDebrisPercent', 'defenseDebrisPercent'];
const URLS: Record<string, SettingError> = {
  gameUrl: { code: 'game_url_invalid', message: 'Game URL must start with http(s)://' },
  pr0planUrl: { code: 'pr0plan_url_invalid', message: 'pr0plan URL must start with http(s)://' },
};

/**
 * Checks settings an admin sends (all or some of them): types by the defaults, counts ≥ 1, numbers ≥ 0, percentages
 * ≤ 100, a known time zone and http(s) URLs. `null` (reset) is allowed for the optional settings. Null when valid.
 */
export function settingsError(settings: object | null | undefined): SettingError | null {
  if (!settings) return null;
  const s = settings as Record<string, unknown>;
  if (s.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: String(s.timezone) });
    } catch {
      return { code: 'timezone_invalid', message: 'Invalid time zone' };
    }
  }
  for (const [key, err] of Object.entries(URLS)) if (s[key] && !/^https?:\/\//i.test(String(s[key]))) return err;
  if (s.positionBonus != null) {
    const pb = s.positionBonus as Record<string, unknown>;
    const valid =
      typeof pb === 'object' &&
      !Array.isArray(pb) &&
      Object.entries(pb).every(
        ([pos, v]) => /^\d{1,2}$/.test(pos) && Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= -100 && x <= 1000),
      );
    if (!valid) return { code: 'setting_invalid', message: 'Invalid setting: positionBonus' };
  }
  for (const [key, value] of Object.entries(s)) {
    if (key === 'positionBonus') continue;
    if (value === null && !(key in UNIVERSE_DEFAULTS)) continue;
    let valid = true;
    if (typeof KNOWN[key] === 'boolean') valid = typeof value === 'boolean';
    else if (typeof KNOWN[key] === 'number') {
      valid = typeof value === 'number' && Number.isFinite(value) && value >= 0;
      if (COUNTS.includes(key)) valid &&= Number.isInteger(value) && (value as number) >= 1;
      // above 100 % research times turn negative / more than everything goes into the debris field
      if (PERCENT.includes(key)) valid &&= (value as number) <= 100;
      if (WHOLE.includes(key)) valid &&= Number.isInteger(value);
      if (key in BOUNDED) valid &&= Number.isInteger(value) && (value as number) <= BOUNDED[key];
    }
    if (!valid) return { code: 'setting_invalid', message: `Invalid setting: ${key}` };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- tools' share links

/**
 * Universe values in the tools' share links: the tools' setting key (snake case like the game config) → hash key.
 * Keys without a hub setting (expedition hold, honour boost, moon values, market rates) are the tools' own.
 */
export const TOOL_HASH = {
  uni_type: 'ut', galaxy_type: 'gt', max_galaxy: 'mg', max_system: 'ms', max_planets: 'mp',
  galaxy_distance_factor: 'gdf', system_distance_factor: 'sdf', system_distance: 'sd',
  planet_distance_factor: 'pdf', planet_distance: 'pd', game_speed: 'gs',
  expo_hold_multiplier: 'ehm', honor_boost: 'hb',
  fleet_debris: 'fd', defense_debris: 'dd', moon_factor: 'mf', max_moon_chance: 'mc', big_shields: 'bs',
  rate_metal: 'rm', rate_crystal: 'rk',
} as const;
export type ToolHashKey = (typeof TOOL_HASH)[keyof typeof TOOL_HASH];

/**
 * The hub's settings as tool hash values: layout, distances and fleet speed always, the battle values when the
 * universe sets them (else the tool keeps its own).
 */
export function toolsHash(u: UniverseSettings): Partial<Record<ToolHashKey, number>> {
  const out: Partial<Record<ToolHashKey, number>> = {
    ut: u.circularGalaxies ? 1 : 0,
    gt: u.circularSystems ? 1 : 0,
    mg: u.galaxies,
    ms: u.systems,
    mp: u.positions,
    gdf: u.galaxyDistanceFactor,
    sdf: u.systemDistanceFactor,
    sd: u.systemDistance,
    pdf: u.planetDistanceFactor,
    pd: u.planetDistance,
    gs: u.fleetSpeed / 2500,
  };
  if (u.fleetDebrisPercent != null) out.fd = u.fleetDebrisPercent;
  if (u.defenseDebrisPercent != null) out.dd = u.defenseDebrisPercent;
  if (u.bigShields != null) out.bs = u.bigShields ? 1 : 0;
  return out;
}

/** Hash key of a universe's own unit values in the tools' links. */
export const UNITS_HASH = 'uo';

/** `uo` value: the unit overrides as base64url JSON (UTF-8); '' without any. */
export function encodeUnitOverrides(overrides: UnitOverrides | null | undefined): string {
  if (!overrides || !Object.keys(overrides).length) return '';
  const bytes = new TextEncoder().encode(JSON.stringify(overrides));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Overrides of a `uo` value, or null when it is not valid. */
export function decodeUnitOverrides(text: string | null | undefined): UnitOverrides | null {
  if (!text) return null;
  try {
    const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return validateUnits(value) == null ? (value as UnitOverrides) : null;
  } catch {
    return null;
  }
}
