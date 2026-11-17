import type { BuildOrder, HubPlanet, HubState, Step } from '../src/index.js';

/** A realistic account for the optimizer: three planets, about 150 steps, research on two of them, a transport home. */
export const HOME = '1:100:8:planet';
export const COL1 = '1:120:4:planet';
export const COL2 = '1:101:9:planet';
export const NOW = 1_800_000_000;

export const planetOf = (key: string, values: Record<string, number>, resources: Record<number, number>, temp = 40): HubPlanet => {
  const [g, s, p] = key.split(':').map(Number);
  return {
    key, name: key, coords: { g, s, p }, type: 'planet', temp, arrivals: [],
    planet: { type: 'planet', values, resources, perHour: {}, time: NOW, queue: [] },
  };
};

export const hubOf = (planets: HubPlanet[], extra: Partial<HubState> = {}): HubState => ({
  planets, research: { 113: 2, 106: 1, 108: 1, 115: 2 }, researchQueue: [], buildingSpeed: 5000, researchSpeed: 5000, shipyardSpeed: 5000,
  resourceSpeed: 10000, universityFactor: 8, catchUp: 0, storageFactor: 1, ...extra,
});

export function accountHub(): HubState {
  return hubOf([
    planetOf(HOME, { 1: 12, 2: 10, 3: 6, 4: 12, 14: 2, 21: 2, 31: 3, 22: 1, 23: 1 }, { 901: 20000, 902: 10000, 903: 3000 }, 30),
    planetOf(COL1, { 1: 6, 2: 4, 3: 1, 4: 6, 14: 1, 31: 1 }, { 901: 5000, 902: 3000, 903: 500 }, 70),
    planetOf(COL2, { 1: 4, 2: 2, 4: 4 }, { 901: 2000, 902: 1000, 903: 0 }, 20),
  ]);
}

/** mines and solar in the usual rhythm: metal, solar, metal, crystal, solar, deuterium … */
function cycle(prefix: string, n: number, research: number[] = [], extra: number[] = []): Step[] {
  const rhythm = [1, 4, 1, 2, 4, 3, 1, 2];
  const steps: Step[] = [];
  let r = 0;
  let e = 0;
  for (let i = 0; i < n; i++) {
    if (research.length && i % 5 === 4 && r < research.length) steps.push({ id: `${prefix}${i}`, kind: 'research', element: research[r++] });
    else if (extra.length && i % 7 === 6 && e < extra.length) steps.push({ id: `${prefix}${i}`, kind: 'building', element: extra[e++] });
    else steps.push({ id: `${prefix}${i}`, kind: 'building', element: rhythm[i % rhythm.length] });
  }
  return steps;
}

export function accountOrder(hub: HubState): BuildOrder {
  const base = { planets: Object.fromEntries(hub.planets.map((p) => [p.key, { ...p.planet.values }])), research: { ...hub.research } };
  return {
    base,
    planets: {
      [HOME]: cycle('h', 55, [113, 113, 120, 120, 113, 120, 108, 117, 117], [14, 14, 21, 21, 22, 23, 31]),
      [COL1]: cycle('a', 50, [], [14, 22, 23, 31]),
      [COL2]: [
        ...cycle('b', 42, [], [14, 22]),
        { id: 'tr', kind: 'transport', transport: { target: HOME, resources: { 901: 20000, 902: 10000 }, flight: 3600 } },
        ...cycle('c', 3),
      ],
    },
  };
}
