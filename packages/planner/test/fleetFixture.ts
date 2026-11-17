import { withPlanned, type BuildOrder, type HubState, type Step } from '../src/index.js';
import { hubOf, NOW, planetOf } from './optimizeFixture.js';

/**
 * The main planet of a fleet player, like the build order the optimizer was tried on: mines, research towards
 * cruisers, 5 spy probes, 2 cruisers, 4 assault transports, 2 more cruisers, astrophysics 2 and 3, a colony ship, then
 * the colonization that uses it.
 */
export const MAIN = '1:100:8:planet';
export const COLONY = '0:0:2:planet';

export function fleetHub(order: BuildOrder): HubState {
  const hub = hubOf(
    [planetOf(MAIN, { 1: 14, 2: 11, 3: 8, 4: 15, 14: 4, 21: 4, 31: 5, 22: 3, 23: 3, 24: 2 }, { 901: 30000, 902: 15000, 903: 5000 }, 30)],
    { research: { 113: 4, 115: 3, 106: 2, 117: 2, 120: 4, 111: 3, 108: 2, 124: 1 } },
  );
  return withPlanned(order, hub, NOW);
}

let n = 0;
const b = (element: number): Step => ({ id: `m${n++}`, kind: 'building', element });
const r = (element: number, id?: string): Step => ({ id: id ?? `r${n++}`, kind: 'research', element });
const u = (id: string, element: number, count: number): Step => ({ id, kind: 'ship', element, count });

export function fleetOrder(): BuildOrder {
  n = 0;
  const steps: Step[] = [
    b(1), b(2), r(117), b(4), r(120), b(1), r(121), b(3), b(21), r(121),
    u('probes', 210, 5),
    r(117), b(1), b(2), b(4),
    u('cruisers1', 206, 2),
    r(111), r(115), b(1), r(115), b(2), b(4), b(3),
    u('assault', 225, 4),
    b(1), b(2),
    u('cruisers2', 206, 2),
    r(106), r(124, 'astro2'), b(4), r(124, 'astro3'), b(1), b(2),
    u('colonyShip', 208, 1),
    { id: 'colonize', kind: 'transport', transport: { target: COLONY, resources: { 901: 2000 }, flight: 3 * 3600, mission: 'colonize', ships: { 208: 1 } } },
    b(3), b(4),
  ];
  const levels = { 1: 14, 2: 11, 3: 8, 4: 15, 14: 4, 21: 4, 31: 5, 22: 3, 23: 3, 24: 2 };
  return {
    base: { planets: { [MAIN]: levels, [COLONY]: {} }, research: { 113: 4, 115: 3, 106: 2, 117: 2, 120: 4, 111: 3, 108: 2, 124: 1 } },
    planets: { [MAIN]: steps, [COLONY]: [] },
    planned: { [COLONY]: { coords: { g: 1, s: 105, p: 6 } } },
  };
}
