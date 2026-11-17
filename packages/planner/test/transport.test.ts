import { universeSettings } from '@pr0hub/core/universe';
import { DEFAULT_UNITS } from '@pr0hub/core/units';
import { distance, drivesFromResearch, fleetConsumption, flightDuration, slowestShip } from '@pr0hub/flight';
import { describe, expect, it } from 'vitest';
import {
  ASTRO_MARGIN, assignPlanet, assignSynced, detectDone, freePlannedKey, plannedKey, simulate, validateBuildOrder, withPlanned, type BuildOrder, type HubPlanet, type HubState, type Step,
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

  it('loads some resources completely after the fixed amounts of the others', () => {
    const order: BuildOrder = { base: { planets: {}, research: {} }, planets: { [HOME]: [transport('some', { ships: { 202: 1 }, all: [902], resources: { 901: 1000, 902: 7 } })] } };
    const f = flight({ 202: 1 }, {}, [1, 120, 4]);
    const sim = run(order, hubOf([planet(HOME, {}, { 901: 3000, 902: 9000, 903: 500 }), planet(COLONY)]));
    // 1000 metal fixed (the 7 crystal are ignored), crystal into what is left after the fuel, no deuterium cargo
    expect(sim.steps[0].cost).toEqual({ 901: 1000, 902: 5000 - f.fuel - 1000, 903: f.fuel });
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

  it('are founded with the start resources, not with those of the home planet', () => {
    const hub = hubOf([planet(HOME, { 1: 20, 2: 18 }, { 901: 2e6, 902: 8e5, 903: 3e5 })], { research: { 117: 3, 124: 1 } });
    const sim = run(order([colonize()]), hub);
    expect(sim.steps.find((s) => s.id === 'mine')!.before).toEqual({ 901: 500 + 2000, 902: 500, 903: 0 });
  });

  it('wait for astrophysics: the ship leaves so that it arrives ASTRO_MARGIN seconds after the research is done', () => {
    const hub = hubOf([planet(HOME)], { research: { 117: 3 }, researchQueue: [{ id: 124, level: 1, end: NOW + 20000 }] });
    const f = flight({ 208: 1 }, { 117: 3 }, [1, 120, 4]);
    const sim = run(order([colonize()]), hub);
    expect(sim.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'planned', start: NOW + 20000 + ASTRO_MARGIN - f.seconds, end: NOW + 20000 + ASTRO_MARGIN, wait: 'astro' });
  });

  it('astrophysics further down the list: the slowest speed that makes it, landing right after the research', () => {
    const hub = hubOf([planet(HOME, { 31: 3 })], { research: { 117: 3, 113: 3, 106: 3 }, researchSpeed: 2500 });
    // a planet in the same system: the flight at full speed is shorter than the research
    const o = order([colonize(), { id: 'astro', kind: 'research', element: 124 }]);
    o.planned![PLANNED].coords = { g: 1, s: 100, p: 4 };
    const sim = run(o, hub);
    const astro = sim.steps.find((s) => s.id === 'astro')!;
    const col = sim.steps.find((s) => s.id === 'col')!;
    expect(astro).toMatchObject({ state: 'planned', start: NOW });
    expect(col).toMatchObject({ state: 'planned', end: astro.end! + ASTRO_MARGIN, wait: 'astro' });
    expect(col.speed).toBeLessThan(100);
    const f = flight({ 208: 1 }, { 117: 3 }, [1, 100, 4], col.speed);
    expect(col.end! - col.start!).toBe(f.seconds);
    expect(col.start!).toBeGreaterThanOrEqual(NOW);
    expect(col.fuel).toBe(f.fuel);
    // one speed step slower would land after the research even leaving now
    expect(NOW + flight({ 208: 1 }, { 117: 3 }, [1, 100, 4], col.speed! - 10).seconds).toBeGreaterThan(astro.end! + ASTRO_MARGIN);
    expect(sim.steps.find((s) => s.id === 'mine')).toMatchObject({ state: 'planned', start: col.end, wait: 'colony' });
  });

  it('astrophysics further down the list with a speed of its own: leaves as late as it can at that speed', () => {
    const hub = hubOf([planet(HOME, { 31: 3 })], { research: { 117: 3, 113: 3, 106: 3 }, researchSpeed: 2500 });
    const o = order([colonize({ speed: 100 }), { id: 'astro', kind: 'research', element: 124 }]);
    o.planned![PLANNED].coords = { g: 1, s: 100, p: 4 };
    const sim = run(o, hub);
    const astro = sim.steps.find((s) => s.id === 'astro')!;
    const col = sim.steps.find((s) => s.id === 'col')!;
    const f = flight({ 208: 1 }, { 117: 3 }, [1, 100, 4]);
    expect(col).toMatchObject({ state: 'planned', start: astro.end! + ASTRO_MARGIN - f.seconds, end: astro.end! + ASTRO_MARGIN, fuel: f.fuel, wait: 'astro' });
    expect(col.speed).toBeUndefined();
    // a colonization keeps its 100 % (without it, it would pick its speed itself)
    const valid = validateBuildOrder(o);
    expect('order' in valid && valid.order.planets[HOME][0].transport!.speed).toBe(100);
  });

  it('transports to the new colony leave once it is founded, not before', () => {
    const hub = hubOf([planet(HOME, { 31: 3 })], { research: { 117: 3, 113: 3, 106: 3 }, researchSpeed: 2500 });
    const supply = transport('supply', { target: PLANNED, ships: { 202: 1 }, resources: { 901: 1000 } });
    // astrophysics further down the list: the colonization's arrival is only set when the research starts
    const o = order([colonize(), { id: 'astro', kind: 'research', element: 124 }, supply]);
    o.planned![PLANNED].coords = { g: 1, s: 100, p: 4 };
    const sim = run(o, hub);
    const col = sim.steps.find((s) => s.id === 'col')!;
    expect(sim.steps.find((s) => s.id === 'supply')).toMatchObject({ state: 'planned', start: col.end, wait: 'colony' });
    // astrophysics already running
    const queued = hubOf([planet(HOME)], { research: { 117: 3 }, researchQueue: [{ id: 124, level: 1, end: NOW + 20000 }] });
    const sim2 = run(order([colonize(), { ...supply, transport: { ...supply.transport!, flight: 600, ships: undefined } }]), queued);
    expect(sim2.steps.find((s) => s.id === 'supply')).toMatchObject({ state: 'planned', start: sim2.steps.find((s) => s.id === 'col')!.end, wait: 'colony' });
  });

  it('transports to a planned planet whose colonization never starts are not possible', () => {
    const hub = hubOf([planet(HOME)], { research: { 117: 3 } });
    const sim = run(order([colonize(), transport('supply', { target: PLANNED, resources: { 901: 1000 } })]), hub);
    expect(sim.steps.find((s) => s.id === 'supply')).toMatchObject({ state: 'invalid' });
  });

  it('waits for its ships from the shipyard', () => {
    const hub = hubOf([planet(HOME, { 21: 4 })], { research: { 117: 3, 124: 1 } });
    const sim = run(order([{ id: 'ship', kind: 'ship', element: 208, count: 1 }, colonize()]), hub);
    const ship = sim.steps.find((s) => s.id === 'ship')!;
    expect(ship.end!).toBeGreaterThan(NOW);
    expect(sim.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'planned', start: ship.end, wait: 'shipyard' });
  });

  it('astrophysics that never starts: the colonization is not possible', () => {
    const hub = hubOf([planet(HOME)], { research: { 117: 3 } });
    // no research lab: the astrophysics step can never start
    const sim = run(order([colonize(), { id: 'astro', kind: 'research', element: 124 }]), hub);
    expect(sim.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'invalid', wait: 'astro', start: null });
    expect(sim.steps.find((s) => s.id === 'mine')).toMatchObject({ state: 'invalid' });
  });

  it('never start without astrophysics or a colonization', () => {
    const none = run(order([colonize()]), hubOf([planet(HOME)], { research: { 117: 3 } }));
    expect(none.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'invalid', wait: 'astro' });
    expect(none.steps.find((s) => s.id === 'mine')).toMatchObject({ state: 'invalid', wait: 'colony' });
    // without a colonization the planned colony is unscheduled: its steps still run from now on (an imported plan
    // shows its timeline), but it is not a planet the account has
    const free = run(order([]), hubOf([planet(HOME)]));
    expect(free.steps.find((s) => s.id === 'mine')).toMatchObject({ state: 'planned', start: NOW });
    expect(free.unscheduled).toEqual([PLANNED]);
  });

  describe('without a colonization', () => {
    const P2 = plannedKey(2);
    const astro = (id: string): Step => ({ id, kind: 'research', element: 124 });
    const colonize2 = transport('col', { target: P2, mission: 'colonize', ships: { 208: 1 }, resources: { 901: 2000 } });
    const colonySteps = Array.from({ length: 25 }, (_, i): Step => ({ id: `c${i}`, kind: 'building', element: 1 + (i % 2) }));
    const research = { 106: 3, 117: 3, 113: 3, 124: 1 };

    it('empty placeholders are not simulated and do not use up the astrophysics limit of a colonization', () => {
      // synced home and colony, astrophysics 2 and 3 in the list, then a colonization of planned planet 2
      const o: BuildOrder = {
        base: { planets: {}, research: { 124: 1 } },
        planets: { [HOME]: [astro('a2'), astro('a3'), colonize2], [P2]: colonySteps, [plannedKey(3)]: [], [plannedKey(4)]: [], [plannedKey(5)]: [] },
        planned: { [P2]: { name: 'Two', coords: { g: 1, s: 100, p: 4 } }, [plannedKey(3)]: { name: 'Three' }, [plannedKey(4)]: { name: 'Four' }, [plannedKey(5)]: { name: 'Five' } },
      };
      const hub = hubOf([planet(HOME, { 31: 3 }), planet(COLONY)], { research });
      const sim = run(o, hub);
      expect(sim.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'planned' });
      for (const s of colonySteps) expect(sim.steps.find((r) => r.id === s.id)!.state).toBe('planned');
      // the placeholders have no steps: no results, but they are marked as not colonized
      expect(sim.steps.filter((s) => s.planet !== HOME && s.planet !== P2)).toEqual([]);
      expect(sim.unscheduled).toEqual([plannedKey(3), plannedKey(4), plannedKey(5)]);
      expect(sim.next[plannedKey(3)]).toBeNull();
    });

    it('a planned colony whose colonization is already flown still counts', () => {
      // planet 1 is colonized (the step is done) but not synced yet: home, it and planet 2 need astrophysics 3
      const o: BuildOrder = {
        base: { planets: {}, research: { 124: 1 } },
        planets: { [HOME]: [{ ...transport('col1', { target: PLANNED, mission: 'colonize', ships: { 208: 1 } }), done: true }, astro('a2'), colonize2], [PLANNED]: [], [P2]: [] },
        planned: { [PLANNED]: { name: 'One', coords: { g: 1, s: 120, p: 4 } }, [P2]: { name: 'Two', coords: { g: 1, s: 100, p: 4 } } },
      };
      const sim = run(o, hubOf([planet(HOME, { 31: 3 })], { research }));
      // astrophysics 2 allows 2 planets: home and planet 1, the colonization of planet 2 never founds it
      expect(sim.steps.find((s) => s.id === 'a2')).toMatchObject({ state: 'planned', target: 2 });
      expect(sim.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'invalid', wait: 'astro' });
      expect(sim.unscheduled).toEqual([]);
    });

    it('a planned colony with steps keeps its timeline but does not count against the limit', () => {
      // astrophysics 1 allows 2 planets: home and planet 2 by its colonization; planet 1 has steps, no colonization
      const o: BuildOrder = {
        base: { planets: {}, research: {} },
        planets: { [HOME]: [colonize2], [PLANNED]: [{ id: 'mine', kind: 'building', element: 1 }], [P2]: [{ id: 'mine2', kind: 'building', element: 1 }] },
        planned: { [P2]: { name: 'Two', coords: { g: 1, s: 100, p: 4 } } },
      };
      const sim = run(o, hubOf([planet(HOME)], { research }));
      expect(sim.steps.find((s) => s.id === 'mine')).toMatchObject({ state: 'planned', start: NOW });
      const col = sim.steps.find((s) => s.id === 'col')!;
      expect(col).toMatchObject({ state: 'planned', start: NOW });
      expect(sim.steps.find((s) => s.id === 'mine2')).toMatchObject({ state: 'planned', start: col.end, wait: 'colony' });
      expect(sim.unscheduled).toEqual([PLANNED]);
    });

    it('before the start the first planned planets up to maxInitialPlanets are start planets that count', () => {
      // no synced planet: planet 1 is the start planet, planet 2 (steps, no colonization) a colony to come
      const o: BuildOrder = {
        base: { planets: { [PLANNED]: { 31: 3 } }, research },
        planets: {
          [PLANNED]: [transport('col', { target: plannedKey(3), mission: 'colonize', resources: {} }), { id: 'mine1', kind: 'building', element: 1 }],
          [P2]: [{ id: 'mine2', kind: 'building', element: 1 }],
          [plannedKey(3)]: [{ id: 'mine3', kind: 'building', element: 1 }],
        },
      };
      const empty = hubOf([], { research });
      const hub = withPlanned(o, empty, NOW, { resources: { 901: 500, 902: 500, 903: 0 } });
      const sim = simulate(o, hub, { now: NOW, universe: UNI });
      expect(sim.unscheduled).toEqual([P2]);
      expect(sim.steps.find((s) => s.id === 'mine1')).toMatchObject({ state: 'planned', start: NOW });
      expect(sim.steps.find((s) => s.id === 'mine2')).toMatchObject({ state: 'planned', start: NOW });
      // astrophysics 1 allows 2 planets: the start planet and planet 3; planet 2 does not take the place
      expect(sim.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'planned', start: NOW, end: NOW + 600 });
      expect(sim.steps.find((s) => s.id === 'mine3')).toMatchObject({ state: 'planned', start: NOW + 600 });
      // with astrophysics 0 only the start planet: the colonization waits for astrophysics that never comes
      const none = simulate(o, withPlanned(o, hubOf([], { research: { ...research, 124: 0 } }), NOW, { resources: { 901: 500, 902: 500, 903: 0 } }), { now: NOW, universe: UNI });
      expect(none.steps.find((s) => s.id === 'col')).toMatchObject({ state: 'invalid', wait: 'astro' });
      // two start planets by the universe: planet 2 is one too
      const two = simulate(o, hub, { now: NOW, universe: { ...UNI, maxInitialPlanets: 2 } });
      expect(two.unscheduled).toEqual([]);
    });
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
    for (const bad of [{ mission: 'attack' }, { ships: { 401: 1 } }, { ships: { 999: 1 } }, { speed: 55 }, { speed: 0 }, { notBefore: -1 }, { all: [904] }])
      expect(valid({ ...base, ...bad }), JSON.stringify(bad)).toHaveProperty('error');
    expect(valid(base, { [HOME]: {} })).toHaveProperty('error');
    expect(valid(base, { [plannedKey(2)]: {} })).toHaveProperty('error');
    expect(valid(base, { [PLANNED]: { coords: { g: 0, s: 1, p: 1 } } })).toHaveProperty('error');
  });

  it('stores `all` as true for all three resources and some of them sorted', () => {
    const all = (v: unknown) => {
      const res = valid({ target: COLONY, resources: {}, flight: 0, all: v });
      return 'order' in res ? res.order.planets[HOME][0].transport!.all : 'error';
    };
    expect(all([903, 901])).toEqual([901, 903]);
    expect(all([901, 902, 903])).toBe(true);
    expect(all([])).toBeUndefined();
  });
});

describe('steps that stay done', () => {
  it('returns built units and finished research, so a ship that flew away is not built again', () => {
    const order: BuildOrder = {
      base: { planets: {}, research: {} },
      planets: { [HOME]: [{ id: 'ship', kind: 'ship', element: 208, count: 1 }, { id: 'astro', kind: 'research', element: 124 }, { id: 'mine', kind: 'building', element: 1 }] },
    };
    // built and researched: both are returned, the building (it can be torn down) is not
    expect(detectDone(order, hubOf([planet(HOME, { 208: 1, 1: 1 })], { research: { 124: 1 } }), [], NOW)).toEqual(['ship', 'astro']);
    // only in the queue: not yet
    expect(detectDone(order, hubOf([planet(HOME)], { researchQueue: [{ id: 124, level: 1, end: NOW + 5 }] }), [], NOW)).toEqual([]);
    // checked off: the ship is gone with the colonization, the step stays done in the timeline
    const kept: BuildOrder = { ...order, planets: { [HOME]: order.planets[HOME].map((s) => (s.id === 'mine' ? s : { ...s, done: true })) } };
    const sim = run(kept, hubOf([planet(HOME)]));
    expect(sim.steps.map((s) => s.state)).toEqual(['done', 'done', 'planned']);
  });
});
