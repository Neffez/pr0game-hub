import { techName } from '@pr0hub/core/tech';

export const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n) ? '–' : n.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtSigned = (n: number | null | undefined) => (n == null ? '–' : (n > 0 ? '+' : '') + fmt(n));

/** 1.234.567 -> 1,23 Mio */
export function short(n: number | null | undefined): string {
  if (n == null) return '–';
  const a = Math.abs(n);
  if (a >= 1e9) return fmt(n / 1e9, 2) + ' Mrd';
  if (a >= 1e6) return fmt(n / 1e6, 2) + ' Mio';
  if (a >= 1e4) return fmt(n / 1e3, 1) + 'k';
  return fmt(n);
}

export function dateTime(epoch: number | null | undefined): string {
  if (!epoch) return '–';
  return new Date(epoch * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ago(epoch: number | null | undefined): string {
  if (!epoch) return '–';
  const s = Math.floor(Date.now() / 1000) - epoch;
  if (s < 0) return 'gleich';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400 * 2) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export const coords = (g: number, s: number, p: number) => `[${g}:${s}:${p}]`;

export const name = (id: number | string) => techName(id, 'de');

export const STATS_TYPES: Record<number, string> = { 1: 'Gesamt', 2: 'Flotte', 3: 'Forschung', 4: 'Gebäude', 5: 'Verteidigung' };
export const STATS_SHORT: Record<number, string> = { 1: 'Σ', 2: 'F', 3: 'R', 4: 'B', 5: 'D' };

export const STATUS_LABEL: Record<string, string> = {
  inactive: 'i',
  longinactive: 'I',
  vacation: 'u',
  banned: 'g',
  noob: 'n',
  strong: 's',
};

export const SECTIONS: { cls: number; label: string }[] = [
  { cls: 900, label: 'Rohstoffe' },
  { cls: 200, label: 'Flotte' },
  { cls: 400, label: 'Verteidigung' },
  { cls: 100, label: 'Forschung' },
  { cls: 0, label: 'Gebäude' },
];

export const EVENT_LABEL: Record<string, string> = {
  Res: 'Ressourcen',
  Ships: 'Schiffe',
  Pirates: 'Piraten',
  Aliens: 'Aliens',
  Fast: 'Schnell',
  Slow: 'Langsam',
  BlackHole: 'Schwarzes Loch',
  Nothing: 'Nichts',
};
export const SIZE_LABEL: Record<string, string> = { Small: 'klein', Medium: 'mittel', Big: 'groß', None: '' };

export const cardLabel = (key: string) => {
  const [type, size] = key.split(':');
  return `${EVENT_LABEL[type] ?? type}${size && size !== 'None' ? ' ' + SIZE_LABEL[size] : ''}`;
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
  timezone: string;
  gameUrl: string;
}

/** FleetFunctions::getTargetDistance */
export function distance(u: UniverseSettings, a: [number, number, number], b: [number, number, number]): number {
  const wrap = (x: number, y: number, max: number, circular: boolean) => {
    const d = Math.abs(x - y);
    if (!circular || d < Math.ceil(max / 2)) return d;
    return Math.floor(max / 2) - (d - Math.ceil(max / 2));
  };
  if (a[0] !== b[0]) return wrap(a[0], b[0], u.galaxies, u.circularGalaxies) * u.galaxyDistanceFactor;
  if (a[1] !== b[1]) return wrap(a[1], b[1], u.systems, u.circularSystems) * u.systemDistanceFactor + u.systemDistance;
  if (a[2] !== b[2]) return Math.abs(a[2] - b[2]) * u.planetDistanceFactor + u.planetDistance;
  return 5;
}

/** FleetFunctions::getMissionDuration (seconds, 100% speed). */
export function flightTime(u: UniverseSettings, dist: number, shipSpeed: number, speedPercent = 100): number {
  if (!shipSpeed) return 0;
  const gameSpeed = u.fleetSpeed / 2500;
  return Math.floor(((3500 / (speedPercent / 10)) * Math.sqrt((dist * 10) / shipSpeed) + 10) / gameSpeed);
}

export function duration(sec: number): string {
  if (!sec) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Short column labels for element tables (full name as tooltip). */
const ABBR: Record<number, string> = {
  1: 'MM', 2: 'KM', 3: 'DS', 4: 'SKW', 6: 'TD', 12: 'FKW', 14: 'RF', 15: 'NF', 21: 'WE', 22: 'MSp', 23: 'KSp', 24: 'DTk',
  31: 'FL', 33: 'TF', 34: 'AD', 35: 'RD', 41: 'MB', 42: 'PH', 43: 'ST', 44: 'RS',
  106: 'Spio', 108: 'Comp', 109: 'Waff', 110: 'Schi', 111: 'Panz', 113: 'Ener', 114: 'Hyp', 115: 'Verb', 117: 'Imp', 118: 'HRA',
  120: 'Las', 121: 'Ion', 122: 'Plas', 123: 'IFN', 124: 'Astro', 131: 'PM-M', 132: 'PM-K', 133: 'PM-D', 134: 'TE', 199: 'Grav',
  202: 'KT', 203: 'GT', 204: 'LJ', 205: 'SJ', 206: 'Xer', 207: 'SS', 208: 'Kolo', 209: 'Rec', 210: 'Spy', 211: 'B', 212: 'Sat',
  213: 'Zerri', 214: 'RIP', 215: 'SXer', 222: 'HXer', 225: 'ST', 227: 'ORec', 231: 'Beh', 232: 'VT',
  401: 'RW', 402: 'LL', 403: 'SL', 404: 'Gauß', 405: 'Ion', 406: 'Plas', 407: 'kSK', 408: 'gSK', 502: 'AR', 503: 'IPR',
};
export const abbr = (id: number) => ABBR[id] ?? name(id);

/** Colour from red (low) to green (column maximum), like the FF-Hub tables. */
export function scaleColor(value: number | null | undefined, max: number) {
  if (!value || !max) return undefined;
  return `hsl(${Math.round(Math.min(1, value / max) * 120)}, 65%, 58%)`;
}

/** "21.10.26, 12:00:30 (5 h)": exact time to the second plus elapsed hours. */
export function timeWithAge(epoch: number | null | undefined): string {
  if (!epoch) return '–';
  const t = new Date(epoch * 1000).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const s = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  return `${t} (${s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`})`;
}

export type Coords3 = [number, number, number];

/** Default location of the flight calculator (pr0game-tools); override per universe with `flightCalculatorUrl`. */
const FLIGHT_CALCULATOR_URL = 'https://pr0game.neffez.dev/flight-calculator/';

/**
 * Link into the flight calculator: start/target, drive research and the universe layout are
 * passed via its share-link hash (sg/ss/sp, tg/ts/tp, c/i/h/fe/ex, mg/ms/…).
 */
export function flightCalcLink(u: UniverseSettings, from: Coords3 | null, to: Coords3, research: Record<string, number> = {}): string {
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
  const base = (u as UniverseSettings & { flightCalculatorUrl?: string }).flightCalculatorUrl || FLIGHT_CALCULATOR_URL;
  return `${base}#${p.toString()}`;
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
