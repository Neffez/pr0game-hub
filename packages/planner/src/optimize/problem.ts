import { RESEARCH, RESEARCH_LAB } from '@pr0hub/core/buildings';
import type { UnitCatalog } from '@pr0hub/core/units';
import { ASTROPHYSICS, type UniverseSettings } from '@pr0hub/core/universe';
import { doneStateOf, levelsAfterQueue, researchAfterQueue, targetsOf, type HubState } from '../hub.js';
import { simulate, type Simulation } from '../simulate.js';
import type { Base, BuildOrder, Step } from '../types.js';
import { expandTargets, kindOf, OptimizeError, requirementsOfElement, targetEntries, targetMap, type OptimizeTargets, type TargetEntry } from './targets.js';

/**
 * The optimization problem of one planet: which part of its list the optimizer owns (the open tail), which steps stay
 * (`keep`), the goals the objective measures, the required steps that follow from them and the levels the tail starts
 * from.
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
  /**
   * the open steps of the planet's list that are not kept count as targets too, so none get lost (default true); a
   * ship or defense step stays a step of its own with its count, a research step a target of its own
   */
  includeExisting?: boolean;
  /**
   * every open ship, defense and research step of the list (kept or not) should end no later than in the current
   * timeline: a soft deadline at its end there (default: on with `includeExisting`)
   */
  noLater?: boolean;
  /** seconds of penalty per second such a step ends later (default 2) */
  noLaterWeight?: number;
  /**
   * seconds of penalty per second a kept transport with a time (`notBefore`, `arriveAt`) leaves later than in the
   * current timeline (default 100: the planets it feeds plan with that time)
   */
  keepTimeWeight?: number;
  /**
   * seconds of penalty per second an open ship, defense or research step of a planet the list's transports feed ends
   * later than in the current timeline (default `noLaterWeight`; 0: those planets are not measured)
   */
  otherPlanetsWeight?: number;
}

export interface OptimizeInput {
  order: BuildOrder;
  /** the hub's state with the build order's planned planets (`withPlanned`) */
  hub: HubState;
  /** hub planet key whose list is optimized */
  planet: string;
  /** levels and counts per element, or entries with deadlines and weights */
  targets: OptimizeTargets | TargetEntry[];
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

/**
 * What the objective measures: a level or count of an element to reach (the end of the step whose cumulative level in
 * the list reaches it), or the end or start of one step (`level` null: a kept step, a step of another planet's list),
 * each with an optional soft deadline.
 */
export interface Goal {
  /** element of the step (0 for a transport) */
  element: number;
  /** level or count to reach; null: the end (`measure`) of the step `step` */
  level: number | null;
  /** soft deadline (epoch seconds) */
  by: number | null;
  /** seconds of penalty per second late (and the goal's share of the small sum of completion times) */
  weight: number;
  /** `target`: asked for; `existing`: an open step of the list; `kept`: a kept step; `other`: a step of another planet the list feeds */
  source: 'target' | 'existing' | 'kept' | 'other';
  /** the step of the list the goal stems from */
  step: string | null;
  /** hub planet key of the list the goal belongs to */
  planet: string;
  /** what counts: the step's end, or its start (a kept transport with a time: its departure) */
  measure: 'end' | 'start';
  /** end (start) in the current build order (null: not reached there) */
  current: number | null;
}

export const isUnitStep = (s: Step) => s.kind === 'ship' || s.kind === 'defense';
/** levels (1) or units a step adds */
export const amountOf = (s: Step) => (isUnitStep(s) ? (s.count ?? 1) : 1);

export interface Problem {
  input: OptimizeInput;
  /** the order with the base raised where new steps would otherwise count as built (see `fixBase`) */
  order: BuildOrder;
  hub: HubState;
  planet: string;
  planetType: 'planet' | 'moon';
  /** steps before the open tail: stay as they are */
  prefix: Step[];
  /** the open tail as it is now */
  tail: Step[];
  /** kept steps of the tail in order */
  kept: Item[];
  /** ids of the kept steps that are open (done, queued and deactivated ones change no level) */
  keptOpen: Set<string>;
  /** expanded targets (element -> level or count) */
  targets: Record<number, number>;
  /** what the objective measures */
  goals: Goal[];
  /** element -> indices of its goals with a level, by level */
  levelGoals: Map<number, number[]>;
  /** levels the tail starts from: buildings and units of the planet after its queues, research of the account with the research queue and the open research steps of the other lists */
  start: Record<number, number>;
  /** required steps: element -> number of steps (buildings, research) */
  need: Map<number, number>;
  /** required unit steps: element -> counts of its steps in order (an existing step keeps its count) */
  units: Map<number, number[]>;
  /** unit steps of the list among `units` (the first ones of each element) */
  existingUnits: Map<number, number>;
  /** steps of other planets' lists that are goals: the simulation runs until they are done */
  watch: string[];
  /** transports of the tail whose ships the list builds: they must come after enough of them (step id -> ships) */
  transportShips: Map<string, { ship: number; count: number }[]>;
  includeExisting: boolean;
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
  const keptOpen = new Set(kept.filter((k) => isOpen(k.step)).map((k) => k.step.id));

  // levels the tail starts from (kept steps count where they are in the list)
  const start: Record<number, number> = {};
  for (const [id, v] of Object.entries(levelsAfterQueue(hp.planet))) start[Number(id)] = v;
  for (const [id, v] of Object.entries(researchAfterQueue(hub))) start[Number(id)] = v;
  const elsewhere: Problem['elsewhere'] = [];
  for (const [key, l] of Object.entries(order.planets)) {
    if (key === planet) continue;
    for (const s of l) {
      if (s.kind !== 'research' || s.deactivated || doneStateOf(s, targetsNow.get(s.id), key, hub) !== 'open') continue;
      start[s.element!] = (start[s.element!] ?? 0) + 1;
      elsewhere.push({ id: s.id, element: s.element! });
    }
  }
  const baseline = simulate(order, hub, { now: input.now, units: input.units, universe: input.universe, lean: true });
  const baselineById = new Map(baseline.steps.map((r) => [r.id, r]));
  const baselineEnd = (id: string) => {
    const r = baselineById.get(id);
    return r?.state === 'planned' ? r.end : null;
  };
  const baselineStart = (id: string) => {
    const r = baselineById.get(id);
    return r?.state === 'planned' ? r.start : null;
  };

  // goals: the open steps of the list (each ship, defense and research step its own, with a deadline at its end now
  // under `noLater`), the highest level of each building, then the targets asked for
  const includeExisting = o.includeExisting !== false;
  const noLater = o.noLater ?? includeExisting;
  const noLaterWeight = o.noLaterWeight ?? 2;
  const goals: Goal[] = [];
  const keptCount: Record<number, number> = {};
  const existingChunks = new Map<number, number[]>();
  const buildingMax = new Map<number, { level: number; step: string }>();
  const reach: Record<number, number> = { ...start };
  for (const s of tail) {
    if (s.element == null || !isOpen(s)) continue;
    reach[s.element] = (reach[s.element] ?? 0) + amountOf(s);
    const timed = s.kind !== 'building';
    if (keptSet.has(s.id)) {
      keptCount[s.element] = (keptCount[s.element] ?? 0) + amountOf(s);
      if (noLater && timed) goals.push({ element: s.element, level: null, by: baselineEnd(s.id), weight: noLaterWeight, source: 'kept', step: s.id, planet, measure: 'end', current: baselineEnd(s.id) });
      continue;
    }
    if (!includeExisting) continue;
    if (!timed) {
      buildingMax.set(s.element, { level: reach[s.element], step: s.id });
      continue;
    }
    if (isUnitStep(s)) existingChunks.set(s.element, [...(existingChunks.get(s.element) ?? []), amountOf(s)]);
    goals.push({
      element: s.element, level: reach[s.element], by: noLater ? baselineEnd(s.id) : null, weight: noLater ? noLaterWeight : 1, source: 'existing', step: s.id,
      planet, measure: 'end', current: baselineEnd(s.id),
    });
  }
  for (const [element, b] of buildingMax) goals.push({ element, level: b.level, by: null, weight: 1, source: 'existing', step: b.step, planet, measure: 'end', current: baselineEnd(b.step) });
  for (const t of targetEntries(input.targets)) {
    goals.push({ element: t.element, level: (t.level ?? t.count)!, by: t.by ?? null, weight: t.weight ?? 1, source: 'target', step: null, planet, measure: 'end', current: null });
  }
  // kept transports with a time keep their departure: the planets they feed plan with it
  const keepTimeWeight = o.keepTimeWeight ?? 100;
  for (const k of kept) {
    const tr = k.step.transport;
    if (!tr || !keptOpen.has(k.step.id) || (tr.notBefore == null && tr.arriveAt == null)) continue;
    const at = baselineStart(k.step.id);
    if (at != null) goals.push({ element: 0, level: null, by: at, weight: keepTimeWeight, source: 'kept', step: k.step.id, planet, measure: 'start', current: at });
  }
  // the planets the list's transports feed: their open ship, defense and research steps should not end later either
  const watch: string[] = [];
  const otherPlanetsWeight = o.otherPlanetsWeight ?? noLaterWeight;
  if (noLater && otherPlanetsWeight > 0) {
    const fed = new Set(tail.filter((s) => isOpen(s) && s.transport?.target).map((s) => s.transport!.target!));
    for (const key of fed) {
      if (key === planet) continue;
      for (const s of order.planets[key] ?? []) {
        if (s.deactivated || s.element == null || s.kind === 'building' || doneStateOf(s, targetsNow.get(s.id), key, hub) !== 'open') continue;
        const end = baselineEnd(s.id);
        if (end == null) continue;
        goals.push({ element: s.element, level: null, by: end, weight: otherPlanetsWeight, source: 'other', step: s.id, planet: key, measure: 'end', current: end });
        watch.push(s.id);
      }
    }
  }
  // the current end of the targets asked for: where the list reaches them now
  const cum: Record<number, number> = { ...start };
  for (const g of goals) if (g.source === 'target' && g.level! <= (start[g.element] ?? 0)) g.current = input.now;
  for (const s of tail) {
    if (s.element == null || !isOpen(s)) continue;
    cum[s.element] = (cum[s.element] ?? 0) + amountOf(s);
    for (const g of goals) if (g.source === 'target' && g.current == null && g.element === s.element && g.level! <= cum[s.element]) g.current = baselineEnd(s.id);
  }

  // the levels needed: the goals, the requirements of the kept steps, all their requirements
  const wanted = targetMap(goals.filter((g) => g.level != null).map((g) => ({ element: g.element, level: g.level! })));
  const raise = (el: number, level: number) => {
    const kind = kindOf(el);
    const group = (kind === 'building' ? wanted.buildings : kind === 'research' ? wanted.research : kind === 'ship' ? wanted.ships : wanted.defense)!;
    group[el] = Math.max(group[el] ?? 0, level);
  };
  for (const k of kept) {
    if (!keptOpen.has(k.step.id) || k.step.element == null) continue;
    for (const [r, lv] of Object.entries(requirementsOfElement(k.step.element))) raise(Number(r), lv);
    if (k.step.kind === 'research') raise(RESEARCH_LAB, 1);
  }
  const targets = expandTargets(wanted, hp.type, start);
  const need = new Map<number, number>();
  const units = new Map<number, number[]>();
  const existingUnits = new Map<number, number>();
  for (const [key, level] of Object.entries(targets)) {
    const id = Number(key);
    const kind = kindOf(id);
    const have = (start[id] ?? 0) + (keptCount[id] ?? 0);
    if (kind === 'ship' || kind === 'defense') {
      const chunks = [...(existingChunks.get(id) ?? [])];
      existingUnits.set(id, chunks.length);
      const rest = level - have - chunks.reduce((a, b) => a + b, 0);
      if (rest > 0) chunks.push(rest);
      if (chunks.length) units.set(id, chunks);
      continue;
    }
    if (level - have <= 0) continue;
    if (kind === 'research' && hp.type !== 'planet') throw new OptimizeError(`targets: research ${id} cannot run on a moon, plan it on a planet`);
    need.set(id, level - have);
  }
  if (!need.size && !units.size) throw new OptimizeError('targets: all targets are reached already');
  for (const [id, n] of need) {
    const max = RESEARCH[String(id)]?.max;
    if (kindOf(id) === 'research' && (start[id] ?? 0) + (keptCount[id] ?? 0) + n > max) throw new OptimizeError(`targets: research ${id} goes up to level ${max}`);
  }
  const levelGoals = new Map<number, number[]>();
  goals.forEach((g, i) => {
    if (g.level != null) levelGoals.set(g.element, [...(levelGoals.get(g.element) ?? []), i]);
  });
  for (const l of levelGoals.values()) l.sort((a, b) => goals[a].level! - goals[b].level!);

  // transports whose ships the list builds: enforced where enough of them can come before it (else as before: the
  // ships may come by fleet, the simulation does not track them)
  const transportShips = new Map<string, { ship: number; count: number }[]>();
  const keptBefore: Record<number, number> = {};
  for (const k of kept) {
    const s = k.step;
    if (!keptOpen.has(s.id)) continue;
    if (s.kind === 'transport' && s.transport?.ships) {
      const ships: { ship: number; count: number }[] = [];
      for (const [id, n] of Object.entries(s.transport.ships)) {
        const ship = Number(id);
        const have = start[ship] ?? 0;
        const builds = (units.get(ship) ?? []).reduce((a, b) => a + b, 0) + (keptBefore[ship] ?? 0);
        if (have < n && builds > 0 && have + builds >= n) ships.push({ ship, count: n });
      }
      if (ships.length) transportShips.set(s.id, ships);
    }
    if (s.element != null && isUnitStep(s)) keptBefore[s.element] = (keptBefore[s.element] ?? 0) + amountOf(s);
  }

  const forbid = new Set(o.forbid ?? []);
  const economy = o.economy === false ? [] : ECONOMY.filter((id) => !forbid.has(id) && hp.type === 'planet');
  const fixed = fixBase(order, hub, planet, prefix, [...need.keys(), ...units.keys(), ...economy]);
  const used = new Set(Object.values(order.planets).flatMap((l) => l.map((s) => s.id)));
  let n = 0;
  const newId = () => {
    let id: string;
    do id = `__o${n++}`;
    while (used.has(id));
    return id;
  };
  const baselineInvalid = new Set(baseline.steps.filter((s) => s.state === 'invalid').map((s) => s.id));
  const keptStart = new Map(baseline.steps.filter((s) => keptSet.has(s.id)).map((s) => [s.id, s.start ?? Infinity]));
  const mr = o.mineRatio;
  const qh = o.quietHours;
  return {
    input, order: fixed, hub, planet, planetType: hp.type, prefix, tail, kept, keptOpen, targets, goals, levelGoals, start, need, units, existingUnits,
    watch, transportShips, includeExisting, economy,
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
    steps.reduce((n, s) => (s.element === id && (kind === 'research') === (s.kind === 'research') ? n + amountOf(s) : n), 0);
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
