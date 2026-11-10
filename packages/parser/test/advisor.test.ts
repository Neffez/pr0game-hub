import { describe, expect, it } from 'vitest';
import { upgradeAdvice, valueOf, type AdvisorPlanet } from '../src/advisor.js';
import { buildingCost } from '../src/buildings.js';
import { productionOf } from '../src/production.js';

const planet = (levels: Record<string, number>, extra: Partial<AdvisorPlanet> = {}): AdvisorPlanet => ({ key: '1:100:8:planet', name: 'Home', levels, temp: 40, ...extra });
const research = { 113: 8, 131: 2, 132: 2, 133: 2 };
const input = (planets: AdvisorPlanet[]) => ({ planets, research, resourceSpeed: 1, rate: { m: 3, k: 2 } });

describe('upgrade advisor', () => {
  it('ranks the next mine levels by payback time from cost and extra production', () => {
    // plenty of energy: every mine level runs at full power
    const list = upgradeAdvice(input([planet({ 1: 20, 2: 18, 3: 15, 4: 30, 21: 2, 31: 1 })]));
    const metal = list.find((a) => a.step.element === 1)!;
    expect(metal.step).toEqual({ kind: 'building', element: 1, level: 21 });
    expect(metal.with).toEqual([]);
    expect(metal.cost).toEqual(buildingCost(1, 21));
    const p = (l: number) => productionOf({ levels: { 1: l, 2: 18, 3: 15, 4: 30 }, research, temp: 40, resourceSpeed: 1 })[901];
    expect(metal.gain[901]).toBeCloseTo(p(21) - p(20));
    expect(metal.payback).toBeCloseTo(valueOf(metal.cost) / valueOf(metal.gain));
    expect(list.map((a) => a.payback)).toEqual([...list.map((a) => a.payback)].sort((a, b) => a - b));
  });

  it('pairs a mine with the cheapest energy when it would run short', () => {
    // energy just enough today: the next level needs more
    const levels = { 1: 21, 2: 18, 3: 10, 4: 21 };
    const now = productionOf({ levels, research, temp: 40, resourceSpeed: 1 });
    expect(now.energy).toBeGreaterThanOrEqual(now.energyUsed);
    const list = upgradeAdvice(input([planet(levels)]));
    const metal = list.find((a) => a.step.element === 1)!;
    expect(metal.with).toHaveLength(1);
    const after = { ...levels, 1: 22, ...(metal.with[0].kind === 'satellites' ? { 212: metal.with[0].level } : { [metal.with[0].element]: metal.with[0].level }) };
    const e = productionOf({ levels: after, research, temp: 40, resourceSpeed: 1 });
    expect(e.energy).toBeGreaterThanOrEqual(e.energyUsed - 1);
  });

  it('scales the gains to the production the synced page showed', () => {
    const levels = { 1: 20, 2: 18, 3: 15, 4: 30 };
    const formula = productionOf({ levels, research, temp: 40, resourceSpeed: 1 });
    // the page showed half the metal (production setting 50 %)
    const half = upgradeAdvice(input([planet(levels, { perHour: { 901: formula[901] / 2, 902: formula[902], 903: formula[903] } })])).find((a) => a.step.element === 1)!;
    const full = upgradeAdvice(input([planet(levels)])).find((a) => a.step.element === 1)!;
    expect(half.gain[901]).toBeCloseTo(full.gain[901] / 2);
  });

  it('calibrates against the levels the synced page showed, not the ones after the build queue', () => {
    // the page showed metal mine 20 at exactly the formula's production; mine 21 is in the queue
    const synced = { 1: 20, 2: 18, 3: 15, 4: 30 };
    const queued = { ...synced, 1: 21 };
    const perHour = productionOf({ levels: synced, research, temp: 40, resourceSpeed: 1 });
    const plain = upgradeAdvice(input([planet(queued)])).find((a) => a.step.element === 1)!;
    const calibrated = upgradeAdvice(input([planet(queued, { perHour, syncedLevels: synced })])).find((a) => a.step.element === 1)!;
    // the advice is the level after the queue, its gain is not scaled down by the queued mine
    expect(calibrated.step.level).toBe(22);
    expect(calibrated.gain[901]).toBeCloseTo(plain.gain[901]);
    // without the synced levels the page's production is compared with mine 21: the gain is underrated
    const wrong = upgradeAdvice(input([planet(queued, { perHour })])).find((a) => a.step.element === 1)!;
    expect(wrong.gain[901]).toBeLessThan(plain.gain[901] * 0.95);
    // research in the queue: the page's production belongs to the research before it
    const more = { ...research, 131: 3 };
    const queuedResearch = upgradeAdvice({ ...input([planet(synced, { perHour, syncedLevels: synced })]), research: more, syncedResearch: research }).find((a) => a.step.element === 1)!;
    const plainResearch = upgradeAdvice({ ...input([planet(synced)]), research: more }).find((a) => a.step.element === 1)!;
    expect(queuedResearch.gain[901]).toBeCloseTo(plainResearch.gain[901]);
  });

  it('counts the mining research on every planet', () => {
    const levels = { 1: 20, 2: 18, 3: 15, 4: 30, 31: 4 };
    const one = upgradeAdvice(input([planet(levels)])).find((a) => a.step.element === 131);
    const two = upgradeAdvice(input([planet(levels), planet(levels, { key: '1:101:4:planet' })])).find((a) => a.step.element === 131);
    expect(one?.key).toBeNull();
    expect(two!.gain[901]).toBeCloseTo(2 * one!.gain[901]);
    expect(two!.payback).toBeCloseTo(one!.payback / 2);
  });

  it('suggests energy alone only while the mines are short of it', () => {
    const short = upgradeAdvice(input([planet({ 1: 25, 2: 22, 3: 18, 4: 10 })]));
    expect(short.some((a) => a.step.element === 4 && a.with.length === 0 && a.step.kind === 'building')).toBe(true);
    const fine = upgradeAdvice(input([planet({ 1: 20, 2: 18, 3: 15, 4: 30 })]));
    expect(fine.some((a) => a.step.element === 4)).toBe(false);
  });
});
