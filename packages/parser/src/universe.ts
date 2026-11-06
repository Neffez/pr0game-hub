/**
 * Settings of a universe as a hub admin sets them (the game configuration the hub needs): one contract for the
 * server (stored JSON merged over `UNIVERSE_DEFAULTS`), the web app, the admin form and the tools' share links.
 */
import type { UnitOverrides } from './units.js';
import { validateUnits } from './units.js';

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
  missileRangeFactor: 1,
  noobLimit: 0,
  noobFactor: 5,
  noobInactives: false,
  fleetDebrisPercent: 40,
  defenseDebrisPercent: 0,
  bigShields: false,
} satisfies Partial<Record<keyof UniverseSettings, number | boolean>>;

/** Days without login until the game flags a player inactive, when the universe does not set it. */
export const INACTIVE_DAYS = OPTIONAL_DEFAULTS.inactiveDays;
export const inactiveDaysOf = (s: Pick<UniverseSettings, 'inactiveDays'>) => Number(s.inactiveDays) || INACTIVE_DAYS;

/** Stored settings over the defaults (unknown keys are kept, like the stored JSON). */
export const universeSettings = (stored: Partial<UniverseSettings> | null | undefined): UniverseSettings => ({ ...UNIVERSE_DEFAULTS, ...(stored ?? {}) });

export interface SettingError {
  code: 'timezone_invalid' | 'game_url_invalid' | 'pr0plan_url_invalid' | 'setting_invalid';
  message: string;
}

const KNOWN: Record<string, unknown> = { ...UNIVERSE_DEFAULTS, ...OPTIONAL_DEFAULTS };
/** at least 1 and whole */
const COUNTS = ['galaxies', 'systems', 'positions', 'fleetSpeed', 'storageMultiplier'];
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
  for (const [key, value] of Object.entries(s)) {
    if (value === null && !(key in UNIVERSE_DEFAULTS)) continue;
    let valid = true;
    if (typeof KNOWN[key] === 'boolean') valid = typeof value === 'boolean';
    else if (typeof KNOWN[key] === 'number') {
      valid = typeof value === 'number' && Number.isFinite(value) && value >= 0;
      if (COUNTS.includes(key)) valid &&= Number.isInteger(value) && (value as number) >= 1;
      // above 100 % research times turn negative / more than everything goes into the debris field
      if (PERCENT.includes(key)) valid &&= (value as number) <= 100;
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
