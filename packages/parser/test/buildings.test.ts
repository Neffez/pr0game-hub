import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildingCost, buildingsFor, catchUpBonus, catchUpFromCosts, labLevels, researchOf, researchTime, buildingsOf, buildTime, deriveBuildingSpeed, requirementsOf, resourceAt, resourceReadyAt, type BuildPlanet,
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
      { id: 21, level: 8, cost: { 901: 89600, 902: 44800, 903: 22400 }, time: 5000, busy: true },
      { id: 15, level: 0, cost: { 901: 875000, 902: 437500, 903: 87500 }, time: 80000 },
    ]);
  });
});

describe('real buildings page', () => {
  const rec = parsePage({ html: fixture('buildings-real-source.html') }).records[0];
  if (rec.kind !== 'buildings') throw new Error('expected buildings');

  it('parses the page as the game renders it', () => {
    expect(rec).toMatchObject({
      coords: { g: 1, s: 100, p: 12 }, type: 'planet', pageTime: '2026-10-24 02:14:21', catchUp: 10.18, fields: { used: 168, max: 208 },
      resources: { 901: 30353, 902: 17953, 903: 15790 }, storage: { 901: 4325000, 902: 2350000, 903: 2350000 },
      perHour: { 901: 38434.85904, 902: 22733.784085, 903: 19994.068649 }, queue: [],
    });
    expect(rec.buildings.map((b) => [b.id, b.level, b.time])).toEqual([[1, 25, 6958], [12, 11, 2975], [14, 10, 1956], [15, 4, 88183], [33, 0, 183], [35, 0, 80]]);
    expect(rec.buildings[0].cost).toEqual({ 901: 1360779, 902: 340195 });
    // the terraformer's energy is part of the cost as shown
    expect(rec.buildings[4].cost).toEqual({ 902: 44908, 903: 89816, 911: 1000 });
  });

  it('reproduces the costs and build times of the game with the exact catch-up bonus', () => {
    const bonus = catchUpFromCosts(rec)!;
    // the page prints 10.18 %, the costs need 10.1838…
    expect(bonus).toBeCloseTo(10.1838, 3);
    for (const b of rec.buildings) {
      const cost = buildingCost(b.id, b.level + 1, bonus);
      for (const [r, x] of Object.entries(b.cost)) if (Number(r) !== 911) expect(Math.round(cost[Number(r)])).toBe(x);
      // building speed 5000, robot factory 10, nanite factory 4
      expect(buildTime(cost, 10, 4, 5000)).toBe(b.time);
    }
    // the rounded percent is off by tens of metal
    expect(Math.round(buildingCost(1, 26, 10.18)[901])).not.toBe(1360779);
  });

  it('when the resources are there, like "possible in" on the page', () => {
    const p = {
      type: 'planet' as const, values: { 1: 25, 12: 11, 14: 10, 15: 4, 22: 12, 23: 11, 24: 11, 31: 10, 21: 10 }, resources: rec.resources,
      perHour: rec.perHour, storage: rec.storage, time: 0, queue: [],
    };
    const list = buildingsOf(p, { research: { 108: 10, 113: 20 }, catchUp: catchUpFromCosts(rec), now: 0 });
    // page: 124614 s (metal mine), 45816 s (fusion plant)
    expect(list.find((b) => b.id === 1)!.readyAt).toBeCloseTo(124614, -1);
    expect(list.find((b) => b.id === 12)!.readyAt).toBeCloseTo(45816, -1);
    // the game says 1343178 s for the nanite factory, but its 14.4 M metal never fit into the 4.3 M storage
    expect(list.find((b) => b.id === 15)).toMatchObject({ state: 'storage', readyAt: null });
  });

  it('catch-up bonus from the statistics like getCatchUpFactor', () => {
    expect(catchUpBonus(1000, 1000)).toBe(0);
    // far behind: raw factor 10 → the full 50 %
    expect(catchUpBonus(1, 1e9)).toBeCloseTo(50, 5);
    // 50 % of the leader: 10 × 0.9747^50 = 2.78…
    expect(catchUpBonus(500, 1000)).toBeCloseTo((50 / 9) * (10 * 0.9747 ** 50 - 1), 10);
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

  it('uses the robot and nanite factories after the queue for the build time', () => {
    const queued = buildingsOf({ ...planet, queue: [{ id: 14, level: 3, destroy: false }] }, { research: {}, now: 0, buildingSpeed: 2500 });
    // robot factory 2 + 1 queued
    expect(byId(queued, 1).time).toBe(buildTime(buildingCost(1, 11), 3, 0, 2500));
    // a demolition is queued with the level it takes down: robot factory 2 → 1
    const down = buildingsOf({ ...planet, queue: [{ id: 14, level: 2, destroy: true }] }, { research: {}, now: 0, buildingSpeed: 2500 });
    expect(byId(down, 1).time).toBe(buildTime(buildingCost(1, 11), 1, 0, 2500));
    // and the next build of it is level 2 again
    expect(byId(down, 14).next).toBe(2);
    // the page's time (today's factories) no longer holds then
    const shown = { 1: { next: 11, cost: buildingCost(1, 11), time: 999 } };
    expect(byId(buildingsOf(planet, { research: {}, now: 0, shown }), 1).time).toBe(999);
    expect(byId(buildingsOf({ ...planet, queue: [{ id: 14, level: 3, destroy: false }] }, { research: {}, now: 0, shown }), 1).time).toBeNull();
  });

  it('locks lab and shipyard while research or the shipyard work, like the game', () => {
    const rich = { ...planet, values: { ...planet.values, 31: 1 }, resources: { 901: 1e6, 902: 1e6, 903: 1e6 } };
    const list = buildingsOf({ ...rich, busy: { research: { until: 500 }, shipyard: { until: null } } }, { research: {}, now: 100 });
    expect(byId(list, 31)).toMatchObject({ state: 'busy', busy: { by: 'research', until: 500 }, readyAt: 500 });
    expect(byId(list, 21)).toMatchObject({ state: 'busy', busy: { by: 'shipyard', until: null } });
    expect(byId(list, 1)).toMatchObject({ state: 'buildable', busy: null });
    // research done by now: free again
    expect(byId(buildingsOf({ ...rich, busy: { research: { until: 50 } } }, { research: {}, now: 100 }), 31)).toMatchObject({ state: 'buildable', busy: null });
    // missing resources: ready once both are there
    const poor = buildingsOf({ ...planet, perHour: { 901: 1000, 902: 100, 903: 100 }, values: { ...planet.values, 31: 1 }, busy: { research: { until: 1e9 } } }, { research: {}, now: 0 });
    expect(byId(poor, 31)).toMatchObject({ state: 'resources', readyAt: 1e9 });
  });

  it('is buildable once the resources are there', () => {
    const list = buildingsOf({ ...planet, resources: { 901: 1e6, 902: 1e6, 903: 1e6 } }, { research: {}, now: 100 });
    // there since the page time
    expect(byId(list, 1)).toMatchObject({ state: 'buildable', readyAt: 0, missing: {} });
  });
});

describe('research', () => {
  it('parses the research page: levels, costs, times, queue and the lab lock', () => {
    const res = parsePage({ html: fixture('research.html') });
    expect(res.pageType).toBe('research');
    const rec = res.records[0];
    if (rec.kind !== 'research') throw new Error('expected research');
    expect(rec).toMatchObject({
      coords: { g: 1, s: 100, p: 12 }, type: 'planet', catchUp: 10.18, labBusy: true, noLab: false,
      resources: { 901: 500000 }, perHour: { 902: 22733.784085 },
      // the planet name after "@" (started elsewhere) is dropped
      queue: [{ id: 113, level: 13, end: 4102444800 }, { id: 106, level: 9, end: 4102448400 }],
    });
    expect(rec.research).toEqual([
      { id: 106, level: 8, cost: { 901: 45986, 902: 229930, 903: 45986 }, time: 1234 },
      { id: 123, level: 0, cost: { 901: 215563, 902: 359272, 903: 143709 }, time: 9999 },
    ]);
    // and the buildings page is not mistaken for it
    expect(parsePage({ html: fixture('buildings.html') }).pageType).toBe('buildings');
  });

  it('counts labs like getNetworkLevel and times like getBuildingTime', () => {
    // no network: only the own lab
    expect(labLevels(106, 10, [12, 8], 0)).toBe(10);
    // network 2: own lab + the two best others
    expect(labLevels(106, 10, [12, 8, 3], 2)).toBe(30);
    // graviton needs lab 12: labs below do not count
    expect(labLevels(199, 10, [12, 8], 2)).toBe(12);
    const cost = { 901: 100000, 902: 200000 };
    // 300000 / (1000 × 11) / (5000 / 2500) h, TechnoDome 2 with 8 %
    expect(researchTime(cost, 10, 5000)).toBe(Math.floor((300000 / 11000 / 2) * 3600));
    expect(researchTime(cost, 10, 5000, 2, 8)).toBe(Math.floor((300000 / 11000 / 2) * 0.92 ** 2 * 3600));
  });

  it('lists the research of a planet with lab, requirements, queue and lab lock', () => {
    const planet: BuildPlanet = {
      type: 'planet', values: { 31: 8, 22: 10, 23: 10, 24: 10 }, resources: { 901: 1e6, 902: 1e6, 903: 1e6 }, perHour: { 901: 1000, 902: 1000, 903: 1000 },
      time: 0, queue: [],
    };
    const o = { research: { 113: 5, 106: 4 }, queue: [{ id: 106, level: 5 }], otherLabs: [], researchSpeed: 2500, now: 0 };
    const list = researchOf(planet, o);
    const spy = list.find((r) => r.id === 106)!;
    expect(spy).toMatchObject({ level: 4, next: 6, state: 'buildable', groups: ['military'] });
    expect(spy.time).toBe(researchTime(buildingCost(106, 6), 8, 2500));
    expect(list.find((r) => r.id === 114)).toMatchObject({ groups: ['imperial', 'engines'], useful: 8, state: 'requirements' });
    // a lab in a build queue blocks research
    expect(researchOf({ ...planet, busy: { lab: { until: null } } }, o).find((r) => r.id === 106)!.state).toBe('busy');
    // no lab: nothing to research here
    expect(researchOf({ ...planet, values: {} }, o).every((r) => r.state === 'nolab')).toBe(true);
  });
});

