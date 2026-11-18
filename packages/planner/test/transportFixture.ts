import type { BuildOrder, HubState, Step } from '../src/index.js';
import { hubOf, NOW, planetOf } from './optimizeFixture.js';

/**
 * A colony that feeds the home planet: six kept transports with a departure time (`notBefore`, every 12 hours), all
 * resources, 3 then 5 small cargos (the colony builds the 2 more), between its mines. The home planet's ship and
 * research steps live on these transports.
 */
export const HOME = '1:100:8:planet';
export const COLONY = '1:129:9:planet';
export const DEPARTURES = [12, 24, 36, 48, 60, 72].map((h) => NOW + h * 3600);

/** `cargos`: small cargos on the colony now (the others are away on a flight) */
export function transportHub(cargos = 3): HubState {
  return hubOf(
    [
      planetOf(HOME, { 1: 5, 2: 3, 3: 2, 4: 6, 14: 2, 21: 4, 31: 3, 22: 2, 23: 2, 24: 1 }, { 901: 2000, 902: 1000, 903: 500 }, 30),
      planetOf(COLONY, { 1: 14, 2: 11, 3: 7, 4: 14, 14: 2, 21: 2, 22: 3, 23: 3, 24: 2, 202: cargos }, { 901: 10000, 902: 6000, 903: 2000 }, 20),
    ],
    { research: { 113: 3, 115: 3, 117: 2, 111: 2, 106: 1 } },
  );
}

const transport = (id: string, at: number, cargos: number): Step => ({
  id, kind: 'transport', transport: { target: HOME, resources: {}, flight: 3600, all: true, ships: { 202: cargos }, notBefore: at },
});

/** `built`: small cargos the colony's own step builds after the third transport */
export function transportOrder(hub: HubState, built = 2): BuildOrder {
  let n = 0;
  const b = (element: number): Step => ({ id: `c${n++}`, kind: 'building', element });
  const colony: Step[] = [
    b(1), b(2), transport('t1', DEPARTURES[0], 3), b(4), b(1), b(3),
    transport('t2', DEPARTURES[1], 3), b(2), b(1), b(4),
    transport('t3', DEPARTURES[2], 3), { id: 'cargos', kind: 'ship', element: 202, count: built }, b(3), b(1),
    transport('t4', DEPARTURES[3], 5), b(2), b(4), b(1),
    transport('t5', DEPARTURES[4], 5), b(3), b(2),
    transport('t6', DEPARTURES[5], 5), b(1), b(4), b(2), b(3),
  ];
  const home: Step[] = [
    { id: 'h-lf', kind: 'ship', element: 204, count: 10 },
    { id: 'h-imp', kind: 'research', element: 117 },
    { id: 'h-hf', kind: 'ship', element: 205, count: 4 },
    { id: 'h-sc', kind: 'ship', element: 202, count: 5 },
    { id: 'h-imp2', kind: 'research', element: 117 },
  ];
  return {
    base: { planets: Object.fromEntries(hub.planets.map((p) => [p.key, { ...p.planet.values }])), research: { ...hub.research } },
    planets: { [HOME]: home, [COLONY]: colony },
  };
}
