/* Moon destruction calculator: chances of MissionCaseDestruction for one or several waves of Death Stars, the
   recommendation for a wanted total chance, share link and the pasted moon tooltip of the galaxy view. */

export type Coords = [number, number, number];

/** Wanted total chance of the recommendation by default, in percent. */
export const DEFAULT_GOAL = 90;
/** Wave counts the recommendation looks at. */
export const MAX_WAVES = 6;
/** Rows of the wave list. */
export const MAX_WAVE_ROWS = 20;

export interface MoonState {
  /** moon diameter in km, 0 = not entered */
  diameter: number;
  /** coordinates of the moon, only a label */
  target: Coords | null;
  /** moon name, only a label */
  name: string;
  /** Death Stars (plus Void Titans) of each wave, in flight order */
  waves: number[];
  /** wanted total chance of the recommendation in percent */
  goal: number;
}

export function emptyState(): MoonState {
  return { diameter: 0, target: null, name: '', waves: [1], goal: DEFAULT_GOAL };
}

// ---- game formulas (MissionCaseDestruction) ---------------------------------------------------------------------

/** PHP round(x, 1) for x >= 0. */
const round1 = (x: number) => Math.round(x * 10 + 1e-9) / 10;

/**
 * Chance to destroy the moon after a won battle: round((100 − √d) · √rips, 1), 0 to 100 (`shown`, the value of the
 * battle report). The game rolls random_int(1, 100) ≤ chance, so only the whole percent counts (`effective`, 0–1).
 */
export function moonChance(diameter: number, rips: number): { shown: number; effective: number } {
  if (!(rips > 0) || !(diameter > 0)) return { shown: 0, effective: 0 };
  const shown = Math.min(100, Math.max(0, round1((100 - Math.sqrt(diameter)) * Math.sqrt(rips))));
  return { shown, effective: Math.floor(shown + 1e-9) / 100 };
}

/** Chance in percent that the whole fleet of a wave is lost after a won battle: round(√d / 2), rolled on its own. */
export function fleetChance(diameter: number): number {
  return diameter > 0 ? Math.round(Math.sqrt(diameter) / 2) : 0;
}

/** Whole percent the moon chance must reach for a total of `goal` percent in `waves` equal waves. */
function percentNeeded(goal: number, waves: number): number | null {
  for (let pct = 1; pct <= 100; pct++) if (1 - (1 - pct / 100) ** waves >= goal / 100 - 1e-12) return pct;
  return null;
}

/** Fewest Death Stars whose chance (as shown) reaches `pct`; null when the moon is too large (√d ≥ 100). */
export function ripsFor(diameter: number, pct: number): number | null {
  const factor = 100 - Math.sqrt(diameter);
  if (!(factor > 0) || pct <= 0) return pct <= 0 ? 0 : null;
  let n = Math.max(1, Math.floor(((pct - 0.05) / factor) ** 2));
  while (moonChance(diameter, n).shown < pct) n++;
  while (n > 1 && moonChance(diameter, n - 1).shown >= pct) n--;
  return n;
}

// ---- waves ------------------------------------------------------------------------------------------------------

export interface WaveRow {
  rips: number;
  /** chance as shown in the battle report, percent */
  shown: number;
  /** chance that counts, 0–1 */
  chance: number;
  /** probability that this wave still flies "destroy" (the moon is still there) */
  flies: number;
  /** probability that this wave destroys the moon */
  destroys: number;
  /** probability that the moon is gone after this wave */
  cumulative: number;
  /** probability that this wave's fleet is lost */
  lost: number;
  /** expected Death Stars lost in this wave */
  expectedLost: number;
}

export interface WavesResult {
  rows: WaveRow[];
  /** fleet loss chance of every wave in percent */
  fleetChance: number;
  /** total chance to destroy the moon */
  total: number;
  /** probability that at least one wave is lost */
  anyLost: number;
  expectedLost: number;
  /** expected number of waves that fly "destroy" */
  expectedWaves: number;
}

/**
 * All waves after won battles: a wave only rolls while the moon still exists (once it is gone, the game turns the
 * following destroy missions into attacks); its fleet-loss roll is independent of its moon roll.
 */
export function calculateWaves(diameter: number, waves: number[]): WavesResult {
  const q = fleetChance(diameter) / 100;
  const rows: WaveRow[] = [];
  let alive = 1;
  // probability that no wave was lost so far and the moon still stands, per number of flown waves
  let noLoss = 0;
  let expectedWaves = 0;
  for (const rips of waves.filter((n) => n > 0)) {
    const { shown, effective } = moonChance(diameter, rips);
    const flies = alive;
    const destroys = flies * effective;
    alive = flies - destroys;
    // the moon falls in this wave (no later waves fly): no loss means this wave survived and all before it
    noLoss += destroys * (1 - q) ** (rows.length + 1);
    expectedWaves += flies;
    rows.push({ rips, shown, chance: effective, flies, destroys, cumulative: 1 - alive, lost: flies * q, expectedLost: flies * q * rips });
  }
  noLoss += alive * (1 - q) ** rows.length;
  return {
    rows,
    fleetChance: fleetChance(diameter),
    total: 1 - alive,
    anyLost: rows.length ? 1 - noLoss : 0,
    expectedLost: rows.reduce((sum, r) => sum + r.expectedLost, 0),
    expectedWaves,
  };
}

// ---- recommendation ---------------------------------------------------------------------------------------------

export interface Recommendation {
  waves: number;
  ripsPerWave: number;
  totalRips: number;
  /** reached total chance */
  total: number;
  anyLost: number;
  expectedLost: number;
}

/**
 * Fewest Death Stars per wave for a total chance of at least `goal` percent, for 1 to `maxWaves` equal waves. A wave
 * count that needs as many Death Stars per wave as one wave less is left out (the extra wave gains nothing).
 */
export function recommend(diameter: number, goal: number, maxWaves = MAX_WAVES): Recommendation[] {
  const list: Recommendation[] = [];
  if (!(diameter > 0) || !(goal > 0)) return list;
  for (let k = 1; k <= maxWaves; k++) {
    const pct = percentNeeded(goal, k);
    if (pct == null) continue;
    const n = ripsFor(diameter, pct);
    if (n == null) return list;
    if (list.length && list[list.length - 1].ripsPerWave === n) continue;
    const r = calculateWaves(diameter, Array(k).fill(n));
    list.push({ waves: k, ripsPerWave: n, totalRips: n * k, total: r.total, anyLost: r.anyLost, expectedLost: r.expectedLost });
  }
  return list;
}

// ---- share link -------------------------------------------------------------------------------------------------

const int = (v: unknown, min = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, n) : min;
};
const clampGoal = (v: unknown) => Math.min(100, Math.max(1, int(v, 1) || DEFAULT_GOAL));
const cleanWaves = (v: unknown): number[] => {
  const list = (Array.isArray(v) ? v : []).slice(0, MAX_WAVE_ROWS).map((n) => int(n));
  return list.length ? list : [1];
};

/** Coordinates "1:234:5" (also with brackets or spaces). */
export function parseCoordsText(text: string): Coords | null {
  const m = String(text).match(/(\d+)\s*:\s*(\d+)\s*:\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function fmtCoordsText(c: Coords | null): string {
  return c ? c.join(':') : '';
}

/** Hash of a share link: d (diameter), tg/ts/tp (coordinates, like the other tools), mn (name), r (waves), x (goal). */
export function encodeHash(s: MoonState): string {
  const p = new URLSearchParams();
  if (s.diameter) p.set('d', String(s.diameter));
  if (s.target) {
    p.set('tg', String(s.target[0]));
    p.set('ts', String(s.target[1]));
    p.set('tp', String(s.target[2]));
  }
  if (s.name) p.set('mn', s.name);
  p.set('r', s.waves.join(','));
  if (s.goal !== DEFAULT_GOAL) p.set('x', String(s.goal));
  return p.toString();
}

/**
 * Applies a share link hash; false when it holds nothing of this calculator. A link with a moon (diameter or
 * coordinates) replaces the moon, the waves and the goal stay unless the link carries them.
 */
export function applyHash(s: MoonState, hash: string): boolean {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  let any = false;
  if (p.has('d') || p.has('tg')) {
    s.diameter = int(p.get('d'));
    s.target = p.has('tg') ? [int(p.get('tg'), 1), int(p.get('ts'), 1), int(p.get('tp'), 1)] : null;
    s.name = (p.get('mn') ?? '').slice(0, 40);
    any = true;
  }
  if (p.has('r')) {
    s.waves = cleanWaves((p.get('r') ?? '').split(','));
    any = true;
  }
  if (p.has('x')) {
    s.goal = clampGoal(p.get('x'));
    any = true;
  }
  return any;
}

/** A stored state with every field present and in range (older or broken data falls back to the defaults). */
export function cleanState(saved: unknown): MoonState {
  const s = emptyState();
  if (!saved || typeof saved !== 'object') return s;
  const o = saved as Partial<MoonState>;
  s.diameter = int(o.diameter);
  s.target = Array.isArray(o.target) && o.target.length === 3 ? [int(o.target[0], 1), int(o.target[1], 1), int(o.target[2], 1)] : null;
  s.name = typeof o.name === 'string' ? o.name.slice(0, 40) : '';
  s.waves = cleanWaves(o.waves);
  s.goal = clampGoal(o.goal);
  return s;
}

// ---- pasted galaxy view -----------------------------------------------------------------------------------------

export interface PastedMoon {
  diameter: number;
  target: Coords | null;
  name: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", amp: '&', nbsp: ' ' };
const decode = (s: string) => s.replace(/&(lt|gt|quot|apos|#39|amp|nbsp);/g, (_, e: string) => ENTITIES[e]);

/**
 * Moons in a pasted galaxy view: the moon tooltip ("Mond Ra [3:200:1]" … "Durchmesser 4.560"), as HTML (also
 * escaped inside data-tooltip-content, so entities are decoded twice) or as copied text. One entry per moon.
 */
export function parseMoons(text: string): PastedMoon[] {
  const plain = decode(decode(String(text))).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const moons: PastedMoon[] = [];
  const re = /(?:(?:Mond|Moon)\s+([^[\]<>]{0,40}?)\s*\[(\d+):(\d+):(\d+)\]\s*)?(?:Durchmesser|Diameter)\s*:?\s*([\d.,]+)/gi;
  for (const m of plain.matchAll(re)) {
    const diameter = Number(m[5].replace(/[.,]/g, ''));
    if (!diameter) continue;
    moons.push({
      diameter,
      target: m[2] ? [Number(m[2]), Number(m[3]), Number(m[4])] : null,
      name: (m[1] ?? '').trim().slice(0, 40),
    });
  }
  return moons;
}

/** Takes a pasted moon into the state; the waves stay. */
export function applyMoon(s: MoonState, moon: PastedMoon): void {
  s.diameter = moon.diameter;
  s.target = moon.target;
  s.name = moon.name;
}
