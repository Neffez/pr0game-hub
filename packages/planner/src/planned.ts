import { INITIAL_TEMP } from '@pr0hub/core/production';
import { startResourcesOf } from '@pr0hub/core/universe';
import type { HubPlanet, HubState } from './hub.js';
import type { BuildOrder, Step } from './types.js';

/**
 * Planned planets: planets of a build order the hub has no coordinates for yet (before the universe starts, or a
 * colony still to come). Their key is `0:0:<n>:planet` (galaxy 0 does not exist in the game), `n` the pr0plan planet
 * id. They are simulated as fresh planets from the build order's base and are later assigned to a synced planet.
 */

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
 * A planned planet as the hub would have it: the base's levels, the universe's start resources (the game's defaults
 * of `startResourcesOf` when none are passed), no production synced
 * (the formula is used), resources counted from `time` on (the universe's start, or now).
 */
export function plannedPlanet(
  order: BuildOrder, key: string, time: number, opts: { name?: string | null; temp?: number | null; resources?: Record<number, number> } = {},
): HubPlanet {
  const n = plannedNumber(key) ?? 0;
  const details = order.planned?.[key];
  return {
    key,
    name: opts.name ?? details?.name ?? '',
    coords: { g: 0, s: 0, p: n },
    type: 'planet',
    temp: details?.temp ?? opts.temp ?? INITIAL_TEMP,
    arrivals: [],
    planet: { type: 'planet', values: { ...(order.base.planets[key] ?? {}) }, resources: opts.resources ? { ...opts.resources } : startResourcesOf({}), perHour: {}, time, queue: [] },
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
    planets[rename(key)] = steps.map((s): Step => {
      if (s.transport?.target !== from) return s;
      // the planet is there: the colonization that founds it is done
      const moved: Step = { ...s, transport: { ...s.transport, target: to } };
      return s.transport.mission === 'colonize' ? { ...moved, done: true } : moved;
    });
  }
  const basePlanets = Object.fromEntries(Object.entries(order.base.planets).filter(([k]) => k !== to).map(([k, v]) => [rename(k), v]));
  const planned = Object.fromEntries(Object.entries(order.planned ?? {}).filter(([k]) => k !== from));
  const out: BuildOrder = { base: { ...order.base, planets: basePlanets }, planets };
  if (Object.keys(planned).length) out.planned = planned;
  return out;
}

/** The hub's planets plus the planned ones of the build order as new planets (see `plannedPlanet`). */
export function withPlanned(
  order: BuildOrder, hub: HubState, time: number, opts: { resources?: Record<number, number>; name?: (key: string) => string | null | undefined; temp?: (key: string) => number | null | undefined } = {},
): HubState {
  const keys = Object.keys(order.planets).filter((k) => isPlannedKey(k) && !hub.planets.some((p) => p.key === k));
  if (!keys.length) return hub;
  const planned = keys.map((k) => plannedPlanet(order, k, time, { name: opts.name?.(k), temp: opts.temp?.(k), resources: opts.resources }));
  return { ...hub, planets: [...hub.planets, ...planned] };
}

/** Key of the next planned planet to add: the lowest free number. */
export function freePlannedKey(order: Pick<BuildOrder, 'planets'>): string | null {
  for (let n = 1; n <= 99; n++) if (!order.planets[plannedKey(n)]) return plannedKey(n);
  return null;
}

/**
 * Planned planets whose coordinates are now a synced planet (`keys`: the hub's planet keys) without steps of its own:
 * each is assigned to it. Returns the new build order and the moves made (`from` -> `to`), or null when none.
 */
export function assignSynced(order: BuildOrder, keys: string[]): { order: BuildOrder; moved: Record<string, string> } | null {
  let out = order;
  const moved: Record<string, string> = {};
  for (const [from, details] of Object.entries(order.planned ?? {})) {
    const c = details.coords;
    const to = c ? `${c.g}:${c.s}:${c.p}:planet` : null;
    if (!to || !keys.includes(to)) continue;
    const next = assignPlanet(out, from, to);
    if (!next) continue;
    out = next;
    moved[from] = to;
  }
  return Object.keys(moved).length ? { order: out, moved } : null;
}
