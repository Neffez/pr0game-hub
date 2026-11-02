import { describe, expect, it } from 'vitest';
import { calibrate, productionOf } from '../src/production.js';
import { missileSpace, requirementsOf, shipsOf, shipyardTime, type BuildPlanet } from '../src/buildings.js';

describe('productionOf', () => {
  it('mines and solar plant like the vars formulas, basic income included', () => {
    const p = productionOf({ levels: { 1: 1, 2: 1, 4: 1 }, research: {}, temp: 50, resourceSpeed: 1 });
    expect(p.energy).toBe(22);
    expect(p.energyUsed).toBeCloseTo(22);
    expect(p[901]).toBeCloseTo(33 + 20);
    expect(p[902]).toBeCloseTo(22 + 10);
    expect(p[903]).toBe(0);
  });

  it('scales with the resource multiplier, not the energy', () => {
    const p = productionOf({ levels: { 1: 10, 4: 12 }, research: {}, temp: 50, resourceSpeed: 4 });
    const mine = 30 * 10 * Math.pow(1.1, 10);
    expect(p[901]).toBeCloseTo((mine + 20) * 4);
    expect(p.energy).toBe(Math.round(20 * 12 * Math.pow(1.1, 12)));
  });

  it('cuts production when energy is short', () => {
    const p = productionOf({ levels: { 1: 2, 2: 2 }, research: {}, temp: 50, resourceSpeed: 1 });
    expect(p.energy).toBe(0);
    expect(p[901]).toBe(20);
    const half = productionOf({ levels: { 1: 4, 4: 2 }, research: {}, temp: 50, resourceSpeed: 1 });
    const level = half.energy / half.energyUsed;
    expect(level).toBeLessThan(1);
    expect(half[901]).toBeCloseTo(30 * 4 * Math.pow(1.1, 4) * level + 20);
  });

  it('deuterium with the temperature, fusion, satellites and mining research', () => {
    const d = productionOf({ levels: { 3: 1, 4: 5 }, research: {}, temp: 50, resourceSpeed: 1 });
    expect(d[903]).toBe(Math.floor(11 * (1.44 - 0.2)));
    const sats = productionOf({ levels: { 212: 10 }, research: {}, temp: 50, resourceSpeed: 1 });
    expect(sats.energy).toBe(350);
    const fusion = productionOf({ levels: { 1: 10, 3: 10, 12: 5, 4: 10 }, research: { 113: 3, 131: 5 }, temp: 20, resourceSpeed: 1 });
    expect(fusion.energy).toBe(Math.round(20 * 10 * Math.pow(1.1, 10) + 30 * 5 * Math.pow(1.08, 5)));
    const level = Math.min(1, fusion.energy / fusion.energyUsed);
    expect(fusion[901]).toBeCloseTo(30 * 10 * Math.pow(1.1, 10) * 1.1 * level + 20);
    const synth = Math.floor(10 * 10 * Math.pow(1.1, 10) * (1.44 - 0.08));
    expect(fusion[903]).toBeCloseTo(synth * level - 10 * 5 * Math.pow(1.1, 5));
  });

  it('applies production settings', () => {
    const p = productionOf({ levels: { 1: 5, 4: 10 }, research: {}, temp: 50, resourceSpeed: 1, factors: { 1: 0.5 } });
    expect(p[901]).toBeCloseTo(30 * 5 * Math.pow(1.1, 5) * 0.5 + 20);
  });

  it('calibrates against synced production', () => {
    const formula = productionOf({ levels: { 1: 5, 2: 5, 4: 10 }, research: {}, temp: 50, resourceSpeed: 1 });
    expect(calibrate({ 901: formula[901] * 0.8, 902: formula[902] }, formula)).toEqual({ 901: expect.closeTo(0.8), 902: 1, 903: 1 });
  });
});

describe('shipyard', () => {
  const planet = (values: Record<string, number>, extra: Partial<BuildPlanet> = {}): BuildPlanet => ({
    type: 'planet', values, resources: { 901: 100000, 902: 50000, 903: 20000 }, perHour: { 901: 3600, 902: 1800, 903: 360 },
    storage: { 901: 1e6, 902: 1e6, 903: 1e6 }, time: 1000, queue: [], ...extra,
  });

  it('build time like getBuildingTime for fleet and defense', () => {
    expect(shipyardTime({ 901: 3000, 902: 1000 }, 2, 0, 2500)).toBe(1920);
    expect(shipyardTime({ 901: 3000, 902: 1000 }, 2, 1, 5000)).toBe(480);
  });

  it('requirements of ships and defense from install.sql', () => {
    expect(requirementsOf(202, { 21: 2 }, { 115: 1 })).toEqual([
      { id: 21, need: 2, own: 2 },
      { id: 115, need: 2, own: 1 },
    ]);
  });

  it('how many units, one per planet and silo space', () => {
    const p = planet({ 21: 4, 44: 2, 401: 3, 407: 1, 503: 3 }, { shipyard: { 502: 2 }, resources: { 901: 1e6, 902: 1e6, 903: 1e6 } });
    expect(missileSpace(p)).toBe(20 - 2 - 6);
    const info = Object.fromEntries(shipsOf(p, { research: { 110: 2, 117: 1, 115: 2 }, shipyardSpeed: 2500, now: 1000 }).map((s) => [s.id, s]));
    expect(info[202]).toMatchObject({ state: 'buildable', max: 500, time: 1152 });
    expect(info[407]).toMatchObject({ state: 'max', max: 0, count: 1 });
    expect(info[502].max).toBe(12);
    expect(info[503].max).toBe(6);
    expect(info[205].state).toBe('requirements');
  });

  it('waits while the shipyard or nanite factory is built', () => {
    const p = planet({ 21: 4 }, { queue: [{ id: 21, level: 5, destroy: false, end: 5000 }] });
    const lf = shipsOf(p, { research: { 115: 2 }, shipyardSpeed: 2500, now: 1000 }).find((s) => s.id === 202)!;
    expect(lf.busy).toEqual({ by: 'building', until: 5000 });
    expect(lf.state).toBe('busy');
    expect(lf.readyAt).toBe(5000);
  });
});
