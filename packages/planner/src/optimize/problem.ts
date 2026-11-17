import { RESEARCH } from '@pr0hub/core/buildings';
import type { UnitCatalog } from '@pr0hub/core/units';
import { ASTROPHYSICS, type UniverseSettings } from '@pr0hub/core/universe';
import { doneStateOf, levelsAfterQueue, researchAfterQueue, targetsOf, type HubState } from '../hub.js';
import { simulate, type Simulation } from '../simulate.js';
import type { Base, BuildOrder, Step } from '../types.js';
import { expandTargets, kindOf, OptimizeError, type OptimizeTargets } from './targets.js';

/**
 * The optimization problem of one planet: which part of its list the optimizer owns (the open tail), which steps stay
 * (`keep`), the required steps that follow from the targets and the levels the tail starts from.
 */

export interface MineRatio {
  /** crystal mine at most this many levels below the metal mine (default 2) */
  crystalBelowMetal?: number;
  /** deuterium synthesizer at most this many levels below the crystal mine (default 2) */
  deutBelowCrystal?: number;
  /** levels beyond those without a penalty (default 1) */
  tolerance?: number;
  /** seconds of penalty per level too far apart, counted after each step of the list (default 3600) */
  weight?: number;
}

export interface QuietHours {
  /** local hour (universe time zone) the quiet window starts, 0 … 24, fractions allowed */
  from: number;
  /** local hour it ends; below `from`: the window runs over midnight */
  to: number;
  /** penalty per second a step starting in the window would wait until it ends (default 1) */
  weight?: number;
}

export interface OptimizeOptions {
  /** insert mines, solar and fusion plants (default true) */
  economy?: boolean;
  /** try production settings of the mines in 25 % steps (default true) */
  throttle?: boolean;
  /** element ids never to insert (e.g. 12 fusion reactor); a target of them is still built */
  forbid?: number[];
  /** soft penalty when the mines drift apart */
  mineRatio?: MineRatio | null;
  /** soft penalty for steps that start in a quiet window (a person or script starts them) */
  quietHours?: QuietHours | null;
  /** the open steps of the planet's list that are not kept count as targets too, so none get lost (default true) */
  includeExisting?: boolean;
}

export interface OptimizeInput {
  order: BuildOrder;
  /** the hub's state with the build order's planned planets (`withPlanned`) */
  hub: HubState;
  /** hub planet key whose list is optimized */
  planet: string;
  targets: OptimizeTargets;
  /** ids of steps of the planet's open tail that stay in their order (default: transports, production steps, astrophysics a colonization waits for) */
  keep?: string[];
  now: number;
  universe?: UniverseSettings;
  units?: UnitCatalog;
  options?: OptimizeOptions;
}

/** A step of the optimized tail: a kept step of the list, or one the optimizer places (`kept` false). */
export interface Item {
  step: Step;
  kept: boolean;
}

/** buildings the search may insert: mines, power plants, storages */
export const ECONOMY = [1, 2, 3, 4, 12, 22, 23, 24];
/** those the greedy scores (storages it only builds when a cost needs them) */
export const PRODUCERS = [1, 2, 3, 4, 12];
export const MINES = [1, 2, 3];

export interface Problem {
  input: OptimizeInput;
  /** the order with the base raised where new steps would otherwise count as built (see `fixBase`) */
  order: BuildOrder;
  hub: HubState;
  planet: string;
  planetType: 'planet' | 'moon';
  /** steps before the open tail: stay as they are */
  prefix: Step[];
  /** kept steps of the tail in order */
  kept: Item[];
  /** expanded targets (element -> level or count) */
  targets: Record<number, number>;
  /** levels the tail starts from: buildings and units of the planet after its queues and kept steps, research of the account with the research queue and the open research steps of the other lists */
  start: Record<number, number>;
  /** required steps: element -> number of steps (buildings, research) */
  need: Map<number, number>;
  /** required unit steps: element -> count */
  units: Map<number, number>;
  economy: number[];
  throttle: boolean;
  mineRatio: Required<MineRatio> | null;
  quietHours: Required<QuietHours> | null;
  /** results of the current build order (the comparison for invalid steps, start times of the kept steps) */
  baseline: Simulation;
  baselineInvalid: Set<string>;
  keptStart: Map<string, number>;
  /** open research steps of the other planets' lists (they raise the account's level once they start) */
  elsewhere: { id: string; element: number }[];
  /** ids the optimizer can give its own steps (not used by the order) */
  newId: () => string;
  /** fitness evaluations so far */
  stats: { evaluations: number };
}

export function setupProblem(input: OptimizeInput): Problem {
  const { order, hub, planet } = input;
  const o = input.options ?? {};
  const list = order.planets[planet];
  const hp = hub.planets.find((p) => p.key === planet);
  if (!list || !hp) throw new OptimizeError(`planet ${planet} is not in the build order`);
  const targetsNow = targetsOf(order);
  const isOpen = (s: Step) => !s.deactivated && doneStateOf(s, targetsNow.get(s.id), planet, hub) === 'open';
  let first = list.findIndex(isOpen);
  if (first < 0) first = list.length;
  const prefix = list.slice(0, first);
  const tail = list.slice(first);

  // kept steps: given, else transports, production steps and astrophysics a colonization waits for
  const colonizing = Object.values(order.planets).some((l) => l.some((s) => s.transport?.mission === 'colonize' && !s.done && !s.deactivated));
  let keepIds: Set<string>;
  if (input.keep) {
    const ids = new Set(list.map((s) => s.id));
    for (const id of input.keep) if (!ids.has(id)) throw new OptimizeError(`keep: step ${id} is not in the list of ${planet}`);
    keepIds = new Set(input.keep);
  } else {
    keepIds = new Set(tail.filter((s) => s.kind === 'transport' || s.kind === 'prod' || (colonizing && s.kind === 'research' && s.element === ASTROPHYSICS)).map((s) => s.id));
  }
  // steps of the tail that are not open (done, queued, deactivated) stay too
  const kept: Item[] = tail.filter((s) => keepIds.has(s.id) || !isOpen(s)).map((step) => ({ step, kept: true }));
  const keptSet = new Set(kept.map((k) => k.step.id));

  // levels the tail starts from
  const levels = levelsAfterQueue(hp.planet);
  const research = researchAfterQueue(hub);
  const start: Record<number, number> = {};
  for (const [id, v] of Object.entries(levels)) start[Number(id)] = v;
  for (const [id, v] of Object.entries(research)) start[Number(id)] = v;
  const addStep = (s: Step) => {
    if (s.element == null || s.deactivated) return;
    start[s.element] = (start[s.element] ?? 0) + (s.kind === 'ship' || s.kind === 'defense' ? (s.count ?? 1) : 1);
  };
  const elsewhere: Problem['elsewhere'] = [];
  for (const [key, l] of Object.entries(order.planets)) {
    if (key === planet) continue;
    for (const s of l) {
      if (s.kind !== 'research' || s.deactivated || doneStateOf(s, targetsNow.get(s.id), key, hub) !== 'open') continue;
      addStep(s);
      elsewhere.push({ id: s.id, element: s.element! });
    }
  }
  for (const k of kept) if (isOpen(k.step)) addStep(k.step);

  // targets: given, the open steps not kept (so none get lost), requirements
  const wanted: OptimizeTargets = {
    buildings: { ...input.targets.buildings }, research: { ...input.targets.research }, ships: { ...input.targets.ships }, defense: { ...input.targets.defense },
  };
  if (o.includeExisting !== false) {
    const reach: Record<number, number> = { ...start };
    for (const s of tail) if (!keptSet.has(s.id) && s.element != null) reach[s.element] = (reach[s.element] ?? 0) + (s.kind === 'ship' || s.kind === 'defense' ? (s.count ?? 1) : 1);
    for (const s of tail) {
      if (keptSet.has(s.id) || s.element == null) continue;
      const group = s.kind === 'building' ? wanted.buildings! : s.kind === 'research' ? wanted.research! : s.kind === 'ship' ? wanted.ships! : wanted.defense!;
      group[s.element] = Math.max(group[s.element] ?? 0, reach[s.element]);
    }
  }
  const targets = expandTargets(wanted, hp.type);
  const need = new Map<number, number>();
  const units = new Map<number, number>();
  for (const [key, level] of Object.entries(targets)) {
    const id = Number(key);
    const missing = level - (start[id] ?? 0);
    if (missing <= 0) continue;
    const kind = kindOf(id);
    if (kind === 'research' && hp.type !== 'planet') throw new OptimizeError(`targets: research ${id} cannot run on a moon, plan it on a planet`);
    if (kind === 'ship' || kind === 'defense') units.set(id, missing);
    else need.set(id, missing);
  }
  if (!need.size && !units.size) throw new OptimizeError('targets: all targets are reached already');
  for (const [id, n] of need) if (kindOf(id) === 'research' && (start[id] ?? 0) + n > RESEARCH[String(id)].max) throw new OptimizeError(`targets: research ${id} goes up to level ${RESEARCH[String(id)].max}`);

  const forbid = new Set(o.forbid ?? []);
  const economy = o.economy === false ? [] : ECONOMY.filter((id) => !forbid.has(id) && (hp.type === 'planet'));
  const fixed = fixBase(order, hub, planet, prefix, [...need.keys(), ...units.keys(), ...economy]);
  const used = new Set(Object.values(order.planets).flatMap((l) => l.map((s) => s.id)));
  let n = 0;
  const newId = () => {
    let id: string;
    do id = `__o${n++}`;
    while (used.has(id));
    return id;
  };
  const baseline = simulate(order, hub, { now: input.now, units: input.units, universe: input.universe, lean: true });
  const baselineInvalid = new Set(baseline.steps.filter((s) => s.state === 'invalid').map((s) => s.id));
  const keptStart = new Map(baseline.steps.filter((s) => keptSet.has(s.id)).map((s) => [s.id, s.start ?? Infinity]));
  const mr = o.mineRatio;
  const qh = o.quietHours;
  return {
    input, order: fixed, hub, planet, planetType: hp.type, prefix, kept, targets, start, need, units, economy,
    throttle: o.throttle !== false && hp.type === 'planet',
    mineRatio: mr ? { crystalBelowMetal: mr.crystalBelowMetal ?? 2, deutBelowCrystal: mr.deutBelowCrystal ?? 2, tolerance: mr.tolerance ?? 1, weight: mr.weight ?? 3600 } : null,
    quietHours: qh ? { from: qh.from, to: qh.to, weight: qh.weight ?? 1 } : null,
    baseline, baselineInvalid, keptStart, elsewhere, newId, stats: { evaluations: 0 },
  };
}

/**
 * Steps are "+1 level": a new step's level follows from the base and the steps before it. Where the hub already
 * reaches more (built without the build order), the base goes up so the first new step is the next level and does not
 * count as built (like `insertSteps`). Research counts over the lists in the order of the planets.
 */
function fixBase(order: BuildOrder, hub: HubState, planet: string, prefix: Step[], elements: number[]): BuildOrder {
  const hp = hub.planets.find((p) => p.key === planet)!;
  const levels = levelsAfterQueue(hp.planet);
  const research = researchAfterQueue(hub);
  const base: Base = { planets: { ...order.base.planets, [planet]: { ...(order.base.planets[planet] ?? {}) } }, research: { ...order.base.research } };
  const counted = (steps: Step[], id: number, kind: 'research' | 'other') =>
    steps.reduce((n, s) => (s.element === id && (kind === 'research') === (s.kind === 'research') ? n + (s.kind === 'ship' || s.kind === 'defense' ? (s.count ?? 1) : 1) : n), 0);
  for (const id of new Set(elements)) {
    if (kindOf(id) === 'research') {
      let before = 0;
      for (const [key, l] of Object.entries(order.planets)) {
        if (key === planet) break;
        before += counted(l, id, 'research');
      }
      before += counted(prefix, id, 'research');
      const need = (research[id] ?? 0) - before;
      if (need > (base.research[id] ?? 0)) base.research[id] = need;
    } else {
      const need = (levels[id] ?? 0) - counted(prefix, id, 'other');
      if (need > (base.planets[planet][id] ?? 0)) base.planets[planet][id] = need;
    }
  }
  return { ...order, base };
}
