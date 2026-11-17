/**
 * Seeded random numbers (mulberry32), ported from pr0plan's `planner/rng.js`: the same seed gives the same search, so
 * results can be reproduced and compared.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An integer 0 … n - 1. */
export const pick = (rng: () => number, n: number) => Math.floor(rng() * n);
