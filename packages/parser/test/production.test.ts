import { describe, expect, it } from 'vitest';
import { calibrate, deriveResourceSpeed, fleetSaveTime, mergeFleetSaves, positionTemp, productionOf, projectResources } from '../src/production.js';
import { storageCapacity } from '../src/tech.js';
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

describe('positionTemp', () => {
  it('is the middle of the default range of the position', () => {
    expect(positionTemp(1)).toBe(240);
    expect(positionTemp(8)).toBe(50);
    expect(positionTemp(15)).toBe(-110);
    expect(positionTemp(99)).toBe(50);
  });
});

describe('projectResources', () => {
  const levels = { 1: 20, 2: 15, 3: 10, 4: 22, 22: 5, 23: 4, 24: 3 };
  const base = { levels, research: {}, temp: 50, resourceSpeed: 1 };

  it('adds the production since the report', () => {
    const perHour = productionOf(base);
    const p = projectResources({ ...base, resources: { 901: 1000, 902: 500, 903: 0 }, hours: 2 });
    expect(p.perHour[901]).toBeCloseTo(perHour[901]);
    expect(p.resources[901]).toBeCloseTo(1000 + 2 * perHour[901]);
    expect(p.resources[903]).toBeCloseTo(2 * perHour[903]);
    expect(p.full[901]).toBe(false);
  });

  it('stops at the storage and keeps resources above it', () => {
    const cap = storageCapacity(5);
    const p = projectResources({ ...base, resources: { 901: cap - 10, 902: storageCapacity(4) + 5000, 903: 0 }, hours: 10 });
    expect(p.resources[901]).toBe(cap);
    expect(p.full[901]).toBe(true);
    expect(p.resources[902]).toBe(storageCapacity(4) + 5000);
    expect(p.capacity[903]).toBe(storageCapacity(3));
  });

  it('scales the storage with the universe factor and never goes back in time', () => {
    const p = projectResources({ ...base, resources: { 901: 0, 902: 0, 903: 0 }, hours: -5, storageFactor: 2 });
    expect(p.resources).toEqual({ 901: 0, 902: 0, 903: 0 });
    expect(p.capacity[901]).toBe(2 * storageCapacity(5));
  });
});

describe('deriveResourceSpeed', () => {
  it('compares the shown metal production with the formula at 1x', () => {
    const levels = { 1: 20, 2: 15, 3: 10, 4: 22 };
    const shown = productionOf({ levels, research: {}, temp: 50, resourceSpeed: 3 });
    expect(deriveResourceSpeed([{ levels, research: {}, temp: 50, perHour: { 901: shown[901] } }])).toBe(3);
    expect(deriveResourceSpeed([{ levels, research: {}, temp: null, perHour: { 901: shown[901] } }, { levels: {}, research: {}, temp: 50, perHour: { 901: 60 } }])).toBeNull();
    // a page without the power plants: the formula's mines get no energy, the planet tells nothing
    expect(deriveResourceSpeed([{ levels: { 1: 25 }, research: {}, temp: 42, perHour: { 901: 38_369 } }])).toBeNull();
  });
});

describe('fleetSaveTime', () => {
  const levels = { 1: 22, 2: 18, 3: 15, 4: 22, 12: 0, 22: 6, 23: 5, 24: 4 };
  const research = { 113: 8, 131: 4, 132: 3 };
  const base = { levels, research, temp: 30, resourceSpeed: 1 };
  /** what a spy report shows `seconds` after a fleet took everything but `left` (< 1) of each resource */
  const shownAfter = (seconds: number, left: number, input: Parameters<typeof productionOf>[0] = { ...base }) => {
    const p = productionOf(input);
    return { 901: Math.floor(left + (seconds * p[901]) / 3600), 902: Math.floor(left + (seconds * p[902]) / 3600), 903: Math.floor(left + (seconds * p[903]) / 3600) };
  };

  it('finds the second of a fleet save that took all resources', () => {
    for (const [seconds, left] of [[3 * 3600 + 17, 0], [5 * 3600 + 1234, 0.97], [42, 0.5], [11 * 3600 + 59, 0.2]] as const) {
      const res = fleetSaveTime({ ...base, resources: shownAfter(seconds, left) });
      expect(res).not.toBeNull();
      expect(res!.ago.min).toBeLessThanOrEqual(seconds);
      expect(res!.ago.max).toBeGreaterThanOrEqual(seconds);
      expect(res!.ago.max - res!.ago.min).toBeLessThan(5);
      expect(res!.deuterium).toBe(true);
    }
  });

  it('tells when deuterium was used after the departure', () => {
    const shown = shownAfter(4 * 3600, 0.3);
    const res = fleetSaveTime({ ...base, resources: { ...shown, 903: Math.floor(shown[903] / 2) } });
    expect(res?.ago.min).toBeLessThanOrEqual(4 * 3600);
    expect(res?.deuterium).toBe(false);
  });

  it('finds nothing when resources were left behind', () => {
    const shown = shownAfter(2 * 3600, 0);
    expect(fleetSaveTime({ ...base, resources: { ...shown, 902: shown[902] + 5000 } })).toBeNull();
  });

  it('applies the mining research and the position bonus to the mines only', () => {
    const bonus = { 901: 0, 902: 15, 903: 0 };
    const shown = shownAfter(6 * 3600 + 321, 0.4, { ...base, bonus });
    const res = fleetSaveTime({ ...base, bonus, resources: shown });
    expect(res!.ago.min).toBeLessThanOrEqual(6 * 3600 + 321);
    expect(res!.ago.max).toBeGreaterThanOrEqual(6 * 3600 + 321);
    // without the bonus crystal points to another second
    expect(fleetSaveTime({ ...base, resources: shown })).toBeNull();
    const p = productionOf({ ...base, bonus });
    const plain = productionOf({ ...base });
    expect(p[902] - 10).toBeCloseTo((plain[902] - 10) * 1.15);
    expect(p[901]).toBeCloseTo(plain[901]);
  });

  it('takes the energy a spy report shows instead of the satellites at a guessed temperature', () => {
    // short of energy: the satellites at the real temperature decide the production level
    const real = { levels: { 1: 16, 2: 15, 3: 10, 4: 14, 212: 12 }, research: { 131: 5, 132: 4, 133: 3 }, temp: 80, resourceSpeed: 1 };
    const energy = productionOf(real).energy;
    const seconds = 3 * 3600 + 777;
    const shown = shownAfter(seconds, 0.6, real);
    const res = fleetSaveTime({ ...real, temp: 50, resources: { ...shown, 911: energy } });
    expect(res!.ago.min).toBeLessThanOrEqual(seconds);
    expect(res!.ago.max).toBeGreaterThanOrEqual(seconds);
    // the formula at the guessed temperature points to a wrong second: metal and crystal shift together
    const guessed = fleetSaveTime({ ...real, temp: 50, resources: shown });
    expect(guessed === null || guessed.ago.max < seconds || guessed.ago.min > seconds).toBe(true);
  });

  it('cannot tell with a full storage or without production', () => {
    const full = storageCapacity(5);
    expect(fleetSaveTime({ ...base, resources: { 901: 1000, 902: full, 903: 0 } })).toBeNull();
    expect(fleetSaveTime({ ...base, levels: {}, resourceSpeed: 0, resources: { 901: 0, 902: 0, 903: 0 } })).toBeNull();
  });
});

describe('mergeFleetSaves', () => {
  it('narrows reports of one save to the second they all allow, per planet', () => {
    // the case of two probes during one save: 43 exactly and 42-43
    const merged = mergeFleetSaves([
      { key: '1:2:3', from: 43, to: 43, id: 1 },
      { key: '1:2:3', from: 42, to: 43, id: 2 },
      { key: '1:2:3', from: 900, to: 902, id: 3 },
      { key: '1:2:4', from: 42, to: 43, id: 4 },
    ]);
    expect(merged.map((m) => [m.key, m.from, m.to, m.items.map((i) => i.id)])).toEqual([
      ['1:2:3', 43, 43, [1, 2]],
      ['1:2:3', 900, 902, [3]],
      ['1:2:4', 42, 43, [4]],
    ]);
  });
});
