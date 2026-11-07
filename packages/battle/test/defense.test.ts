import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initSync, wasm_fight_battle_rounds } from '../wasm/battlerust.js';
import { defenseAdvice, valueIn, type DefenseSearch } from '../src/index.js';

initSync({ module: readFileSync(new URL('../wasm/battlerust_bg.wasm', import.meta.url)) });
const fight = wasm_fight_battle_rounds;
const research = { 109: 8, 110: 8, 111: 8 };
const rate = { m: 3, k: 2 };
const candidates = [401, 402, 403, 404, 405, 406].map((id) => ({ id, max: 1_000_000 })).concat([{ id: 407, max: 1 }, { id: 408, max: 1 }]);

const search = (over: Partial<DefenseSearch> = {}): DefenseSearch => ({
  planet: { units: { 401: 20 }, research },
  resources: { metal: 2_000_000, crystal: 1_000_000, deuterium: 500_000 },
  threats: [{ key: 'raider', units: { 203: 300, 205: 100 }, research, fuel: 2000 }],
  candidates,
  rate,
  debris: true,
  maxFactor: 20,
  runs: 6,
  work: 20_000_000,
  ...over,
});

describe('defense advisor', () => {
  it('values resources in deuterium by the rate', () => {
    expect(valueIn({ metal: 300, crystal: 200, deuterium: 100 }, rate)).toBe(300);
  });

  it('says safe when no attacker profits', () => {
    const a = defenseAdvice(fight, search({ resources: { metal: 0, crystal: 0, deuterium: 0 } }));
    expect(a.status).toBe('safe');
    expect(a.before[0].profit).toBeLessThanOrEqual(0);
    expect(a.after).toBeNull();
    expect(a.add).toEqual({});
  });

  it('finds defense that makes a profitable raid a loss', () => {
    const a = defenseAdvice(fight, search());
    expect(a.before[0].profit).toBeGreaterThan(0);
    expect(a.before[0].wins).toBe(1);
    expect(a.status).toBe('found');
    expect(a.after![0].profit).toBeLessThanOrEqual(0);
    expect(Object.values(a.add).some((n) => n > 0)).toBe(true);
    expect(a.costValue).toBeGreaterThan(0);
    // the cost is the units' cost
    expect(a.cost.metal).toBeGreaterThan(0);
    expect(a.battles).toBeGreaterThan(0);
  });

  it('stops at the cost cap', () => {
    const a = defenseAdvice(fight, search({ threats: [{ key: 'big', units: { 207: 3000, 215: 500 }, research: { 109: 14, 110: 14, 111: 14 }, fuel: 0 }], maxFactor: 0.01 }));
    expect(a.status).toBe('limit');
    expect(a.after![0].profit).toBeGreaterThan(0);
  });

  it('reports the engine budget when the battles are too large', () => {
    const a = defenseAdvice(fight, search({ work: 100 }));
    expect(a.status).toBe('budget');
    expect(a.before).toEqual([]);
  });

  it('builds only the candidates', () => {
    const a = defenseAdvice(fight, search({ candidates: [{ id: 401, max: 1_000_000 }] }));
    expect(Object.keys(a.add)).toEqual(['401']);
  });
});
