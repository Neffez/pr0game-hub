import { CAPACITY } from '@pr0hub/flight';
import { add, deutValue, isZero, res, sub, total, ZERO } from './res.js';
import type { Res, Transfer } from './types.js';
import { RES_KEYS } from './types.js';

export interface Balance {
  id: string;
  /** positive = gets, negative = sends */
  balance: Res;
}

/** Cargo ships needed for `amount` resources. */
export function cargoShips(amount: number, cargoShip: number): number {
  const capacity = CAPACITY[cargoShip] ?? CAPACITY[203];
  return amount > 0 ? Math.ceil(amount / capacity) : 0;
}

/**
 * Transfers that settle the balances with few flights: the biggest senders pay the biggest receivers first, in the
 * same order for every resource, so that one flight carries several resources.
 */
export function planTransfers(balances: Balance[], cargoShip: number, rates: Res): Transfer[] {
  const net = new Map(balances.map((b) => [b.id, deutValue(b.balance, rates)]));
  const senders = [...balances].sort((a, b) => net.get(a.id)! - net.get(b.id)!);
  const receivers = [...balances].sort((a, b) => net.get(b.id)! - net.get(a.id)!);
  const flights = new Map<string, Transfer>();
  for (const key of RES_KEYS) {
    const give = senders.filter((b) => b.balance[key] < 0).map((b) => ({ id: b.id, left: -b.balance[key] }));
    const take = receivers.filter((b) => b.balance[key] > 0).map((b) => ({ id: b.id, left: b.balance[key] }));
    let i = 0;
    let j = 0;
    while (i < give.length && j < take.length) {
      const amount = Math.min(give[i].left, take[j].left);
      const pair = `${give[i].id}\u0000${take[j].id}`;
      const t = flights.get(pair) ?? { from: give[i].id, to: take[j].id, res: { ...ZERO }, ships: 0 };
      t.res[key] += amount;
      flights.set(pair, t);
      give[i].left -= amount;
      take[j].left -= amount;
      if (give[i].left === 0) i++;
      if (take[j].left === 0) j++;
    }
  }
  return [...flights.values()].map((t) => ({ ...t, ships: cargoShips(total(t.res), cargoShip) }));
}

/** What is left of every balance after the transfers (0 everywhere = settled). */
export function remaining(balances: Balance[], transfers: Pick<Transfer, 'from' | 'to' | 'res'>[]): Map<string, Res> {
  const out = new Map(balances.map((b) => [b.id, { ...b.balance }]));
  for (const t of transfers) {
    const r = res(t.res);
    if (out.has(t.from)) out.set(t.from, add(out.get(t.from)!, r));
    if (out.has(t.to)) out.set(t.to, sub(out.get(t.to)!, r));
  }
  return out;
}

/** True when the transfers settle every balance. */
export function settled(balances: Balance[], transfers: Pick<Transfer, 'from' | 'to' | 'res'>[]): boolean {
  return [...remaining(balances, transfers).values()].every(isZero);
}
