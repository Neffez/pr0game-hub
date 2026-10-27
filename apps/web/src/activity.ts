/** Activity pattern of a player: evidence of online times laid over one day and smoothed (see `activityCurve`). */

export type ActivitySource = 'spy' | 'attack' | 'defense' | 'message' | 'points' | 'galaxy' | 'fleet' | 'recall' | 'manual';

export interface ActivityEvent {
  time: number;
  /** half width of the uncertainty in seconds */
  spread: number;
  source: ActivitySource;
  id?: number;
  reporter?: string | null;
  mine?: boolean;
}

/** How much one piece of evidence counts: galaxy marks are also set by others' actions, point gains are vague. */
export const SOURCE_WEIGHT: Record<ActivitySource, number> = {
  spy: 1, attack: 1, defense: 1, message: 1, fleet: 1, recall: 1, manual: 1, galaxy: 0.4, points: 0.3,
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
 * Activity over the day in `bins` steps (bin i covers minute i·1440/bins), scaled to a peak of 1: every event of the
 * last `days` adds a Gaussian around its time of day (wrapping at midnight), wider by its uncertainty and weighted by
 * its source and age. Empty without events.
 */
export function activityCurve(events: ActivityEvent[], now: number, days: number, bins = 288): number[] {
  const from = now - days * 86400;
  const out = new Array<number>(bins).fill(0);
  const step = DAY / bins;
  let any = false;
  for (const e of events) {
    if (e.time < from || e.time > now + 60) continue;
    any = true;
    // a uniform window of ±spread has the standard deviation spread/√3
    const sigma = Math.sqrt(BANDWIDTH ** 2 + (e.spread / 60 / Math.sqrt(3)) ** 2);
    const w = (SOURCE_WEIGHT[e.source] * 0.5 ** (Math.max(0, now - e.time) / HALF_LIFE)) / sigma;
    const m = minuteOfDay(e.time);
    for (let i = 0; i < bins; i++) {
      const d = ((((i + 0.5) * step - m) % DAY) + DAY * 1.5) % DAY - DAY / 2;
      out[i] += w * Math.exp(-(d * d) / (2 * sigma * sigma));
    }
  }
  if (!any) return [];
  const peak = Math.max(...out);
  return peak > 0 ? out.map((v) => v / peak) : out;
}
