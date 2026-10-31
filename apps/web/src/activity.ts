/** Activity pattern of a player: evidence of online times laid over one day and smoothed (see `activityCurve`). */

export type ActivitySource = 'spy' | 'attack' | 'defense' | 'message' | 'galaxy' | 'fleet' | 'recall' | 'manual' | 'offline' | 'sync' | 'hub';

export interface ActivityEvent {
  time: number;
  /** half width of the uncertainty in seconds */
  spread: number;
  source: ActivitySource;
  weight?: number;
  g?: number;
  s?: number;
  p?: number;
  syncedAt?: number;
  id?: number;
  reporter?: string | null;
  mine?: boolean;
}

/**
 * How much one piece of evidence counts: galaxy marks are also set by others' actions, an open hub tab means the member
 * is around but not necessarily in the game.
 */
export const SOURCE_WEIGHT: Record<ActivitySource, number> = {
  spy: 1, attack: 1, defense: 1, message: 1, fleet: 1, recall: 1, manual: 1, offline: 0, sync: 1, galaxy: 0.4, hub: 0.5,
};

/** Evidence of yesterday counts about 0.7, of a week ago about 0.1. */
export const HALF_LIFE = 2 * 86400;
/** Smoothing of an exact time (minutes). */
export const BANDWIDTH = 30;
const DAY = 1440;

/** Minute of the day in browser time (like the hub's other times). */
export const minuteOfDay = (epoch: number) => {
  const d = new Date(epoch * 1000);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};

/**
 * Activity over the day in `bins` steps (bin i covers minute i·1440/bins): every event of the last `days` adds a
 * Gaussian around its time of day (wrapping at midnight), wider by its uncertainty and weighted by its source and age.
 * Scaled by the peak the same events would reach at full weight, so evidence that counts less (galaxy marks, hub
 * presence) stays low even when it is all there is; with full-weight evidence the peak is 1. Empty without events.
 */
export function activityCurve(events: ActivityEvent[], now: number, days: number, bins = 288): number[] {
  const from = now - days * 86400;
  const out = new Array<number>(bins).fill(0);
  /** the same at full weight: the scale */
  const full = new Array<number>(bins).fill(0);
  const step = DAY / bins;
  let any = false;
  for (const e of events) {
    if (e.time < from || e.time > now + 60) continue;
    const base = e.weight ?? SOURCE_WEIGHT[e.source];
    if (base <= 0) continue;
    any = true;
    // a uniform window of ±spread has the standard deviation spread/√3
    const sigma = Math.sqrt(BANDWIDTH ** 2 + (e.spread / 60 / Math.sqrt(3)) ** 2);
    const w = 0.5 ** (Math.max(0, now - e.time) / HALF_LIFE) / sigma;
    const m = minuteOfDay(e.time);
    for (let i = 0; i < bins; i++) {
      const d = ((((i + 0.5) * step - m) % DAY) + DAY * 1.5) % DAY - DAY / 2;
      const v = w * Math.exp(-(d * d) / (2 * sigma * sigma));
      out[i] += base * v;
      full[i] += Math.max(base, 1) * v;
    }
  }
  if (!any) return [];
  const peak = Math.max(...full);
  return peak > 0 ? out.map((v) => v / peak) : out;
}

/** Stat windows longer than this (missing statistics syncs) are left out. */
export const MAX_SCORE_WINDOW = 12 * 3600;

/**
 * Point gain over the day in `bins` steps, scaled to a peak of 1: each stat window of the last `days` spreads its gain
 * evenly over its time of day; per bin the age-weighted average rate of the windows covering it. Nothing gained is 0
 * (inactive), a bin no window covers null (unknown). Windows with a loss (fleet lost, gains hidden) are left out.
 * Empty when no window is known.
 */
export function pointsRate(scores: { time: number; points: number }[], now: number, days: number, bins = 288): (number | null)[] {
  const from = now - days * 86400;
  const step = DAY / bins;
  const sum = new Array<number>(bins).fill(0);
  const cover = new Array<number>(bins).fill(0);
  let any = false;
  for (let i = 1; i < scores.length; i++) {
    const [a, b] = [scores[i - 1], scores[i]];
    const len = b.time - a.time;
    // the window must end within the period (it may start a little before)
    if (b.time <= from || len <= 0 || len > MAX_SCORE_WINDOW || b.points < a.points) continue;
    any = true;
    const w = 0.5 ** (Math.max(0, now - b.time) / HALF_LIFE);
    const rate = (b.points - a.points) / len;
    // bins whose middle lies in the window (by time of day, across midnight)
    const start = minuteOfDay(a.time);
    const minutes = len / 60;
    for (let k = 0; k < bins; k++) {
      const offset = ((((k + 0.5) * step - start) % DAY) + DAY) % DAY;
      if (offset >= minutes) continue;
      sum[k] += w * rate;
      cover[k] += w;
    }
  }
  if (!any) return [];
  const out = sum.map((s, k) => (cover[k] ? s / cover[k] : null));
  const peak = Math.max(0, ...out.filter((v): v is number => v != null));
  return out.map((v) => (v == null ? null : peak > 0 ? v / peak : 0));
}
