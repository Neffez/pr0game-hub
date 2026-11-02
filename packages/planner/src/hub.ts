import { levelAfter, type Arrival, type BuildPlanet } from '@pr0hub/core/buildings';
import type { Pr0planImport } from './pr0plan.js';
import type { Base, BuildOrder, Step } from './types.js';

/**
 * The hub state a build order is checked and simulated against: the shape of `GET /api/{uni}/buildings` (server:
 * `BuildingsState`), reduced to what the planner needs.
 */
export interface HubPlanet {
  key: string;
  name: string;
  coords: { g: number; s: number; p: number };
  type: 'planet' | 'moon';
  planet: BuildPlanet;
  arrivals: Arrival[];
  temp: number | null;
  /** production setting of the mines (1, 2, 3 -> 0 … 1) from the empire page, when known */
  factors?: Record<string, number> | null;
}

export interface HubState {
  planets: HubPlanet[];
  research: Record<string, number>;
  researchQueue: { id: number; level: number; end: number | null }[];
  /** speeds as the game config (2500 = 1x), null when unknown */
  buildingSpeed: number | null;
  researchSpeed: number | null;
  shipyardSpeed: number | null;
  resourceSpeed: number | null;
  universityFactor: number;
  catchUp: number | null;
  storageFactor: number;
}

/** Building levels after the build queue and unit counts with the shipyard queue of a planet. */
export function levelsAfterQueue(p: BuildPlanet): Record<string, number> {
  const out: Record<string, number> = { ...p.values };
  for (const q of p.queue) out[q.id] = levelAfter(q);
  for (const [id, n] of Object.entries(p.shipyard ?? {})) out[id] = (out[id] ?? 0) + n;
  return out;
}

/** Research levels after the research queue. */
export function researchAfterQueue(hub: Pick<HubState, 'research' | 'researchQueue'>): Record<string, number> {
  const out = { ...hub.research };
  for (const q of hub.researchQueue) out[q.id] = Math.max(out[q.id] ?? 0, q.level);
  return out;
}

/** The hub's levels now (queues included) as a base, for the given planets. */
export function baseFromHub(hub: HubState, keys: string[]): Base {
  const base: Base = { planets: {}, research: researchAfterQueue(hub) };
  for (const key of keys) {
    const p = hub.planets.find((x) => x.key === key);
    if (p) base.planets[key] = levelsAfterQueue(p.planet);
  }
  return base;
}

/**
 * Target level (building, research) or unit count (ship, defense) of every step: the base plus the steps before it
 * for the same element. Research counts across planets in the order of the planets, then the steps.
 */
export function targetsOf(order: BuildOrder): Map<string, number> {
  const out = new Map<string, number>();
  const research = { ...order.base.research };
  for (const [key, steps] of Object.entries(order.planets)) {
    const levels = { ...(order.base.planets[key] ?? {}) };
    for (const s of steps) {
      if (s.element == null) continue;
      if (s.kind === 'research') out.set(s.id, (research[s.element] = (research[s.element] ?? 0) + 1));
      else if (s.kind === 'building') out.set(s.id, (levels[s.element] = (levels[s.element] ?? 0) + 1));
      else if (s.kind === 'ship' || s.kind === 'defense') out.set(s.id, (levels[s.element] = (levels[s.element] ?? 0) + (s.count ?? 1)));
    }
  }
  return out;
}

export type DoneState = 'done' | 'queued' | 'open';

/**
 * Whether a step is reached by the hub's levels: `done` when built (or checked off), `queued` when only the queue
 * reaches it, else `open`. Production and transport steps are only done when checked off.
 */
export function doneStateOf(step: Step, target: number | undefined, key: string, hub: HubState): DoneState {
  if (step.done) return 'done';
  if (step.element == null || target == null) return 'open';
  const p = hub.planets.find((x) => x.key === key);
  if (step.kind === 'research') {
    if ((hub.research[step.element] ?? 0) >= target) return 'done';
    return (researchAfterQueue(hub)[step.element] ?? 0) >= target ? 'queued' : 'open';
  }
  if (!p) return 'open';
  if ((p.planet.values[step.element] ?? 0) >= target) return 'done';
  return (levelsAfterQueue(p.planet)[step.element] ?? 0) >= target ? 'queued' : 'open';
}

/** An own fleet movement as the hub synced it (current list or history), planets by key. */
export interface OwnFleet {
  from: string;
  to: string | null;
  /** game mission id (3 transport, 4 deploy) */
  mission: number | null;
  resources: Record<string, number>;
  /** arrival at the target (epoch seconds) */
  arrival: number;
}

/** Transports must bring at least this share of each resource of the step. */
const TRANSPORT_SHARE = 0.9;
/** Production settings match within this (the game has steps of 10 %). */
const FACTOR_TOLERANCE = 0.05;

/**
 * Production and transport steps the synced pages show as done: the empire page's production setting of the mines
 * equals the step's, an own transport or deployment from the planet to the step's target with (about) its resources
 * arrived or is on its way, after `since` (the import). Only steps whose earlier steps on the planet are all done,
 * queued or skipped count, in list order; each fleet counts once. Returns the ids to check off.
 */
export function detectDone(order: BuildOrder, hub: HubState, fleets: OwnFleet[], since: number): string[] {
  const targets = targetsOf(order);
  const used = new Set<OwnFleet>();
  const out: string[] = [];
  for (const [key, steps] of Object.entries(order.planets)) {
    const planet = hub.planets.find((p) => p.key === key);
    if (!planet) continue;
    for (const s of steps) {
      if (s.deactivated || doneStateOf(s, targets.get(s.id), key, hub) !== 'open') continue;
      if (s.kind === 'prod') {
        const f = planet.factors;
        const match = !!f && Object.entries(s.prod!.factors).every(([id, v]) => !['1', '2', '3'].includes(id) || Math.abs((f[id] ?? 1) - v) <= FACTOR_TOLERANCE);
        if (!match) break;
        out.push(s.id);
        continue;
      }
      if (s.kind === 'transport' && s.transport!.target) {
        const t = s.transport!;
        const fleet = fleets.find(
          (f) =>
            !used.has(f) && f.from === key && f.to === t.target && (f.mission === 3 || f.mission === 4) && f.arrival > since &&
            Object.entries(t.resources).every(([r, v]) => !v || (f.resources[r] ?? 0) >= v * TRANSPORT_SHARE),
        );
        if (!fleet) break;
        used.add(fleet);
        out.push(s.id);
        continue;
      }
      // an open step that is not detected ends the planet's list
      break;
    }
  }
  return out;
}

export interface SettingsDiff {
  key: 'resourceSpeed' | 'buildSpeed' | 'researchSpeed' | 'temp';
  /** hub planet key for `temp` */
  planet?: string;
  file: number;
  hub: number;
}

/**
 * Differences between the settings in a pr0plan file and the hub: the speeds (pr0plan multipliers against the hub's
 * game config / 2500) and the max temperature of the mapped planets. Unknown hub values are not compared.
 */
export function compareSettings(imp: Pr0planImport, hub: HubState, mapping: Record<string, string | null>): SettingsDiff[] {
  const s = imp.settings;
  if (!s) return [];
  const out: SettingsDiff[] = [];
  const speed = (key: SettingsDiff['key'], file: number, hubSpeed: number | null) => {
    if (hubSpeed == null) return;
    const h = hubSpeed / 2500;
    if (Math.abs(h - file) > 1e-6) out.push({ key, file, hub: h });
  };
  speed('resourceSpeed', s.resourceSpeed, hub.resourceSpeed);
  speed('buildSpeed', s.buildSpeed, hub.buildingSpeed);
  speed('researchSpeed', s.researchSpeed, hub.researchSpeed);
  for (const [id, key] of Object.entries(mapping)) {
    const file = s.planets[id]?.temp;
    const temp = key ? hub.planets.find((p) => p.key === key)?.temp : null;
    if (key && file != null && temp != null && file !== temp) out.push({ key: 'temp', planet: key, file, hub: temp });
  }
  return out;
}
