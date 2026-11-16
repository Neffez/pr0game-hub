import { universeSettings } from '@pr0hub/core/universe';
import { DEFAULT_UNITS } from '@pr0hub/core/units';
import { distance, drivesFromResearch, fleetConsumption, flightDuration, slowestShip } from '@pr0hub/flight';
import { describe, expect, it } from 'vitest';
import {
  assignPlanet, assignSynced, detectDone, freePlannedKey, plannedKey, simulate, validateBuildOrder, withPlanned, type BuildOrder, type HubPlanet, type HubState, type Step,
} from '../src/index.js';

const HOME = '1:100:8:planet';
const COLONY = '1:120:4:planet';
const PLANNED = plannedKey(1);
const NOW = 1_000_000;
const UNI = universeSettings({ maxInitialPlanets: 1, maxAdditionalPlanets: 20, planetsPerTech: 0.5 });

const planet = (key: string, values: Record<string, number> = {}, resources: Record<number, number> = { 901: 50000, 902: 50000, 903: 50000 }): HubPlanet => {
  const [g, s, p] = key.split(':').map(Number);
  return { key, name: key, coords: { g, s, p }, type: 'planet', temp: 50, arrivals: [], planet: { type: 'planet', values, resources, perHour: {}, time: NOW, queue: [] } };
};
const hubOf = (planets: HubPlanet[], extra: Partial<HubState> = {}): HubState => ({
  planets, research: {}, researchQueue: [], buildingSpeed: 5000, researchSpeed: 5000, shipyardSpeed: 5000, resourceSpeed: 5000, universityFactor: 8, catchUp: 0, storageFactor: 1, ...extra,
});
const transport = (id: string, t: Partial<NonNullable<Step['transport']>>): Step => ({ id, kind: 'transport', transport: { target: COLONY, resources: {}, flight: 600, ...t } });
const run = (order: BuildOrder, hub: HubState) => simulate(order, withPlanned(order, hub, NOW, { resources: { 901: 500, 902: 500, 903: 0 } }), { now: NOW, universe: UNI });
const flight = (ships: Record<string, number>, research: Record<number, number>, to: [number, number, number], speed = 100) => {
  const drives = drivesFromResearch(research);
  const dist = distance(UNI, [1, 100, 8], to);
  const duration = flightDuration(UNI, dist, slowestShip(ships, drives, DEFAULT_UNITS.drives)!.speed, speed);
  return { seconds: Math.floor(duration), fuel: fleetConsumption(UNI, ships, duration, dist, drives, 1, DEFAULT_UNITS.drives) };
};

describe('transports with ships', () => {
  it('flies by the flight formula, pays the fuel and lands on the target', () => {
    const order: BuildOrder = {
      base: { planets: {}, research: {} },
      planets: { [HOME]: [transport('t', { ships: { 202: 2 }, resources: { 901: 4000, 902: 2000, 903: 300 } })], [COLONY]: [{ id: 'm', kind: 'building', element: 14 }] },
    };
    const hub = hubOf([planet(HOME), planet(COLONY, {}, { 901: 0, 902: 0, 903: 0 })], { research: { 115: 2 } });
    const f = flight({ 202: 2 }, { 115: 2 }, [1, 120, 4]);
    const sim = run(order, hub);
    const t = sim.steps.find((s) => s.id === 't')!;
    expect(t).toMatchObject({ state: 'planned', start: NOW, end: NOW + f.seconds, fuel: f.fuel, cost: { 901: 4000, 902: 2000, 903: 300 + f.fuel } });
    // the robot factory on the empty colony needs the deuterium of the cargo
    expect(sim.steps.find((s) => s.id === 'm')!.start).toBe(NOW + f.seconds);
  });

  it('is slower at a lower speed and uses the drives researched at the departure', () => {
    const steps = [transport('slow', { ships: { 202: 1 }, speed: 50 }), { id: 'r', kind: 'research', element: 115 } as Step];
    const hub = hubOf([planet(HOME, { 31: 1 }), planet(COLONY)], { research: { 113: 1, 115: 2 } });
    const sim = run({ base: { planets: {}, research: { 115: 2 } }, planets: { [HOME]: [...steps, transport('fast', { ships: { 202: 1 }, notBefore: NOW + 30 * 86400 })] } }, hub);
    const by = (id: string) => sim.steps.find((s) => s.id === id)!;
    expect(by('slow').end! - by('slow').start!).toBe(flight({ 202: 1 }, { 115: 2 }, [1, 120, 4], 50).seconds);
    expect(by('fast').start).toBe(NOW + 30 * 86400);
    expect(by('fast').end! - by('fast').start!).toBe(flight({ 202: 1 }, { 115: 3 }, [1, 120, 4]).seconds);
  });

  it('waits for the wanted arrival and refuses more cargo than the ships hold', () => {
    const f = flight({ 202: 1 }, {}, [1, 120, 4]);
    const order: BuildOrder = {
      base: { planets: {}, research: {} },
      planets: { [HOME]: [transport('a', { ships: { 202: 1 }, arriveAt: NOW + 86400, resources: { 901: 100 } }), transport('big', { ships: { 202: 1 }, resources: { 901: 5001 } })] },
    };
    const sim = run(order, hubOf([planet(HOME), planet(COLONY)]));
    expect(sim.steps[0]).toMatchObject({ state: 'planned', start: NOW + 86400 - f.seconds, end: NOW + 86400, wait: 'time' });
    expect(sim.steps[1]).toMatchObject({ state: 'invalid', wait: 'cargo' });
  });

  it('loads everything up to the cargo space with `all`', () => {
    const order: BuildOrder = { base: { planets: {}, research: {} }, planets: { [HOME]: [transport('all', { ships: { 202: 1 }, all: true })] } };
    const f = flight({ 202: 1 }, {}, [1, 120, 4]);
    const sim = run(order, hubOf([planet(HOME, {}, { 901: 3000, 902: 9000, 903: 500 }), planet(COLONY)]));
    // metal first, then crystal into what is left after the fuel
    expect(sim.steps[0].cost).toEqual({ 901: 3000, 902: 5000 - f.fuel - 3000, 903: f.fuel });
  });

  it('keeps the fixed flight time without ships', () => {
    const sim = run({ base: { planets: {}, research: {} }, planets: { [HOME]: [transport('p', { flight: 1234, resources: { 901: 10 } })] } }, hubOf([planet(HOME), planet(COLONY)]));
    expect(sim.steps[0]).toMatchObject({ start: NOW, end: NOW + 1234, cost: { 901: 10 } });
    expect(sim.steps[0].fuel).toBeUndefined();
  });
});

describe('planned planets', () => {
  const colonize = (extra: Partial<NonNullable<Step['transport']>> = {}) => transport('col', { target: PLANNED, mission: 'colonize', ships: { 208: 1 }, resources: { 901: 2000 }, ...extra });
  const order = (home: Step[]): BuildOrder => ({
    base: { planets: {}, research: {} },
    planets: { [HOME]: home, [PLANNED]: [{ id: 'mine', kind: 'building', element: 1 }] },
    planned: { [PLANNED]: { name: 'Colony', coords: { g: 1, s: 120, p: 4 }, temp: 20 } },
  });

  it('are founded by the colonization: start resources plus cargo, steps from the arrival on', () => {
    const hub = hubOf([planet(HOME)], { research: { 117: 3, 124: 1 } });
    const f = flight({ 208: 1 }, { 117: 3 }, [1, 120, 4]);
    const sim = run(order([colonize()]), hub);
    expect(sim.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'planned', start: NOW, end: NOW + f.seconds });
    expect(sim.steps.find((s) => s.id === 'mine')).toMatchObject({ state: 'planned', start: NOW + f.seconds, wait: 'colony' });
  });

  it('wait for astrophysics: the ship leaves so that it arrives when the research is done', () => {
    const hub = hubOf([planet(HOME)], { research: { 117: 3 }, researchQueue: [{ id: 124, level: 1, end: NOW + 20000 }] });
    const f = flight({ 208: 1 }, { 117: 3 }, [1, 120, 4]);
    const sim = run(order([colonize()]), hub);
    expect(sim.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'planned', start: NOW + 20000 - f.seconds, end: NOW + 20000, wait: 'astro' });
  });

  it('never start without astrophysics or a colonization', () => {
    const none = run(order([colonize()]), hubOf([planet(HOME)], { research: { 117: 3 } }));
    expect(none.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'invalid', wait: 'astro' });
    expect(none.steps.find((s) => s.id === 'mine')).toMatchObject({ state: 'invalid', wait: 'colony' });
    // without a colonization in the build order the planned planet counts from now on (as before)
    const free = run(order([]), hubOf([planet(HOME)]));
    expect(free.steps.find((s) => s.id === 'mine')).toMatchObject({ state: 'planned', start: NOW });
  });

  it('are assigned once their coordinates are synced; the colonization is done then', () => {
    const o = order([colonize(), transport('later', { target: PLANNED, resources: { 901: 1 } })]);
    expect(assignSynced(o, [HOME])).toBeNull();
    const res = assignSynced(o, [HOME, COLONY])!;
    expect(res.moved).toEqual({ [PLANNED]: COLONY });
    expect(res.order.planned).toBeUndefined();
    expect(res.order.planets[COLONY].map((s) => s.id)).toEqual(['mine']);
    expect(res.order.planets[HOME][0]).toMatchObject({ done: true, transport: { target: COLONY } });
    expect(res.order.planets[HOME][1].done).toBeUndefined();
    expect(assignPlanet(o, PLANNED, COLONY)).toEqual(res.order);
  });

  it('detect the flown colonization by the planned coordinates', () => {
    const o = order([colonize()]);
    const fleets = [{ from: HOME, to: COLONY, mission: 7, resources: { 901: 2000 }, arrival: NOW + 50 }];
    expect(detectDone(o, hubOf([planet(HOME)]), fleets, NOW)).toEqual(['col']);
    expect(detectDone(o, hubOf([planet(HOME)]), [{ ...fleets[0], mission: 3 }], NOW)).toEqual([]);
  });

  it('get the next free key', () => {
    expect(freePlannedKey({ planets: {} })).toBe(plannedKey(1));
    expect(freePlannedKey({ planets: { [plannedKey(1)]: [], [plannedKey(3)]: [] } })).toBe(plannedKey(2));
  });
});

describe('validation', () => {
  const valid = (transport: unknown, planned?: unknown) =>
    validateBuildOrder({ base: { planets: {}, research: {} }, planets: { [HOME]: [{ id: 't', kind: 'transport', transport }], [PLANNED]: [] }, planned });

  it('keeps the transport options and the planned planets', () => {
    const res = valid(
      { target: PLANNED, resources: { 901: 5 }, flight: 0, mission: 'colonize', ships: { 208: 1, 202: 0 }, speed: 70, all: true, notBefore: 5.7, arriveAt: 9 },
      { [PLANNED]: { name: ' Colony ', coords: { g: 1, s: 120, p: 4 }, temp: -20 } },
    );
    expect(res).toEqual({
      order: {
        base: { planets: {}, research: {} },
        planets: {
          [HOME]: [{ id: 't', kind: 'transport', transport: { target: PLANNED, resources: { 901: 5 }, flight: 0, mission: 'colonize', ships: { 208: 1 }, speed: 70, all: true, notBefore: 5, arriveAt: 9 } }],
          [PLANNED]: [],
        },
        planned: { [PLANNED]: { name: 'Colony', coords: { g: 1, s: 120, p: 4 }, temp: -20 } },
      },
    });
  });

  it('refuses wrong options', () => {
    const base = { target: COLONY, resources: {}, flight: 0 };
    for (const bad of [{ mission: 'attack' }, { ships: { 401: 1 } }, { ships: { 999: 1 } }, { speed: 55 }, { speed: 0 }, { notBefore: -1 }])
      expect(valid({ ...base, ...bad }), JSON.stringify(bad)).toHaveProperty('error');
    expect(valid(base, { [HOME]: {} })).toHaveProperty('error');
    expect(valid(base, { [plannedKey(2)]: {} })).toHaveProperty('error');
    expect(valid(base, { [PLANNED]: { coords: { g: 0, s: 1, p: 1 } } })).toHaveProperty('error');
  });
});
