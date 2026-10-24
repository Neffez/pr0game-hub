import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildingCost, buildingsFor, buildingsOf, buildTime, deriveBuildingSpeed, requirementsOf, resourceAt, resourceReadyAt, type BuildPlanet,
} from '../src/buildings.js';
import { parsePage } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('buildings page', () => {
  it('parses levels, costs, build times, queue, resource bar and catch-up bonus', () => {
    const res = parsePage({ html: fixture('buildings.html') });
    expect(res.pageType).toBe('buildings');
    const rec = res.records[0];
    if (rec.kind !== 'buildings') throw new Error('expected buildings');
    expect(rec).toMatchObject({
      coords: { g: 1, s: 100, p: 12 }, type: 'planet', pageTime: '2026-10-23 10:00:00', catchUp: 12.5,
      resources: { 901: 120000, 902: 45000, 903: 30000 },
      storage: { 901: 1215000, 902: 655000, 903: 355000 },
      perHour: { 901: 6000.5, 902: 3000, 903: 1500 },
      queue: [{ id: 2, level: 16, destroy: false, end: 1792749600 }],
    });
    expect(rec.buildings).toEqual([
      { id: 1, level: 18, cost: { 901: 77907, 902: 19476 }, time: 2804 },
      { id: 2, level: 15, cost: { 901: 49000, 902: 47000 }, time: 3100 },
      { id: 15, level: 0, cost: { 901: 875000, 902: 437500, 903: 87500 }, time: 80000 },
    ]);
  });
});

describe('building formulas', () => {
  it('costs like getElementPrice, with the catch-up bonus', () => {
    expect(buildingCost(1, 1)).toEqual({ 901: 60, 902: 15 });
    expect(buildingCost(1, 10)).toEqual({ 901: 60 * 1.5 ** 9, 902: 15 * 1.5 ** 9 });
    expect(buildingCost(14, 3, 10)).toEqual({ 901: 400 * 4 * 0.9, 902: 120 * 4 * 0.9, 903: 200 * 4 * 0.9 });
  });

  it('build time like getBuildingTime and the speed back from it', () => {
    const cost = { 901: 100000, 902: 50000 };
    // 150000 / (2500 × 11) × 0.5² h
    expect(buildTime(cost, 10, 2, 2500)).toBe(Math.floor((150000 / (2500 * 11)) * 0.25 * 3600));
    expect(deriveBuildingSpeed(cost, buildTime(cost, 10, 2, 2500), 10, 2)).toBe(2500);
    expect(deriveBuildingSpeed(cost, 30, 10, 2)).toBeNull();
  });

  it('lists the buildings of planets and moons, with requirements', () => {
    expect(buildingsFor('moon')).toEqual([14, 21, 22, 23, 24, 41, 42, 43]);
    expect(buildingsFor('planet')).toContain(1);
    expect(requirementsOf(15, { 14: 6 }, { 108: 10 })).toEqual([
      { id: 14, need: 10, own: 6 },
      { id: 108, need: 10, own: 10 },
    ]);
  });

  it('projects resources with production up to the storage and landing fleets', () => {
    // 1000/h from 0, cap 5000: 3000 after 3 h, capped at 5000, a fleet fills above it
    expect(resourceAt(0, 1000, 5000, 0, 3 * 3600)).toBe(3000);
    expect(resourceAt(0, 1000, 5000, 0, 10 * 3600)).toBe(5000);
    expect(resourceAt(0, 1000, 5000, 0, 10 * 3600, [{ at: 9 * 3600, amount: 4000 }])).toBe(9000);
    // fleets landed before the snapshot are part of it already
    expect(resourceAt(0, 1000, 5000, 3600, 3600, [{ at: 1800, amount: 4000 }])).toBe(0);
  });

  it('time until a resource is there, fleets on the way included', () => {
    // 10000 missing at 1000/h: 10 h; 5000 landing after 2 h: 5 h
    expect(resourceReadyAt(10000, 0, 1000, 1e6, 0)).toBe(10 * 3600);
    expect(resourceReadyAt(10000, 0, 1000, 1e6, 0, [{ at: 2 * 3600, amount: 5000 }])).toBe(5 * 3600);
    // the fleet alone is enough
    expect(resourceReadyAt(10000, 0, 1000, 1e6, 0, [{ at: 3600, amount: 9500 }])).toBe(3600);
    // no production
    expect(resourceReadyAt(10000, 0, 0, 1e6, 0)).toBeNull();
    // more than the storage holds: only a fleet gets there
    expect(resourceReadyAt(10000, 0, 1000, 8000, 0)).toBeNull();
    expect(resourceReadyAt(10000, 0, 1000, 8000, 0, [{ at: 9 * 3600, amount: 3000 }])).toBe(9 * 3600);
  });
});

describe('buildingsOf', () => {
  const planet: BuildPlanet = {
    type: 'planet',
    values: { 1: 10, 2: 5, 14: 2, 22: 5, 23: 5, 24: 5 },
    resources: { 901: 1000, 902: 0, 903: 0 },
    perHour: { 901: 1000, 902: 100, 903: 0 },
    time: 0,
    fields: { used: 20, max: 163 },
    queue: [],
  };
  const byId = (list: ReturnType<typeof buildingsOf>, id: number) => list.find((b) => b.id === id)!;

  it('next level, missing resources and when they are there', () => {
    const list = buildingsOf(planet, { research: {}, now: 0 });
    const mine = byId(list, 1);
    expect(mine).toMatchObject({ level: 10, next: 11, state: 'resources', time: null });
    const cost = buildingCost(1, 11);
    expect(mine.missing).toEqual({ 901: cost[901] - 1000, 902: cost[902] });
    // crystal is the slower one: cost / 100 per hour
    expect(mine.readyAt).toBe(Math.ceil((cost[902] / 100) * 3600));
    // without crystal production the mine never gets there
    expect(byId(buildingsOf({ ...planet, perHour: { 901: 1000 } }, { research: {}, now: 0 }), 1)).toMatchObject({ state: 'never', readyAt: null });
    expect(byId(list, 15).state).toBe('requirements');
  });

  it('counts the queue, fleets and full fields', () => {
    const queued = buildingsOf({ ...planet, queue: [{ id: 1, level: 11, destroy: false }] }, { research: {}, now: 0, buildingSpeed: 2500 });
    expect(byId(queued, 1).next).toBe(12);
    expect(byId(queued, 1).time).toBe(buildTime(buildingCost(1, 12), 2, 0, 2500));
    const cost = buildingCost(1, 11);
    const fed = buildingsOf(planet, { research: {}, now: 0, arrivals: [{ at: 60, resources: { 901: 1e6, 902: 1e6 }, mission: 3, back: false }] });
    expect(byId(fed, 1).readyAt).toBe(60);
    expect(cost[901]).toBeLessThan(1e6);
    const full = buildingsOf({ ...planet, fields: { used: 163, max: 163 } }, { research: {}, now: 0 });
    expect(byId(full, 1).state).toBe('fields');
  });

  it('is buildable once the resources are there', () => {
    const list = buildingsOf({ ...planet, resources: { 901: 1e6, 902: 1e6, 903: 1e6 } }, { research: {}, now: 100 });
    // there since the page time
    expect(byId(list, 1)).toMatchObject({ state: 'buildable', readyAt: 0, missing: {} });
  });
});
