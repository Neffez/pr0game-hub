import { planetStartResources, type UniverseSettings } from '@pr0hub/core/universe';
import type { HubState } from '../hub.js';
import { plannedKey, withPlanned } from '../planned.js';
import type { BuildOrder, PlannedPlanet } from '../types.js';
import type { OptimizeOptions, OptimizeInput } from './problem.js';
import type { OptimizeTargets, TargetEntry } from './targets.js';

/**
 * An auto plan without a hub (the pr0game tool): one planet from given levels (default: a new planet at 0), the
 * account's research, the universe's speeds. The build order is empty, so the result is the planet's whole list.
 */

/** A hub state without planets: the universe's speeds, the given research. */
export function emptyHub(universe: Partial<UniverseSettings> = {}, research: Record<string, number> = {}): HubState {
  return {
    planets: [],
    research: { ...research },
    researchQueue: [],
    buildingSpeed: universe.buildingSpeed || null,
    researchSpeed: universe.researchSpeed || null,
    shipyardSpeed: universe.shipyardSpeed || null,
    resourceSpeed: universe.resourceMultiplier || null,
    universityFactor: universe.universityFactor ?? 8,
    catchUp: null,
    storageFactor: universe.storageMultiplier || 1,
  };
}

export interface StandaloneInput {
  universe?: UniverseSettings;
  /** building levels and units of the planet (default: none, a new planet) */
  levels?: Record<string, number>;
  research?: Record<string, number>;
  /** resources at the start (default: the universe's start resources) */
  resources?: Record<number, number>;
  /** max. temperature of the planet (default: the game's start planet) */
  temp?: number | null;
  name?: string;
  targets: OptimizeTargets | TargetEntry[];
  options?: OptimizeOptions;
  /** epoch seconds the plan starts (default now) */
  now?: number;
}

/** The input of `optimize` / `runOptimizeJob` for one planet without a hub (key `0:0:1:planet`). */
export function standaloneInput(s: StandaloneInput): Omit<OptimizeInput, 'units'> {
  const key = plannedKey(1);
  const now = s.now ?? Math.floor(Date.now() / 1000);
  const planned: PlannedPlanet = {};
  if (s.name) planned.name = s.name;
  if (s.temp != null) planned.temp = s.temp;
  const order: BuildOrder = {
    base: { planets: { [key]: { ...(s.levels ?? {}) } }, research: { ...(s.research ?? {}) } },
    planets: { [key]: [] },
    planned: { [key]: planned },
  };
  const hub = withPlanned(order, emptyHub(s.universe, s.research), now, { resources: s.resources ?? planetStartResources(s.universe), universe: s.universe });
  return { order, hub, planet: key, targets: s.targets, now, universe: s.universe, options: s.options };
}
