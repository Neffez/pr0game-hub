import { readFileSync } from 'node:fs';
import { buildTime, buildingCost } from '@pr0hub/core/buildings';
import { describe, expect, it } from 'vitest';
import {
  baseFromFile, baseFromHub, compareSettings, doneStateOf, ImportError, parsePr0plan, simulate, targetsOf, toBuildOrder, validateBuildOrder, detectDone, type BuildOrder, type HubPlanet, type OwnFleet,
  type HubState, type Step,
} from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const HOME = '1:100:8:planet';
const COLONY = '1:120:4:planet';

const planet = (key: string, values: Record<string, number> = {}, extra: Partial<HubPlanet['planet']> = {}, temp = 50): HubPlanet => {
  const [g, s, p] = key.split(':').map(Number);
  return {
    key, name: key, coords: { g, s, p }, type: 'planet', temp, arrivals: [],
    planet: { type: 'planet', values, resources: { 901: 5000, 902: 1500, 903: 0 }, perHour: {}, time: 0, queue: [], ...extra },
  };
};
const hubOf = (planets: HubPlanet[], extra: Partial<HubState> = {}): HubState => ({
  planets, research: {}, researchQueue: [], buildingSpeed: 5000, researchSpeed: 5000, shipyardSpeed: 5000, resourceSpeed: 10000,
  universityFactor: 8, catchUp: 0, storageFactor: 1, ...extra,
});
let n = 0;
const id = () => `s${n++}`;
const exampleOrder = (hub: HubState) => {
  const imp = parsePr0plan(fixture('buildOrderWithSettings.json'));
  n = 0;
  return toBuildOrder(imp, { 1: HOME }, baseFromFile(imp, { 1: HOME }), id);
};

describe('pr0plan import', () => {
  it('reads both export formats', () => {
    const plain = parsePr0plan(fixture('buildOrder.json'));
    const full = parsePr0plan(fixture('buildOrderWithSettings.json'));
    expect(plain.settings).toBeNull();
    expect(plain.planets).toHaveLength(1);
    expect(plain.planets[0].steps).toHaveLength(47);
    expect(full.planets[0].steps).toEqual(plain.planets[0].steps);
    expect(full.planets[0].steps.slice(0, 2)).toEqual([{ kind: 'building', element: 4 }, { kind: 'building', element: 1 }]);
    expect(full.planets[0].steps.filter((s) => s.kind === 'research').map((s) => s.element)).toEqual([113, 106, 117, 106, 117, 117, 106, 124]);
    expect(full.settings).toMatchObject({ resourceSpeed: 4, buildSpeed: 2, researchSpeed: 2, planets: { 1: { name: 'Home planet', temp: 50, levels: {} } } });
    expect(full.skipped).toEqual([]);
  });

  it('maps ships, defense, production and transports, skips unknown keys', () => {
    const imp = parsePr0plan({
      1: [
        { type: 'BUILD_SHIP', payload: { planetId: '1', ship: 'solarSatelite', count: 20 } },
        { type: 'BUILD_DEFENSE', payload: { planetId: '1', defense: 'interplanetaryMissile', count: 2 }, deactivated: true },
        { type: 'SET_PROD', payload: { planetId: '1', settings: { metalMine: 0.5, crystalMine: 1, deuteriumSynthesizer: 0, extra_wait: 0.5, awaitBuilding: true } } },
        { type: 'TRANSPORT', payload: { planetId: '1', settings: { metal: 1000, crystal: 500, deuterium: 0, flight_time: 1.5, target: '2' } } },
        { type: 'RESEARCH', payload: { planetId: '1', tech: 'warpDrive' } },
      ],
      2: [],
    });
    const steps = imp.planets[0].steps;
    expect(steps[0]).toEqual({ kind: 'ship', element: 212, count: 20 });
    expect(steps[1]).toEqual({ kind: 'defense', element: 503, count: 2, deactivated: true });
    expect(steps[2].prod).toEqual({ factors: { 1: 0.5, 2: 1, 3: 0 }, awaitBuilding: true, awaitResearch: false, awaitShipyard: false, wait: 1800 });
    expect(steps[3].transport).toEqual({ target: '2', resources: { 901: 1000, 902: 500, 903: 0 }, flight: 5400 });
    expect(imp.skipped).toEqual(['RESEARCH warpDrive']);
    const order = toBuildOrder(imp, { 1: HOME, 2: COLONY }, { planets: {}, research: {} }, id);
    expect(order.planets[HOME][3].transport!.target).toBe(COLONY);
    expect(toBuildOrder(imp, { 1: HOME, 2: null }, { planets: {}, research: {} }, id).planets[HOME][3].transport!.target).toBeNull();
  });

  it('rejects what is not a build order', () => {
    expect(() => parsePr0plan('{')).toThrow(ImportError);
    expect(() => parsePr0plan({ foo: 1 })).toThrow(ImportError);
    expect(() => parsePr0plan({ 1: [] })).toThrow(ImportError);
  });
});

describe('targets and done steps', () => {
  const step = (s: Partial<Step>): Step => ({ id: id(), kind: 'building', ...s });

  it('derives the target levels from the base and the steps before', () => {
    const steps = [step({ element: 1 }), step({ element: 2 }), step({ element: 1 }), step({ kind: 'ship', element: 212, count: 5 }), step({ kind: 'ship', element: 212, count: 5 })];
    const order: BuildOrder = { base: { planets: { [HOME]: { 1: 3, 212: 2 } }, research: {} }, planets: { [HOME]: steps } };
    const t = targetsOf(order);
    expect(steps.map((s) => t.get(s.id))).toEqual([4, 1, 5, 7, 12]);
    // reordering renumbers
    const swapped: BuildOrder = { ...order, planets: { [HOME]: [steps[2], steps[1], steps[0]] } };
    expect([steps[2], steps[0]].map((s) => targetsOf(swapped).get(s.id))).toEqual([4, 5]);
  });

  it('is done when built, queued when only the queue reaches it', () => {
    const hub = hubOf([planet(HOME, { 1: 4 }, { queue: [{ id: 1, level: 5, destroy: false, end: 100 }] })], { research: { 113: 1 }, researchQueue: [{ id: 113, level: 2, end: 50 }] });
    const s = step({ element: 1 });
    expect(doneStateOf(s, 4, HOME, hub)).toBe('done');
    expect(doneStateOf(s, 5, HOME, hub)).toBe('queued');
    expect(doneStateOf(s, 6, HOME, hub)).toBe('open');
    expect(doneStateOf(step({ kind: 'research', element: 113 }), 2, HOME, hub)).toBe('queued');
    expect(doneStateOf(step({ kind: 'prod' }), undefined, HOME, hub)).toBe('open');
    expect(doneStateOf(step({ kind: 'prod', done: true }), undefined, HOME, hub)).toBe('done');
  });

  it('takes the hub levels with the queues as base', () => {
    const hub = hubOf([planet(HOME, { 1: 4, 212: 3 }, { queue: [{ id: 1, level: 5, destroy: false, end: 100 }], shipyard: { 212: 2 } })], { research: { 113: 1 } });
    expect(baseFromHub(hub, [HOME])).toEqual({ planets: { [HOME]: { 1: 5, 212: 5 } }, research: { 113: 1 } });
  });

  it('compares the file settings with the hub', () => {
    const imp = parsePr0plan(fixture('buildOrderWithSettings.json'));
    expect(compareSettings(imp, hubOf([planet(HOME)]), { 1: HOME })).toEqual([]);
    const other = hubOf([planet(HOME, {}, {}, 20)], { resourceSpeed: 7500, researchSpeed: null });
    expect(compareSettings(imp, other, { 1: HOME })).toEqual([
      { key: 'resourceSpeed', file: 4, hub: 3 },
      { key: 'temp', planet: HOME, file: 50, hub: 20 },
    ]);
    expect(compareSettings(parsePr0plan(fixture('buildOrder.json')), other, { 1: HOME })).toEqual([]);
  });
});

describe('simulate', () => {
  const at = (sim: ReturnType<typeof simulate>, i: number) => sim.steps[i];

  it('plans the example from a fresh planet like the game', () => {
    const hub = hubOf([planet(HOME)]);
    const order = exampleOrder(hub);
    const sim = simulate(order, hub, { now: 1000 });
    // solar plant 1 right away, metal mine 1 when the slot is free
    const solar = buildTime(buildingCost(4, 1), 0, 0, 5000);
    expect(at(sim, 0)).toMatchObject({ state: 'planned', start: 1000, end: 1000 + solar, target: 1, wait: null });
    expect(at(sim, 1)).toMatchObject({ state: 'planned', start: 1000 + solar, end: 1000 + solar + buildTime(buildingCost(1, 1), 0, 0, 5000), wait: 'slot' });
    // starts never go back in a list, and every step waits for the one before
    const planned = sim.steps.filter((s) => s.state === 'planned');
    planned.slice(1).forEach((s, i) => expect(s.start!).toBeGreaterThanOrEqual(planned[i].start!));
    // research waits for the lab being built, then runs next to the buildings
    const lab = sim.steps.find((s) => order.planets[HOME].find((x) => x.id === s.id)!.element === 31)!;
    const energy = sim.steps.find((s) => order.planets[HOME].find((x) => x.id === s.id)!.element === 113)!;
    expect(energy).toMatchObject({ start: lab.end, wait: 'nolab' });
    // impulse engine 3 costs more crystal than the storage holds: production stops at the capacity, the rest has to
    // come by transport (overflow); then astrophysics follows
    const impulse = at(sim, 43);
    expect(impulse).toMatchObject({ state: 'planned', wait: 'storage' });
    expect(impulse.transport![902]).toBeGreaterThan(0);
    expect(impulse.transport![902]).toBeLessThan(impulse.cost![902]);
    expect(at(sim, 45)).toMatchObject({ state: 'planned' });
    expect(sim.steps.filter((x) => x.state === 'invalid')).toEqual([]);
    // the metal mine after the last research starts while it runs
    expect(at(sim, 46).start!).toBeLessThan(at(sim, 45).end!);
    expect(sim.next).toEqual({ [HOME]: order.planets[HOME][0].id });
    // without storages every step fits
    expect(simulate(order, hub, { now: 1000, noStorage: true }).steps.filter((s) => s.state === 'invalid')).toEqual([]);
  });

  it('skips what the hub already built and continues from its state', () => {
    const hub = hubOf([planet(HOME, { 1: 3, 2: 2, 4: 2 }, { queue: [{ id: 4, level: 3, destroy: false, end: 2000 }] })]);
    const order = exampleOrder(hub);
    const sim = simulate(order, hub, { now: 1000 });
    expect(sim.steps.slice(0, 9).map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done', 'planned', 'queued']);
    // the next open step (crystal mine 3) waits for the running solar plant 3
    expect(sim.next[HOME]).toBe(order.planets[HOME][7].id);
    expect(at(sim, 7)).toMatchObject({ start: 2000, wait: 'slot', target: 3 });
  });

  it('counts landing fleets and transports of the build order', () => {
    const steps: Step[] = [{ id: 'a', kind: 'building', element: 22 }];
    const order: BuildOrder = { base: { planets: {}, research: {} }, planets: { [HOME]: steps } };
    const poor = planet(HOME, { 1: 1, 4: 1 }, { resources: { 901: 0, 902: 0, 903: 0 } });
    const alone = simulate(order, hubOf([poor]), { now: 0 }).steps[0];
    const fleet = simulate(order, hubOf([{ ...poor, arrivals: [{ at: 600, resources: { 901: 1000 }, mission: 3, back: false }] }]), { now: 0 }).steps[0];
    expect(fleet.start).toBe(600);
    expect(alone.start!).toBeGreaterThan(600);

    const colony = planet(COLONY, {}, { resources: { 901: 0, 902: 0, 903: 0 } });
    const shipped: BuildOrder = {
      base: { planets: {}, research: {} },
      planets: {
        [HOME]: [{ id: 't', kind: 'transport', transport: { target: COLONY, resources: { 901: 2000 }, flight: 3600 } }],
        [COLONY]: [{ id: 'b', kind: 'building', element: 22 }],
      },
    };
    const sim = simulate(shipped, hubOf([planet(HOME), colony]), { now: 0 });
    expect(sim.steps.find((s) => s.id === 't')).toMatchObject({ start: 0, end: 3600 });
    expect(sim.steps.find((s) => s.id === 'b')!.start!).toBeLessThanOrEqual(3600);
  });

  it('builds ships in the shipyard and waits for its requirements', () => {
    const order: BuildOrder = {
      base: { planets: { [HOME]: { 21: 1 } }, research: {} },
      planets: { [HOME]: [{ id: 'sat', kind: 'ship', element: 212, count: 2 }, { id: 'yard', kind: 'building', element: 21 }, { id: 'sat2', kind: 'ship', element: 212, count: 1 }] },
    };
    const hub = hubOf([planet(HOME, {}, { resources: { 901: 50000, 902: 50000, 903: 50000 } })]);
    const sim = simulate(order, hub, { now: 0 });
    // no shipyard yet: the satellites can never be built in this order
    expect(sim.steps[0]).toMatchObject({ state: 'invalid', wait: 'requirements' });
    // with the shipyard in the queue they wait for it
    const queued = hubOf([planet(HOME, { 14: 2 }, { resources: { 901: 50000, 902: 50000, 903: 50000 }, queue: [{ id: 21, level: 1, destroy: false, end: 500 }] })]);
    const sim2 = simulate(order, queued, { now: 0 });
    expect(sim2.steps[0]).toMatchObject({ state: 'planned', start: 500, wait: 'requirements' });
    // the shipyard can't be upgraded while the satellites are built
    expect(sim2.steps[1]).toMatchObject({ state: 'planned', start: sim2.steps[0].end, wait: 'shipyard' });
    expect(sim2.steps[2]).toMatchObject({ state: 'planned', start: sim2.steps[1].end, wait: 'shipyard' });
  });

  it('applies production steps', () => {
    const steps: Step[] = [
      { id: 'p', kind: 'prod', prod: { factors: { 1: 0 }, awaitBuilding: false, awaitResearch: false, awaitShipyard: false, wait: 0 } },
      { id: 'b', kind: 'building', element: 22 },
    ];
    const poor = planet(HOME, { 1: 5, 4: 5 }, { resources: { 901: 0, 902: 0, 903: 0 } });
    const full = simulate({ base: { planets: {}, research: {} }, planets: { [HOME]: steps.slice(1) } }, hubOf([poor]), { now: 0 }).steps[0];
    const off = simulate({ base: { planets: {}, research: {} }, planets: { [HOME]: steps } }, hubOf([poor]), { now: 0 }).steps[1];
    expect(off.start!).toBeGreaterThan(full.start!);
  });

  it('calibrates the production against the synced one', () => {
    const order: BuildOrder = { base: { planets: {}, research: {} }, planets: { [HOME]: [{ id: 'b', kind: 'building', element: 22 }] } };
    const poor = (perHour: Record<string, number>) => planet(HOME, { 1: 5, 4: 5 }, { resources: { 901: 0, 902: 0, 903: 0 }, perHour });
    // 1000 metal at 3600/h: 1000 s, whatever the formula says
    expect(simulate(order, hubOf([poor({ 901: 3600 })]), { now: 0 }).steps[0].start).toBe(1000);
    expect(simulate(order, hubOf([poor({ 901: 3600 })], { resourceSpeed: null }), { now: 0 }).steps[0].start).toBe(1000);
  });
});

describe('validateBuildOrder', () => {
  it('accepts an imported order and cleans it', () => {
    const imp = parsePr0plan(fixture('buildOrderWithSettings.json'));
    const order = toBuildOrder(imp, { 1: HOME }, baseFromFile(imp, { 1: HOME }), id);
    const res = validateBuildOrder(JSON.parse(JSON.stringify(order)));
    expect(res).toEqual({ order });
  });

  it('rejects unknown elements, duplicate ids and bad keys', () => {
    const base = { planets: {}, research: {} };
    expect(validateBuildOrder({ base, planets: { [HOME]: [{ id: 'a', kind: 'building', element: 999 }] } })).toHaveProperty('error');
    expect(validateBuildOrder({ base, planets: { [HOME]: [{ id: 'a', kind: 'ship', element: 401, count: 1 }] } })).toHaveProperty('error');
    expect(validateBuildOrder({ base, planets: { [HOME]: [{ id: 'a', kind: 'building', element: 1 }, { id: 'a', kind: 'building', element: 1 }] } })).toHaveProperty('error');
    expect(validateBuildOrder({ base, planets: { 'x': [] } })).toHaveProperty('error');
    expect(validateBuildOrder({ base, planets: { [HOME]: [{ id: 'a', kind: 'transport', transport: { target: COLONY, resources: { 901: 5 }, flight: 60 }, extra: 1 }] } })).toEqual({
      order: { base, planets: { [HOME]: [{ id: 'a', kind: 'transport', transport: { target: COLONY, resources: { 901: 5 }, flight: 60 } }] } },
    });
  });
});

describe('detectDone', () => {
  const prod = (id: string, m: number): Step => ({ id, kind: 'prod', prod: { factors: { 1: m, 2: 1, 3: 1 }, awaitBuilding: false, awaitResearch: false, awaitShipyard: false, wait: 0 } });
  const transport = (id: string): Step => ({ id, kind: 'transport', transport: { target: COLONY, resources: { 901: 1000, 902: 500 }, flight: 3600 } });
  const fleet = (extra: Partial<OwnFleet> = {}): OwnFleet => ({ from: HOME, to: COLONY, mission: 3, resources: { 901: 1000, 902: 500 }, arrival: 5000, ...extra });

  it('checks off production steps by the empire page setting, in list order', () => {
    const order: BuildOrder = { base: { planets: { [HOME]: { 1: 5 } }, research: {} }, planets: { [HOME]: [prod('p1', 0.5), { id: 'b', kind: 'building', element: 1 }, prod('p2', 1)] } };
    const hub = (factors: Record<string, number> | null, values: Record<string, number> = { 1: 5 }) => hubOf([{ ...planet(HOME, values), factors }]);
    expect(detectDone(order, hub({ 1: 0.5, 2: 1, 3: 1 }), [], 0)).toEqual(['p1']);
    expect(detectDone(order, hub({ 1: 1, 2: 1, 3: 1 }), [], 0)).toEqual([]);
    expect(detectDone(order, hub(null), [], 0)).toEqual([]);
    // after the metal mine is built, the second step needs 100 %
    expect(detectDone({ ...order, planets: { [HOME]: [{ ...prod('p1', 0.5), done: true }, order.planets[HOME][1], prod('p2', 1)] } }, hub({ 1: 1 }, { 1: 6 }), [], 0)).toEqual(['p2']);
  });

  it('checks off transports by own fleets after the import, each fleet once', () => {
    const order: BuildOrder = { base: { planets: {}, research: {} }, planets: { [HOME]: [transport('t1'), transport('t2')] } };
    const hub = hubOf([planet(HOME), planet(COLONY)]);
    expect(detectDone(order, hub, [fleet()], 0)).toEqual(['t1']);
    expect(detectDone(order, hub, [fleet(), fleet({ mission: 4, arrival: 6000 })], 0)).toEqual(['t1', 't2']);
    expect(detectDone(order, hub, [fleet({ arrival: 100 })], 1000)).toEqual([]);
    expect(detectDone(order, hub, [fleet({ resources: { 901: 100 } })], 0)).toEqual([]);
    expect(detectDone(order, hub, [fleet({ to: HOME })], 0)).toEqual([]);
    expect(detectDone(order, hub, [fleet({ mission: 1 })], 0)).toEqual([]);
  });

  it('plans with the production setting of the empire page', () => {
    const order: BuildOrder = { base: { planets: {}, research: {} }, planets: { [HOME]: [{ id: 'b', kind: 'building', element: 22 }] } };
    const poor = (factors: Record<string, number> | null) => ({ ...planet(HOME, { 1: 5, 4: 5 }, { resources: { 901: 0, 902: 0, 903: 0 }, perHour: { 901: 1800 } }), factors });
    // synced at 50 %: 1800/h; a production step to 100 % then doubles it
    const steps: Step[] = [prod('p', 1), { id: 'b', kind: 'building', element: 22 }];
    const half = simulate({ ...order, planets: { [HOME]: steps } }, hubOf([poor({ 1: 0.5 })]), { now: 0 }).steps[1].start!;
    const full = simulate({ ...order, planets: { [HOME]: steps } }, hubOf([poor(null)]), { now: 0 }).steps[1].start!;
    expect(full).toBe(2000);
    expect(half).toBeLessThan(1100);
  });
});
