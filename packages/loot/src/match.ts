import type { Battle, Recycling, Res } from './types.js';

/** Seconds two battles may lie apart and still be the same (battle message and report, a report synced later). */
const SAME_BATTLE = 5;

/** Market rate as settlement rate: two decimals, like typed in. */
export const marketRates = (ref: Res): Res => ({ m: Math.round(ref.m * 100) / 100, k: Math.round(ref.k * 100) / 100, d: 1 });

/** Same battle: times within seconds (both unknown counts as the same). */
export const sameBattle = (a: Battle, b: Battle) => (a.time == null || b.time == null ? a.time === b.time : Math.abs(a.time - b.time) <= SAME_BATTLE);
/** Same recycling report: same person and time, or (rows without a time) the same amounts. */
export const sameRecycling = (a: Recycling, b: Recycling) =>
  a.by === b.by && (a.time != null && b.time != null ? a.time === b.time : a.m === b.m && a.k === b.k);
