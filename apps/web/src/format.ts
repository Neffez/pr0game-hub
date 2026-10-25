import { techName } from '@pr0hub/core/tech';
import { distance, SHIPS, type Coords } from '@pr0hub/flight';
import { encodeShare, type LootState } from '@pr0hub/loot';
import { compressToEncodedURIComponent } from 'lz-string';
import { ref } from 'vue';
import { currentLang, intlLocale, t } from './i18n';

/** Intl formatters per locale and options: toLocaleString creates one per call, tables format thousands of values. */
const formats = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, create: (locale: string) => T): T {
  const k = `${intlLocale()}|${key}`;
  let f = formats.get(k) as T | undefined;
  if (!f) formats.set(k, (f = create(intlLocale())));
  return f;
}

export const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n)
    ? '–'
    : cached(`n${digits}`, (l) => new Intl.NumberFormat(l, { maximumFractionDigits: digits, minimumFractionDigits: digits })).format(n);

export const fmtSigned = (n: number | null | undefined) => (n == null ? '–' : (n > 0 ? '+' : '') + fmt(n));

/** Suffixes per power of thousand (from 10^6), English like the game's LANG.cfg. */
const SHORT_SUFFIX = {
  de: [' Mio', ' Mrd', ' Bio', ' Brd', ' Trio'],
  en: ['M', 'B', 'T', 'Q', 'Q+'],
};

/** 1.234.567 -> 1,23 Mio (en: 1.23M) */
export function short(n: number | null | undefined): string {
  if (n == null) return '–';
  const a = Math.abs(n);
  const suffix = SHORT_SUFFIX[currentLang()];
  for (let i = suffix.length - 1; i >= 0; i--) {
    const unit = 10 ** (6 + 3 * i);
    if (a >= unit) return fmt(n / unit, 2) + suffix[i];
  }
  if (a >= 1e4) return fmt(n / 1e3, 1) + (currentLang() === 'en' ? 'K' : 'k');
  return fmt(n);
}

/** Order and separator of numeric dates; `auto` follows the language (de 23.10.2026, en 23/10/2026). */
export const DATE_FORMATS = ['auto', 'dmy.', 'dmy/', 'ymd'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
/** account setting of the viewer (set by loadMe and the account page) */
export const dateFormat = ref<DateFormat>('auto');
export function setDateFormat(value: unknown) {
  dateFormat.value = (DATE_FORMATS as readonly unknown[]).includes(value) ? (value as DateFormat) : 'auto';
}

const effectiveFormat = (): Exclude<DateFormat, 'auto'> =>
  dateFormat.value !== 'auto' ? dateFormat.value : currentLang() === 'de' ? 'dmy.' : 'dmy/';

/** date-fns pattern of the date part (date picker), e.g. dd.MM.yyyy */
export const datePattern = () => ({ 'dmy.': 'dd.MM.yyyy', 'dmy/': 'dd/MM/yyyy', ymd: 'yyyy-MM-dd' })[effectiveFormat()];

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Numeric date in the chosen format: `year` full (23.10.2026), short (23.10.26) or without (23.10.).
 * ISO always keeps the full year.
 */
export function numDate(d: Date, year: 'full' | 'short' | 'none' = 'full'): string {
  const f = effectiveFormat();
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  if (f === 'ymd') return year === 'none' ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`;
  const sep = f === 'dmy.' ? '.' : '/';
  if (year === 'none') return f === 'dmy.' ? `${dd}.${mm}.` : `${dd}/${mm}`;
  return `${dd}${sep}${mm}${sep}${year === 'short' ? pad(d.getFullYear() % 100) : d.getFullYear()}`;
}

/** 14:05 or 14:05:09 (24 h, browser time) */
export const clockTime = (d: Date, seconds = false) => `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}`;

/** Weekday name in the current language, `short` (Fr.) or `long` (Freitag). */
export const weekday = (d: Date, style: 'short' | 'long' = 'short') =>
  cached(`wd${style}`, (l) => new Intl.DateTimeFormat(l, { weekday: style })).format(d);

export function dateTime(epoch: number | null | undefined): string {
  if (!epoch) return '–';
  const d = new Date(epoch * 1000);
  return `${numDate(d, 'short')}, ${clockTime(d)}`;
}

export function ago(epoch: number | null | undefined): string {
  if (!epoch) return '–';
  const s = Math.floor(Date.now() / 1000) - epoch;
  if (s < 0) return t('time.soon');
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400 * 2) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export const coords = (g: number, s: number, p: number) => `[${g}:${s}:${p}]`;

/** Element name in the current language (names as in the game, generated into tech.json). */
export const name = (id: number | string) => techName(id, currentLang());

/**
 * Label table whose values are looked up in the current language on access, so `LABEL[key]`
 * call sites stay as they are and re-render on a language switch.
 */
function translated<K extends string | number>(prefix: string, keys: readonly K[]): Record<K, string> {
  const o = {} as Record<K, string>;
  for (const k of keys) Object.defineProperty(o, k, { enumerable: true, get: () => t(`${prefix}.${k}`) });
  return o;
}

export const STATS_TYPES: Record<number, string> = translated('game.stats', [1, 2, 3, 4, 5]);
export const STATS_SHORT: Record<number, string> = translated('game.statsShort', [1, 2, 3, 4, 5]);
/** All ranking categories of the game's statistics page (6 = honor points, not part of the score columns). */
export const STATS_CATEGORIES: Record<number, string> = translated('game.stats', [1, 2, 3, 4, 5, 6]);

/** Galaxy status letters as in the game (gl_short_*). */
export const STATUS_LABEL: Record<string, string> = translated('game.status', ['inactive', 'longinactive', 'vacation', 'banned', 'noob', 'strong']);
export const STATUS_TITLE: Record<string, string> = translated('game.statusTitle', ['inactive', 'longinactive', 'vacation', 'banned', 'noob', 'strong']);

const SECTION_LABEL: Record<number, string> = translated('game.sections', [900, 200, 400, 100, 0]);
export const SECTIONS: { cls: number; label: string }[] = [900, 200, 400, 100, 0].map((cls) => ({
  cls,
  get label() {
    return SECTION_LABEL[cls];
  },
}));

export const EVENT_LABEL: Record<string, string> = translated('game.events', ['Res', 'Ships', 'Pirates', 'Aliens', 'Fast', 'Slow', 'BlackHole', 'Nothing']);
export const SIZE_LABEL: Record<string, string> = translated('game.sizes', ['Small', 'Medium', 'Big']);
/** Depletion of the expedition system (only known with a probe in the fleet). */
export const DEPLETION_LABEL: Record<string, string> = translated('game.depletion', ['none', 'few', 'medium', 'many']);

/** Counts that may be expected values: whole numbers without decimals, otherwise one decimal. */
export const fmtCount = (n: number | null | undefined) =>
  n == null ? '–' : Math.abs(n - Math.round(n)) < 0.05 ? fmt(Math.round(n)) : fmt(n, 1);

/** "Piraten groß" / "Large Pirates" (word order per language). */
export const cardLabel = (key: string) => {
  const [type, size] = key.split(':');
  const event = EVENT_LABEL[type] ?? type;
  return size && size !== 'None' ? t('game.card', { event, size: SIZE_LABEL[size] ?? size }) : event;
};

export interface UniverseSettings {
  galaxies: number;
  systems: number;
  positions: number;
  circularGalaxies: boolean;
  circularSystems: boolean;
  galaxyDistanceFactor: number;
  systemDistanceFactor: number;
  systemDistance: number;
  planetDistanceFactor: number;
  planetDistance: number;
  fleetSpeed: number;
  /** game config building_speed (2500 = 1x), 0 unknown */
  buildingSpeed: number;
  researchSpeed: number;
  universityFactor: number;
  timezone: string;
  gameUrl: string;
}

export { distance } from '@pr0hub/flight';

export function duration(sec: number): string {
  if (!sec) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Short column labels for element tables (full name as tooltip). English ones follow the game's English names. */
const ABBR: Record<'de' | 'en', Record<number, string>> = {
  de: {
    1: 'MM', 2: 'KM', 3: 'DS', 4: 'SKW', 6: 'TD', 12: 'FKW', 14: 'RF', 15: 'NF', 21: 'WE', 22: 'MSp', 23: 'KSp', 24: 'DTk',
    31: 'FL', 33: 'TF', 34: 'AD', 35: 'RD', 41: 'MB', 42: 'PH', 43: 'ST', 44: 'RS',
    106: 'Spio', 108: 'Comp', 109: 'Waff', 110: 'Schi', 111: 'Panz', 113: 'Ener', 114: 'Hyp', 115: 'Verb', 117: 'Imp', 118: 'HRA',
    120: 'Las', 121: 'Ion', 122: 'Plas', 123: 'IFN', 124: 'Astro', 131: 'PM-M', 132: 'PM-K', 133: 'PM-D', 134: 'TE', 199: 'Grav',
    202: 'KT', 203: 'GT', 204: 'LJ', 205: 'SJ', 206: 'Xer', 207: 'SS', 208: 'Kolo', 209: 'Rec', 210: 'Spy', 211: 'B', 212: 'Sat',
    213: 'Zerri', 214: 'RIP', 215: 'SXer', 222: 'HXer', 225: 'ST', 227: 'ORec', 231: 'Beh', 232: 'VT',
    401: 'RW', 402: 'LL', 403: 'SL', 404: 'Gauß', 405: 'Ion', 406: 'Plas', 407: 'kSK', 408: 'gSK', 502: 'AR', 503: 'IPR',
  },
  en: {
    1: 'MM', 2: 'CM', 3: 'DR', 4: 'SPP', 6: 'Uni', 12: 'FPP', 14: 'RF', 15: 'NF', 21: 'SY', 22: 'MSt', 23: 'CSt', 24: 'DSt',
    31: 'Lab', 33: 'TF', 34: 'AD', 35: 'RD', 41: 'MB', 42: 'PH', 43: 'JG', 44: 'MS',
    106: 'Spy', 108: 'Comp', 109: 'Weap', 110: 'Shld', 111: 'Arm', 113: 'Ener', 114: 'Hyp', 115: 'Comb', 117: 'Imp', 118: 'HE',
    120: 'Las', 121: 'Ion', 122: 'Plas', 123: 'IRN', 124: 'Astro', 131: 'MP', 132: 'CP', 133: 'DP', 134: 'FE', 199: 'Grav',
    202: 'LC', 203: 'HC', 204: 'LF', 205: 'HF', 206: 'Cr', 207: 'BS', 208: 'Col', 209: 'Rec', 210: 'Probe', 211: 'Bomb', 212: 'Sat',
    213: 'Dest', 214: 'RIP', 215: 'BC', 222: 'HCr', 225: 'ST', 227: 'ORec', 231: 'Beh', 232: 'VT',
    401: 'ML', 402: 'LL', 403: 'HL', 404: 'Gauss', 405: 'Ion', 406: 'Plas', 407: 'SSD', 408: 'LSD', 502: 'ABM', 503: 'IPM',
  },
};
export const abbr = (id: number) => ABBR[currentLang()][id] ?? name(id);

/** Colour from red (low) to green (column maximum), like the FF-Hub tables. */
export function scaleColor(value: number | null | undefined, max: number) {
  if (!value || !max) return undefined;
  return `hsl(${Math.round(Math.min(1, value / max) * 120)}, 65%, 58%)`;
}

/** "21.10.26, 12:00:30 (5 h)": exact time to the second plus elapsed hours. */
export function timeWithAge(epoch: number | null | undefined): string {
  if (!epoch) return '–';
  const time = cached('dts', (l) => new Intl.DateTimeFormat(l, {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit',
  })).format(epoch * 1000);
  const s = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  return `${time} (${s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`})`;
}

export type Coords3 = Coords;

/** Default location of the flight calculator (pr0game-tools); override per universe with `flightCalculatorUrl`. */
const FLIGHT_CALCULATOR_URL = 'https://pr0game.neffez.dev/flight-calculator/';
const LOOT_CALCULATOR_URL = 'https://pr0game.neffez.dev/acs-loot/';
const IPM_CALCULATOR_URL = 'https://pr0game.neffez.dev/ipm-calculator/';

/**
 * Link into the flight calculator: start/target, drive research and the universe layout are
 * passed via its share-link hash (sg/ss/sp, tg/ts/tp, c/i/h/fe/ex, mg/ms/…); `extra` adds further keys of the
 * share link (mode, ships, times, see `applyHash` in the calculator).
 */
export function flightCalcLink(
  u: UniverseSettings,
  from: Coords3 | null,
  to: Coords3,
  research: Record<string, number> = {},
  extra: Record<string, string | number> = {},
): string {
  const p = new URLSearchParams();
  if (from) {
    p.set('sg', String(from[0]));
    p.set('ss', String(from[1]));
    p.set('sp', String(from[2]));
  }
  p.set('tg', String(to[0]));
  p.set('ts', String(to[1]));
  p.set('tp', String(to[2]));
  // combustion, impulse, hyperspace drive, fuel efficiency, astrophysics
  for (const [key, id] of [['c', 115], ['i', 117], ['h', 118], ['fe', 134], ['ex', 124]] as const) {
    if (research[id] != null) p.set(key, String(research[id]));
  }
  p.set('ut', u.circularGalaxies ? '1' : '0');
  p.set('gt', u.circularSystems ? '1' : '0');
  p.set('mg', String(u.galaxies));
  p.set('ms', String(u.systems));
  p.set('mp', String(u.positions));
  p.set('gdf', String(u.galaxyDistanceFactor));
  p.set('sdf', String(u.systemDistanceFactor));
  p.set('sd', String(u.systemDistance));
  p.set('pdf', String(u.planetDistanceFactor));
  p.set('pd', String(u.planetDistance));
  p.set('gs', String(u.fleetSpeed / 2500));
  for (const [key, value] of Object.entries(extra)) p.set(key, String(value));
  const base = (u as UniverseSettings & { flightCalculatorUrl?: string }).flightCalculatorUrl || FLIGHT_CALCULATOR_URL;
  return `${base}#${p.toString()}`;
}

/** Weapons, shields and armour: the research the combat simulators take per attacker. */
const COMBAT_TECHS = [109, 110, 111];
/** Research columns of a TrashSim export row: weapons, shields, armour, the three drives, fuel efficiency. */
const TRASH_TECHS = [109, 110, 111, 115, 117, 118, 134];
/**
 * TrashSim's ship columns: the game's flying ships in id order (`ShowTrashsimPage`, all ships but the solar
 * satellite), on the defender's row followed by the solar satellite and the defense 401-408.
 */
const TRASH_SHIPS = Object.keys(SHIPS).map(Number).sort((a, b) => a - b);
const TRASH_DEFENSE = [212, 401, 402, 403, 404, 405, 406, 407, 408];

/** Fleet for the simulators: ships, research (by id), and for TrashSim its start and speed percent. */
export interface SimFleet {
  ships: Record<string, number>;
  research: Record<string, number>;
  from?: Coords3 | null;
  speed?: number;
}

/**
 * TrashSim's export text (`get_exportstring` in its `import_export.js`), LZString-packed for its `sim=` parameter: a
 * line with the target's resources and the plunder percent, then one row per fleet (0 attacker, 1 defender: id,
 * research, origin, speed, recycler fields, ships; defenders also space dock and defense). The target planet is the
 * first defender, `defenders` (hold fleets) follow it.
 */
export function trashSimExport(values: Record<string, number>, target: Coords3 | null, attackers: SimFleet[], defenders: SimFleet[] = []): string {
  const row = (side: number, id: number, research: Record<string, number>, from: Coords3 | null | undefined, speed: number) => [
    side, id, ...TRASH_TECHS.map((t) => research[t] ?? 0), ...(from ?? [0, 0, 0]), speed, 0, 0, 0, 0, 100, 0, 0, 0, 0,
  ];
  const lines = [
    [values[901] ?? 0, values[902] ?? 0, values[903] ?? 0, 50],
    ...attackers.map((a, i) => [...row(0, i, a.research, a.from, a.speed ?? 100), ...TRASH_SHIPS.map((id) => a.ships[id] ?? 0)]),
    [...row(1, 0, values, target, 100), 0, ...[...TRASH_SHIPS, ...TRASH_DEFENSE].map((id) => values[id] ?? 0)],
    ...defenders.map((d, i) => [...row(1, i + 1, d.research, d.from, d.speed ?? 100), 0, ...[...TRASH_SHIPS, ...TRASH_DEFENSE].map((id) => d.ships[id] ?? 0)]),
  ];
  return compressToEncodedURIComponent(lines.map((l) => l.join(' ') + '\n').join(''));
}

/**
 * Combat simulators of the game with a spy report's values (`im[ID]=amount`, as the game's "simulate" button, the
 * defender of the first slot): the simulator in the game and TrashSim (`battlesim.html` of the universe). `attackers`
 * fill the attacker side of the game simulator's ACS slots (`slots`, `battleinput[slot][0][ID]`), `defenders` (hold
 * fleets) the defender side from the second slot on (`battleinput[slot][1][ID]`); TrashSim takes them only with the
 * whole setup as its export string (`sim=`, its `im[]` values are ignored then).
 */
export function simLinks(
  gameUrl: string, values: Record<string, number>, attackers: SimFleet[] = [], target: Coords3 | null = null, defenders: SimFleet[] = [],
): { game: string; trash: string } {
  const base = gameUrl.replace(/\/?$/, '/');
  const params = Object.entries(values)
    .map(([id, v]) => `im[${id}]=${v}`)
    .join('&');
  const side = (slot: number, s: 0 | 1, f: SimFleet) =>
    [
      ...COMBAT_TECHS.map((id) => `battleinput[${slot}][${s}][${id}]=${f.research[id] ?? 0}`),
      ...Object.entries(f.ships)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => `battleinput[${slot}][${s}][${id}]=${n}`),
    ].join('&');
  const inputs = [...attackers.map((a, i) => side(i, 0, a)), ...defenders.map((d, i) => side(i + 1, 1, d))];
  const slots = Math.max(attackers.length, defenders.length ? defenders.length + 1 : 0);
  const fleets = slots ? `slots=${slots}&${inputs.join('&')}&` : '';
  return {
    game: `${base}game.php?page=battleSimulator&${fleets}${params}`,
    trash: slots ? `${base}battlesim.html?sim=${trashSimExport(values, target, attackers, defenders)}` : `${base}battlesim.html?&${params}`,
  };
}

/** Colour for how old a galaxy view is (Gala-Aktualität, universe browser). */
export function freshnessColor(age: number | null) {
  if (age == null) return 'var(--surface-2)';
  const h = age / 3600;
  if (h < 6) return '#2ea043';
  if (h < 24) return '#3fb95099';
  if (h < 72) return '#d2992299';
  if (h < 24 * 7) return '#f8514966';
  return '#f8514933';
}

/** Phalanx range in systems: (level² − 1) × factor (ShowPhalanxPage::GetPhalanxRange). */
export function phalanxRange(level: number, u: UniverseSettings) {
  const factor = (u as UniverseSettings & { phalanxRangeFactor?: number }).phalanxRangeFactor ?? 1;
  return level <= 1 ? 0 : Math.floor((level * level - 1) * factor);
}

/** The public ACS loot calculator, next to the flight calculator of the universe. */
export function lootCalcUrl(u: UniverseSettings): string {
  const flight = (u as UniverseSettings & { flightCalculatorUrl?: string }).flightCalculatorUrl;
  return flight ? new URL('../acs-loot/', flight.split('#')[0]).href : LOOT_CALCULATOR_URL;
}

/** The public interplanetary missile calculator, next to the flight calculator of the universe. */
export function ipmCalcUrl(u: UniverseSettings): string {
  const flight = (u as UniverseSettings & { flightCalculatorUrl?: string }).flightCalculatorUrl;
  return flight ? new URL('../ipm-calculator/', flight.split('#')[0]).href : IPM_CALCULATOR_URL;
}

/** What a missile can hit: the defense and the target's own interplanetary missiles (calculateMIPAttack). */
const IPM_TARGETS = [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 503];

export interface IpmLinkInput {
  /** own planet the missiles start from */
  from: Coords3 | null;
  to: Coords3;
  moon?: boolean;
  /** own research: impulse drive (117, range) and weapons (109) */
  research?: Record<string, number>;
  /** values of the target's newest spy report: defense, interceptors (502), missiles (503), armour (111) */
  values?: Record<string, number> | null;
  /** a moon is defended by the interceptors of its planet (newest spy report of the planet) */
  planetInterceptors?: number | null;
}

/**
 * Link into the IPM calculator: start, target and universe like `flightCalcLink`, own impulse drive and weapons,
 * and from a spy report the defense, interceptors and armour (keys see `encodeHash` in the calculator's glue).
 */
export function ipmCalcLink(u: UniverseSettings, input: IpmLinkInput): string {
  const p = new URLSearchParams();
  if (input.from) {
    p.set('sg', String(input.from[0]));
    p.set('ss', String(input.from[1]));
    p.set('sp', String(input.from[2]));
  }
  p.set('tg', String(input.to[0]));
  p.set('ts', String(input.to[1]));
  p.set('tp', String(input.to[2]));
  if (input.moon) p.set('m', '1');
  const research = input.research ?? {};
  if (research[117] != null) p.set('i', String(research[117]));
  if (research[109] != null) p.set('w', String(research[109]));
  const values = input.values ?? {};
  if (values[111]) p.set('a', String(values[111]));
  const interceptors = input.moon ? input.planetInterceptors : values[502];
  if (interceptors) p.set('ic', String(interceptors));
  for (const id of IPM_TARGETS) if (values[id]) p.set(`d${id}`, String(values[id]));
  p.set('ms', String(u.systems));
  p.set('gt', u.circularSystems ? '1' : '0');
  p.set('gs', String(u.fleetSpeed / 2500));
  const factor = (u as UniverseSettings & { missileRangeFactor?: number }).missileRangeFactor;
  if (factor != null && factor !== 1) p.set('mrf', String(factor));
  return `${ipmCalcUrl(u)}#${p.toString()}`;
}

/** Nearest own planet (not moon) in the target's galaxy: missiles only fly within the galaxy, silos stand on planets. */
export function ipmStart(
  u: UniverseSettings,
  planets: { name: string; coords: { g: number; s: number; p: number }; type: 'planet' | 'moon' }[] | undefined,
  to: Coords3,
): Coords3 | null {
  let best: { c: Coords3; d: number } | null = null;
  for (const pl of planets ?? []) {
    if (pl.type === 'moon' || pl.coords.g !== to[0]) continue;
    const c: Coords3 = [pl.coords.g, pl.coords.s, pl.coords.p];
    const d = distance(u, c, to);
    if (!best || d < best.d) best = { c, d };
  }
  return best?.c ?? null;
}

/** Link to the public ACS loot calculator with a settlement. */
export function lootCalcLink(u: UniverseSettings, state: LootState): string {
  return `${lootCalcUrl(u)}#s=${encodeShare(state)}`;
}

