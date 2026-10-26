import type { Resources } from './steal.js';

export type Coords = [number, number, number];

/** A fleet slot of the simulator: units and research by id, for attackers also start and speed (flight time). */
export interface ShareSlot {
  units: Record<string, number>;
  research: Record<string, number>;
  from?: Coords | null;
  /** speed in percent */
  speed?: number;
}

/** Everything the simulator's link carries (hub links and the tool's share link). */
export interface ShareState {
  attackers: ShareSlot[];
  /** the planet first, then fleets holding there */
  defenders: ShareSlot[];
  target?: Coords | null;
  resources?: Resources | null;
  /** universe values by their hash key (`fd`/`dd` debris percent, layout and speed keys of the flight calculator) */
  uni?: Record<string, number>;
  runs?: number;
}

/**
 * Universe keys of the link: debris percent of fleet and defense, moon factor and cap, shield domes as ship shields
 * (`bs` 0/1), market rates for the value in deuterium (`rm`, `rk`), then the flight calculator's layout and speed.
 */
export const UNI_KEYS = ['fd', 'dd', 'mf', 'mc', 'bs', 'rm', 'rk', 'ut', 'gt', 'mg', 'ms', 'mp', 'gdf', 'sdf', 'sd', 'pdf', 'pd', 'gs'] as const;

const MAX_SLOTS = 16;

const list = (values: Record<string, number>) =>
  Object.entries(values)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${id}:${n}`)
    .join(',');

function parseList(value: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (value ?? '').split(',')) {
    const m = part.match(/^(\d{1,3}):(\d+(?:\.\d+)?)$/);
    if (m && Number(m[2]) > 0) out[m[1]] = Number(m[2]);
  }
  return out;
}

function parseCoords(value: string | null): Coords | null {
  const m = value?.match(/^(\d+):(\d+):(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * The link hash (without `#`): per slot `a0`/`d0` units (`id:n,…`), `a0r` research, `a0f` start, `a0v` speed; `t`
 * target, `res` resources (metal, crystal, deuterium), `n` runs and the universe keys (`UNI_KEYS`).
 */
export function encodeShare(state: ShareState): string {
  const p = new URLSearchParams();
  const slot = (prefix: string, s: ShareSlot, i: number) => {
    const units = list(s.units);
    if (units) p.set(`${prefix}${i}`, units);
    const research = list(s.research);
    if (research) p.set(`${prefix}${i}r`, research);
    if (s.from) p.set(`${prefix}${i}f`, s.from.join(':'));
    if (s.speed != null && s.speed !== 100) p.set(`${prefix}${i}v`, String(s.speed));
  };
  state.attackers.slice(0, MAX_SLOTS).forEach((s, i) => slot('a', s, i));
  state.defenders.slice(0, MAX_SLOTS).forEach((s, i) => slot('d', s, i));
  if (state.target) p.set('t', state.target.join(':'));
  const r = state.resources;
  if (r && (r.metal || r.crystal || r.deuterium)) p.set('res', [r.metal, r.crystal, r.deuterium].map((n) => Math.floor(n)).join(','));
  if (state.runs) p.set('n', String(state.runs));
  for (const key of UNI_KEYS) if (state.uni?.[key] != null) p.set(key, String(state.uni[key]));
  // URLSearchParams escapes ":" and ","; both are safe in a hash and keep the link readable
  return p.toString().replace(/%3A/g, ':').replace(/%2C/g, ',');
}

/** Reads a link hash (with or without `#`); slots are kept up to the last one given. */
export function decodeShare(hash: string): ShareState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const slots = (prefix: string) => {
    const out: ShareSlot[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const keys = ['', 'r', 'f', 'v'].map((k) => `${prefix}${i}${k}`);
      if (!keys.some((k) => p.has(k))) continue;
      while (out.length < i) out.push({ units: {}, research: {} });
      const speed = Number(p.get(`${prefix}${i}v`));
      out.push({
        units: parseList(p.get(`${prefix}${i}`)),
        research: parseList(p.get(`${prefix}${i}r`)),
        from: parseCoords(p.get(`${prefix}${i}f`)),
        speed: speed >= 10 && speed <= 100 ? speed : 100,
      });
    }
    return out;
  };
  const res = (p.get('res') ?? '').split(',').map(Number);
  const uni: Record<string, number> = {};
  for (const key of UNI_KEYS) {
    const v = Number(p.get(key));
    if (p.has(key) && Number.isFinite(v)) uni[key] = v;
  }
  const runs = Number(p.get('n'));
  return {
    attackers: slots('a'),
    defenders: slots('d'),
    target: parseCoords(p.get('t')),
    resources: res.length === 3 && res.every((n) => Number.isFinite(n) && n >= 0) ? { metal: res[0], crystal: res[1], deuterium: res[2] } : null,
    uni,
    runs: runs > 0 ? runs : undefined,
  };
}
