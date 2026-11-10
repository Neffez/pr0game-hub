import { describe, expect, it } from 'vitest';
import { assignPlanet, isPlannedKey, plannedKey, plannedNumber, plannedPlanet, simulate, validateBuildOrder, type BuildOrder, type HubState } from '../src/index.js';

const HOME = '1:100:8:planet';
const hub = (planets: HubState['planets']): HubState => ({
  planets, research: {}, researchQueue: [], buildingSpeed: 2500, researchSpeed: 2500, shipyardSpeed: 2500, resourceSpeed: 2500,
  universityFactor: 8, catchUp: 0, storageFactor: 1,
});

describe('planned planets', () => {
  it('keys of planets without coordinates', () => {
    expect(plannedKey(1)).toBe('0:0:1:planet');
    expect(plannedNumber('0:0:12:planet')).toBe(12);
    expect(plannedNumber(HOME)).toBeNull();
    expect(isPlannedKey('0:0:1:moon')).toBe(false);
    // the stored order accepts them
    expect('order' in validateBuildOrder({ base: { planets: { [plannedKey(1)]: { 1: 1 } }, research: {} }, planets: { [plannedKey(1)]: [{ id: 'a', kind: 'building', element: 1 }] } })).toBe(true);
  });

  it('simulates a fresh planet from the start', () => {
    const key = plannedKey(1);
    const order: BuildOrder = { base: { planets: { [key]: { 4: 1 } }, research: {} }, planets: { [key]: [{ id: 'm', kind: 'building', element: 1 }, { id: 'm2', kind: 'building', element: 1 }] } };
    const start = 1_000_000;
    const sim = simulate(order, hub([plannedPlanet(order, key, start)]), { now: start });
    // metal mine 1 costs 60/15: affordable with the start resources right away
    expect(sim.steps[0]).toMatchObject({ state: 'planned', target: 1, start });
    expect(sim.steps[1]).toMatchObject({ state: 'planned', target: 2 });
    expect(sim.next[key]).toBe('m');
  });

  it('assigns a planned planet to a synced one', () => {
    const p1 = plannedKey(1);
    const p2 = plannedKey(2);
    const order: BuildOrder = {
      base: { planets: { [p1]: { 1: 2 } }, research: { 113: 1 } },
      planets: {
        [p1]: [{ id: 't', kind: 'transport', transport: { target: p2, resources: { 901: 5 }, flight: 60 } }],
        [p2]: [{ id: 'b', kind: 'building', element: 1 }],
      },
    };
    const home = assignPlanet(order, p1, HOME)!;
    expect(home.base).toEqual({ planets: { [HOME]: { 1: 2 } }, research: { 113: 1 } });
    expect(Object.keys(home.planets)).toEqual([HOME, p2]);
    const colony = assignPlanet(home, p2, '1:120:4:planet')!;
    expect(colony.planets[HOME][0].transport!.target).toBe('1:120:4:planet');
    // a planet that already has steps is not overwritten
    expect(assignPlanet(home, p2, HOME)).toBeNull();
    expect(assignPlanet(order, '0:0:9:planet', HOME)).toBeNull();
  });
});
