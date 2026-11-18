import { RESEARCH_LAB } from '@pr0hub/core/buildings';
import { simulate, type Simulation, type SimState } from '../simulate.js';
import type { BuildOrder } from '../types.js';
import { amountOf, MINES, type Goal, type Item, type Problem } from './problem.js';
import { requirementsOfElement } from './targets.js';

/**
 * Fitness of a tail: the real simulation (`simulate`) of the whole build order with the planet's list replaced, the
 * other planets' lists as they are. Invalid when the tail breaks its structure (a step before its requirements, a
 * transport before the ships it carries), a step of the tail can never start, or a step elsewhere that the current
 * build order plans becomes invalid. The objective is the finish (all goals and kept steps done), plus the weighted
 * lateness of the goals with a deadline, plus a small weighted sum of the goals' completion times (earlier is still
 * better), plus the soft penalties; a tie goes to more resources and production at the finish.
 */

export interface Fitness {
  valid: boolean;
  /** epoch seconds all goals are reached and all kept steps are done */
  finish: number;
  /** epoch seconds all goals with a level (targets, the list's steps) are reached */
  targetsFinish: number;
  /** finish + penalties - tie-breaker (lower is better) */
  value: number;
  /** resources plus a day of production at the finish (tie-breaker) */
  wealth: number;
  /** completion of each goal (`problem.goals`) */
  ends: number[];
  /** index of the last required or kept step in the tail (the optimizer's steps after it are dead: they change nothing) */
  last: number;
  /** why it is not valid */
  reason?: string;
}

export const INVALID: Fitness = { valid: false, finish: Infinity, targetsFinish: Infinity, value: Infinity, wealth: 0, ends: [], last: -1 };
const invalid = (reason: string): Fitness => ({ ...INVALID, reason });

/** share of the goals' completion times in the objective, spread over all goals */
const SPREAD = 0.1;

export function orderWith(problem: Problem, items: Item[]): BuildOrder {
  return { ...problem.order, planets: { ...problem.order.planets, [problem.planet]: [...problem.prefix, ...items.map((i) => i.step)] } };
}

/**
 * Positions of the required steps: the first `need` steps of each building and research (later ones of an economy
 * building are extra levels) and every unit step of the optimizer.
 */
export function requiredIndices(problem: Problem, items: Item[]): number[] {
  const seen = new Map<number, number>();
  const out: number[] = [];
  items.forEach((it, i) => {
    const s = it.step;
    if (it.kept || s.element == null) return;
    if (problem.units.has(s.element)) {
      out.push(i);
      return;
    }
    const n = problem.need.get(s.element) ?? 0;
    const k = seen.get(s.element) ?? 0;
    if (k < n) out.push(i);
    seen.set(s.element, k + 1);
  });
  return out;
}

/** whether an item changes levels (the optimizer's steps and the kept steps that are open) */
const counts = (problem: Problem, it: Item) => it.step.element != null && !it.step.deactivated && (!it.kept || problem.keptOpen.has(it.step.id));

/**
 * The tail's structure, without simulating: every step after its requirements (levels the tail starts from plus the
 * steps before it; research also needs a lab), every transport whose ships the list builds after enough of them.
 * Returns why not, null when it holds.
 */
export function structureError(problem: Problem, items: Item[]): string | null {
  // ships count from the planet's stock for transports (ships are no requirements, so this changes nothing else)
  const lv: Record<number, number> = { ...problem.start, ...problem.shipStock };
  for (const it of items) {
    const s = it.step;
    const open = counts(problem, it);
    if (open) {
      for (const [r, need] of Object.entries(requirementsOfElement(s.element!))) {
        if ((lv[Number(r)] ?? 0) < need) return `${s.kind} ${s.element} (${s.id}) needs ${r} level ${need} before it`;
      }
      if (s.kind === 'research' && (lv[RESEARCH_LAB] ?? 0) < 1) return `research ${s.element} (${s.id}) needs a research lab before it`;
    }
    for (const { ship, count } of problem.transportShips.get(s.id) ?? []) {
      if ((lv[ship] ?? 0) < count) return `transport ${s.id} needs ${count} of ship ${ship} built before it`;
    }
    if (open) lv[s.element!] = (lv[s.element!] ?? 0) + amountOf(s);
  }
  return null;
}

/** When each goal is reached: the end of the step whose cumulative level reaches it, of its kept step; null: not reached. */
export function goalEnds(problem: Problem, items: Item[], endOf: (id: string, measure: Goal['measure']) => number | null): (number | null)[] {
  return goalAt(problem, items, endOf, problem.input.now);
}

/** `at` of the step that reaches each goal (`atStart` when the levels the tail starts from reach it already). */
export function goalAt<T>(problem: Problem, items: Item[], endOf: (id: string, measure: Goal['measure']) => T | null, atStart: T | null): (T | null)[] {
  const ends: (T | null)[] = problem.goals.map((g) => (g.level != null && g.level <= (problem.start[g.element] ?? 0) ? atStart : null));
  const cum: Record<number, number> = {};
  const next = new Map<number, number>();
  for (const it of items) {
    if (!counts(problem, it)) continue;
    const el = it.step.element!;
    const goals = problem.levelGoals.get(el);
    cum[el] = (cum[el] ?? problem.start[el] ?? 0) + amountOf(it.step);
    if (!goals) continue;
    let k = next.get(el) ?? 0;
    while (k < goals.length && problem.goals[goals[k]].level! <= cum[el]) {
      if (ends[goals[k]] == null) ends[goals[k]] = endOf(it.step.id, 'end');
      k++;
    }
    next.set(el, k);
  }
  problem.goals.forEach((g, i) => {
    if (g.level == null) ends[i] = endOf(g.step!, g.measure);
  });
  return ends;
}

export interface Evaluation {
  fitness: Fitness;
  sim: Simulation | null;
}

export function evaluate(problem: Problem, items: Item[]): Evaluation {
  problem.stats.evaluations++;
  const broken = structureError(problem, items);
  if (broken) return { fitness: invalid(broken), sim: null };
  const required = requiredIndices(problem, items);
  const ids = [...required.map((i) => items[i].step.id), ...items.filter((it) => it.kept).map((it) => it.step.id), ...problem.watch];
  const { input } = problem;
  const sim = simulate(orderWith(problem, items), problem.hub, {
    now: input.now, units: input.units, universe: input.universe, lean: true, state: true, stop: { ids, at: 'end' },
  });
  return { sim, fitness: fitnessOf(problem, items, sim, required) };
}

export function fitnessOf(problem: Problem, items: Item[], sim: Simulation, required = requiredIndices(problem, items)): Fitness {
  const byId = new Map(sim.steps.map((s) => [s.id, s]));
  for (const s of sim.steps) if (s.state === 'invalid' && !problem.baselineInvalid.has(s.id)) return invalid(`step ${s.id} of ${s.planet} can never start (${s.wait})`);
  // the optimizer's steps must fit into the storages: the timeline assumes what does not fit comes by transport
  for (const it of items) if (!it.kept && byId.get(it.step.id)?.transport) return invalid(`step ${it.step.id} needs more than the storages hold`);
  // every required step must have been simulated and planned
  for (const i of required) {
    const r = byId.get(items[i].step.id);
    if (!r || r.state !== 'planned' || r.end == null) return invalid(`step ${items[i].step.id} is not planned`);
  }
  const endOf = (id: string, measure: Goal['measure']) => {
    const r = byId.get(id);
    return r?.state === 'planned' ? (measure === 'start' ? r.start : r.end) : null;
  };
  const now = problem.input.now;
  const found = goalEnds(problem, items, endOf);
  const ends: number[] = [];
  let targetsFinish = now;
  let lateness = 0;
  let spread = 0;
  for (const [i, g] of problem.goals.entries()) {
    const end = found[i];
    if (end == null) {
      if (g.level == null) {
        // a kept step without an end (its colonization waits for astrophysics elsewhere), a step of another planet
        // after the simulation stopped: not measured
        ends.push(now);
        continue;
      }
      return invalid(`goal ${g.element} level ${g.level} is not reached`);
    }
    ends.push(end);
    if (g.level != null) targetsFinish = Math.max(targetsFinish, end);
    if (g.by != null && end > g.by) lateness += g.weight * (end - g.by);
    // a departure is kept, not hurried: only its lateness counts
    if (g.measure === 'end') spread += g.weight * (end - now);
  }
  let finish = targetsFinish;
  let last = required.length ? required[required.length - 1] : -1;
  items.forEach((it, i) => {
    if (!it.kept) return;
    last = Math.max(last, i);
    const end = endOf(it.step.id, 'end');
    if (end != null) finish = Math.max(finish, end);
  });
  let penalty = lateness + (problem.goals.length ? (SPREAD / problem.goals.length) * spread : 0);
  if (problem.mineRatio) penalty += mineRatioPenalty(problem, items, last);
  if (problem.quietHours) penalty += quietPenalty(problem, items, last, byId);
  const wealth = wealthOf(problem, sim.final);
  // squashed below one second: only decides between equal finish times
  return { valid: true, finish, targetsFinish, value: finish + penalty - 0.5 * (wealth / (wealth + 1e7)), wealth, ends, last };
}

function wealthOf(problem: Problem, state: SimState | undefined): number {
  const p = state?.planets[problem.planet];
  if (!p) return 0;
  return [901, 902, 903].reduce((n, r) => n + p.res[r] + 24 * Math.max(0, p.rate[r]), 0);
}

/** Levels the mines drift apart beyond the allowed gap, summed after each step up to the last required one. */
function mineRatioPenalty(problem: Problem, items: Item[], last: number): number {
  const m = problem.mineRatio!;
  const lv = MINES.map((id) => problem.start[id] ?? 0);
  const off = () =>
    Math.max(0, lv[0] - lv[1] - m.crystalBelowMetal - m.tolerance) + Math.max(0, lv[1] - lv[2] - m.deutBelowCrystal - m.tolerance);
  let sum = 0;
  for (let i = 0; i <= last; i++) {
    const s = items[i].step;
    const k = s.kind === 'building' ? MINES.indexOf(s.element!) : -1;
    if (k >= 0) lv[k]++;
    sum += off();
  }
  return sum * m.weight;
}

/** Local time offsets of the universe's time zone, cached per hour. */
const offsets = new Map<string, number>();
function localSecondOfDay(t: number, tz: string): number {
  const hour = Math.floor(t / 3600);
  const key = `${tz}|${hour}`;
  let off = offsets.get(key);
  if (off == null) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const parts = Object.fromEntries(f.formatToParts(new Date(hour * 3600 * 1000)).map((p) => [p.type, p.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) / 1000;
    off = local - hour * 3600;
    if (offsets.size > 100_000) offsets.clear();
    offsets.set(key, off);
  }
  return (((t + off) % 86400) + 86400) % 86400;
}

/** Seconds from `t` to the end of the quiet window when `t` lies in it, else 0. */
export function quietWait(t: number, from: number, to: number, tz: string): number {
  const s = localSecondOfDay(t, tz);
  const a = from * 3600;
  const b = to * 3600;
  if (a === b) return 0;
  if (a < b) return s >= a && s < b ? b - s : 0;
  if (s >= a) return 86400 - s + b;
  return s < b ? b - s : 0;
}

/** Steps of the tail (up to the last required) that start in the quiet window: the wait until it ends. */
function quietPenalty(problem: Problem, items: Item[], last: number, byId: Map<string, { start: number | null }>): number {
  const q = problem.quietHours!;
  const tz = problem.input.universe?.timezone || 'Europe/Berlin';
  let sum = 0;
  for (let i = 0; i <= last; i++) {
    const start = byId.get(items[i].step.id)?.start;
    if (start != null && start > problem.input.now) sum += quietWait(start, q.from, q.to, tz);
  }
  return sum * q.weight;
}
