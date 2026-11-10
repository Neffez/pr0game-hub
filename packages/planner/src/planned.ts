import type { HubPlanet } from './hub.js';
import type { BuildOrder, Step } from './types.js';

/**
 * Planned planets: planets of a build order the hub has no coordinates for yet (before the universe starts, or a
 * colony still to come). Their key is `0:0:<n>:planet` (galaxy 0 does not exist in the game), `n` the pr0plan planet
 * id. They are simulated as fresh planets from the build order's base and are later assigned to a synced planet.
 */

/** Resources of a new planet when the universe sets none (the hub's default of `startResourcesOf`). */
export const START_RESOURCES: Record<number, number> = { 901: 5000, 902: 1500, 903: 0 };
/** Max temperature of a planet when nothing better is known (game config `initial_temp` default). */
export const START_TEMP = 50;

const PLANNED = /^0:0:(\d{1,2}):planet$/;

/** Key of planned planet `n` (pr0plan planet id). */
export const plannedKey = (n: string | number) => `0:0:${n}:planet`;
/** The number of a planned planet key, or null for a key with coordinates. */
export function plannedNumber(key: string): number | null {
  const m = PLANNED.exec(key);
  return m ? Number(m[1]) : null;
}
export const isPlannedKey = (key: string) => PLANNED.test(key);

/**
 * A planned planet as the hub would have it: the base's levels, the universe's start resources, no production synced
 * (the formula is used), resources counted from `time` on (the universe's start, or now).
 */
export function plannedPlanet(
  order: BuildOrder, key: string, time: number, opts: { name?: string | null; temp?: number | null; resources?: Record<number, number> } = {},
): HubPlanet {
  const n = plannedNumber(key) ?? 0;
  return {
    key,
    name: opts.name ?? '',
    coords: { g: 0, s: 0, p: n },
    type: 'planet',
    temp: opts.temp ?? START_TEMP,
    arrivals: [],
    planet: { type: 'planet', values: { ...(order.base.planets[key] ?? {}) }, resources: { ...(opts.resources ?? START_RESOURCES) }, perHour: {}, time, queue: [] },
  };
}

/**
 * Moves the steps and base of planet `from` (a planned planet) to `to` (a synced planet), transports to it included.
 * Returns null when `from` has no steps in the order or `to` already has steps.
 */
export function assignPlanet(order: BuildOrder, from: string, to: string): BuildOrder | null {
  if (from === to || !order.planets[from] || order.planets[to]?.length) return null;
  const rename = (k: string) => (k === from ? to : k);
  const planets: Record<string, Step[]> = {};
  for (const [key, steps] of Object.entries(order.planets)) {
    if (key === to) continue;
    planets[rename(key)] = steps.map((s) => (s.transport?.target === from ? { ...s, transport: { ...s.transport, target: to } } : s));
  }
  const basePlanets = Object.fromEntries(Object.entries(order.base.planets).filter(([k]) => k !== to).map(([k, v]) => [rename(k), v]));
  return { base: { ...order.base, planets: basePlanets }, planets };
}
