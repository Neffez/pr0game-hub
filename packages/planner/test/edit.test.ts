import { describe, expect, it } from 'vitest';
import { insertSteps, targetsOf, validateBuildOrder, type BuildOrder, type HubPlanet, type HubState } from '../src/index.js';

const HOME = '1:100:8:planet';
const COLONY = '1:120:4:planet';
const planet = (key: string, values: Record<string, number>, queue: HubPlanet['planet']['queue'] = []): HubPlanet => {
  const [g, s, p] = key.split(':').map(Number);
  return {
    key, name: key, coords: { g, s, p }, type: 'planet', temp: 50, arrivals: [],
    planet: { type: 'planet', values, resources: { 901: 0, 902: 0, 903: 0 }, perHour: {}, time: 0, queue },
  };
};
const hub: HubState = {
  planets: [planet(HOME, { 1: 10, 2: 8, 202: 3 }, [{ id: 1, level: 11, destroy: false, end: null } as never]), planet(COLONY, { 1: 4 })],
  research: { 113: 3 }, researchQueue: [{ id: 113, level: 4, end: null }], buildingSpeed: 2500, researchSpeed: 2500, shipyardSpeed: 2500,
  resourceSpeed: 2500, universityFactor: 8, catchUp: 0, storageFactor: 1,
};
let n = 0;
const id = () => `n${n++}`;

describe('insertSteps', () => {
  it('starts a new element from the hub level with its queue', () => {
    const order: BuildOrder = { base: { planets: {}, research: {} }, planets: {} };
    const out = insertSteps(order, HOME, [{ kind: 'building', element: 1 }, { kind: 'building', element: 1 }, { kind: 'research', element: 113 }, { kind: 'ship', element: 202, count: 5 }], 0, hub, id);
    expect(out.base).toEqual({ planets: { [HOME]: { 1: 11, 202: 3 } }, research: { 113: 4 } });
    const targets = targetsOf(out);
    expect(out.planets[HOME].map((s) => targets.get(s.id))).toEqual([12, 13, 5, 8]);
    expect('order' in validateBuildOrder(out)).toBe(true);
  });

  it('keeps the base of elements with steps and inserts at the position', () => {
    const order: BuildOrder = {
      base: { planets: { [HOME]: { 1: 5 } }, research: { 113: 0 } },
      planets: {
        [HOME]: [{ id: 'a', kind: 'building', element: 1 }, { id: 'b', kind: 'building', element: 2 }],
        [COLONY]: [{ id: 'r', kind: 'research', element: 113 }],
      },
    };
    const out = insertSteps(order, HOME, [{ kind: 'building', element: 1 }, { kind: 'research', element: 113 }], 1, hub, id);
    expect(out.base.planets[HOME]).toEqual({ 1: 5 });
    expect(out.base.research).toEqual({ 113: 0 });
    expect(out.planets[HOME].map((s) => s.id)).toEqual(['a', expect.any(String), expect.any(String), 'b']);
    const targets = targetsOf(out);
    expect(out.planets[HOME].slice(0, 2).map((s) => targets.get(s.id))).toEqual([6, 7]);
    // the original is unchanged
    expect(order.planets[HOME]).toHaveLength(2);
  });

  it('appends past the end and leaves planned planets on their base', () => {
    const key = '0:0:2:planet';
    const order: BuildOrder = { base: { planets: { [key]: { 1: 1 } }, research: {} }, planets: { [key]: [{ id: 'a', kind: 'building', element: 2 }] } };
    const out = insertSteps(order, key, [{ kind: 'building', element: 1 }], 99, hub, id);
    expect(out.base.planets[key]).toEqual({ 1: 1 });
    expect(out.planets[key].map((s) => s.kind === 'building' && s.element)).toEqual([2, 1]);
  });
});
