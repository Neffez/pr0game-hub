import { describe, expect, it } from 'vitest';
import { defenseAdvice, heavyShips, raidRisk, researchComparison, valueIn, type DefenseSearch } from '../src/index.js';
import { fight, hasEngine } from './wasm.js';

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

describe.skipIf(!hasEngine)('defense advisor', () => {
  it('values resources in deuterium by the rate', () => {
    expect(valueIn({ metal: 300, crystal: 200, deuterium: 100 }, rate)).toBe(300);
  });

  it('compares research steps plus defense with defense only', () => {
    const shields = { id: 110, level: 9, cost: { metal: 51_200, crystal: 153_600, deuterium: 0 }, time: 3600 };
    const c = researchComparison(fight, { ...search(), steps: [shields], share: 0.5 });
    expect(c.share).toBe(0.5);
    expect(c.options).toHaveLength(2);
    const [only, withShields] = c.options;
    expect(only!.step).toBeNull();
    expect(only!.total).toBeCloseTo(only!.advice.costValue);
    expect(withShields!.step).toEqual(shields);
    expect(withShields!.researchValue).toBeCloseTo(valueIn(shields.cost, rate));
    expect(withShields!.counted).toBeCloseTo(withShields!.researchValue / 2);
    expect(withShields!.total).toBeCloseTo(withShields!.counted + withShields!.advice.costValue);
    // the stronger shields need no more defense than defense alone
    expect(withShields!.advice.before[0]!.profit).toBeLessThanOrEqual(only!.advice.before[0]!.profit + 1);
    expect(c.best).not.toBeNull();
    const best = c.options[c.best!]!;
    expect(c.options.filter((o) => o.advice.status === 'found' || o.advice.status === 'safe').every((o) => o.total >= best.total)).toBe(true);
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

describe.skipIf(!hasEngine)('raid risk', () => {
  it('ranks the planets by the most profitable attack on them as they are', () => {
    const threats = [{ key: 'raider', units: { 203: 300, 205: 100 }, research, fuel: 2000 }, { key: 'raider:heavy', units: { 205: 100 }, research, fuel: 500 }];
    const r = raidRisk(fight, {
      planets: [
        { key: 'open', planet: { units: { 401: 5 }, research }, resources: { metal: 2_000_000, crystal: 1_000_000, deuterium: 0 }, threats },
        { key: 'bunker', planet: { units: { 401: 3000, 402: 2000, 406: 50 }, research }, resources: { metal: 100_000, crystal: 0, deuterium: 0 }, threats },
        { key: 'none', planet: { units: {}, research }, resources: { metal: 0, crystal: 0, deuterium: 0 }, threats: [] },
      ],
      rate, debris: true, runs: 4, work: 20_000_000,
    });
    expect(r.runs).toBe(4);
    const [open, bunker, none] = r.planets;
    expect(open.outcomes).toHaveLength(2);
    expect(open.worst!.profit).toBeGreaterThan(0);
    expect(bunker.worst!.profit).toBeLessThan(0);
    expect(none.worst).toBeNull();
  });

  it('leaves out battles over the engine budget', () => {
    const r = raidRisk(fight, {
      planets: [{ key: 'p', planet: { units: { 401: 10 }, research }, resources: { metal: 1000, crystal: 0, deuterium: 0 }, threats: [{ key: 'x', units: { 204: 100 }, research, fuel: 0 }] }],
      rate, debris: true, runs: 4, work: 10,
    });
    expect(r.planets[0].skipped).toBe(1);
    expect(r.planets[0].worst).toBeNull();
  });
});

describe.skipIf(!hasEngine)('heavy ships', () => {
  it('keeps the ships from the battleship up', () => {
    expect(heavyShips({ 202: 10, 203: 5, 204: 100, 206: 20, 207: 30, 209: 4, 210: 3, 211: 2, 213: 1, 214: 1, 215: 7 })).toEqual({ 207: 30, 211: 2, 213: 1, 214: 1, 215: 7 });
  });
});
