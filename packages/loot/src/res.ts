import { ELEMENT_COSTS } from '@pr0hub/core/tech';
import type { Res, ResKey, Ships } from './types.js';
import { RES_KEYS } from './types.js';

export const ZERO: Res = Object.freeze({ m: 0, k: 0, d: 0 });
export const res = (r?: Partial<Res> | null): Res => ({ m: r?.m ?? 0, k: r?.k ?? 0, d: r?.d ?? 0 });
export const add = (a: Res, b: Res): Res => ({ m: a.m + b.m, k: a.k + b.k, d: a.d + b.d });
export const sub = (a: Res, b: Res): Res => ({ m: a.m - b.m, k: a.k - b.k, d: a.d - b.d });
export const scale = (a: Res, f: number): Res => ({ m: a.m * f, k: a.k * f, d: a.d * f });
export const sum = (list: Res[]): Res => list.reduce(add, { ...ZERO });
export const total = (r: Res) => r.m + r.k + r.d;
export const isZero = (r: Res) => r.m === 0 && r.k === 0 && r.d === 0;

/** Value in deuterium at market rates given as metal and crystal per deuterium (like the game's `convertToDeut`). */
export function deutValue(r: Res, rates: Res): number {
  return r.m / rate(rates, 'm') + r.k / rate(rates, 'k') + r.d / rate(rates, 'd');
}

/** Units of `key` per deuterium; invalid rates count as 1. */
export function rate(rates: Res, key: ResKey): number {
  const v = rates[key];
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Building costs of ships (or missiles). Unknown elements cost nothing. */
export function shipCosts(ships: Ships): Res {
  const out = { ...ZERO };
  for (const [id, amount] of Object.entries(ships)) {
    const c = ELEMENT_COSTS[id];
    if (!c || !amount) continue;
    out.m += c[0] * amount;
    out.k += c[1] * amount;
    out.d += c[2] * amount;
  }
  return out;
}

/** Ships lost between the start and the end of a battle. */
export function lostShips(start: Ships, end: Ships): Ships {
  const out: Ships = {};
  for (const [id, amount] of Object.entries(start)) {
    const lost = amount - (end[Number(id)] ?? 0);
    if (lost > 0) out[Number(id)] = lost;
  }
  return out;
}

/**
 * Integers proportional to `weights` that add up to exactly `amount` (largest remainder). Equal parts when all
 * weights are 0.
 */
export function apportion(amount: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sumW = weights.reduce((s, w) => s + Math.max(0, w), 0);
  const w = sumW > 0 ? weights.map((x) => Math.max(0, x) / sumW) : weights.map(() => 1 / weights.length);
  return roundTo(amount, w.map((x) => x * amount));
}

/** Rounds `values` to integers so that they add up to exactly `amount` (largest remainder). */
export function roundTo(amount: number, values: number[]): number[] {
  if (!values.length) return [];
  const floors = values.map((v) => Math.floor(v + 1e-9));
  let diff = Math.round(amount) - floors.reduce((s, v) => s + v, 0);
  const order = values.map((v, i) => ({ i, frac: v - floors[i] }));
  if (diff > 0) {
    order.sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let j = 0; diff > 0; j = (j + 1) % order.length, diff--) floors[order[j].i]++;
  } else if (diff < 0) {
    order.sort((a, b) => a.frac - b.frac || a.i - b.i);
    for (let j = 0; diff < 0; j = (j + 1) % order.length, diff++) floors[order[j].i]--;
  }
  return floors;
}

/** `roundTo` per resource over a list of resources. */
export function roundResTo(amount: Res, values: Res[]): Res[] {
  const out = values.map(() => ({ ...ZERO }));
  for (const key of RES_KEYS) {
    roundTo(amount[key], values.map((v) => v[key])).forEach((v, i) => (out[i][key] = v));
  }
  return out;
}
