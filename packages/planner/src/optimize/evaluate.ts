import { simulate, type Simulation, type SimState } from '../simulate.js';
import type { BuildOrder } from '../types.js';
import { MINES, type Item, type Problem } from './problem.js';

/**
 * Fitness of a tail: the real simulation (`simulate`) of the whole build order with the planet's list replaced, the
 * other planets' lists as they are. Invalid when a step of the tail can never start or a step elsewhere that the
 * current build order plans becomes invalid. The objective is the end of the last required step (all targets
 * reached), plus the soft penalties; a tie goes to more resources and production at that time.
 */

export interface Fitness {
  valid: boolean;
  /** epoch seconds all targets are reached */
  finish: number;
  /** finish + penalties - tie-breaker (lower is better) */
  value: number;
  /** resources plus a day of production at the finish (tie-breaker) */
  wealth: number;
  /** index of the last required step in the tail (steps after it are dead: they change nothing) */
  last: number;
}

export const INVALID: Fitness = { valid: false, finish: Infinity, value: Infinity, wealth: 0, last: -1 };

export function orderWith(problem: Problem, items: Item[]): BuildOrder {
  return { ...problem.order, planets: { ...problem.order.planets, [problem.planet]: [...problem.prefix, ...items.map((i) => i.step)] } };
}

/** Positions of the required steps: the first `need` steps of each element (later ones of an economy building are extra levels). */
export function requiredIndices(problem: Problem, items: Item[]): number[] {
  const seen = new Map<number, number>();
  const out: number[] = [];
  items.forEach((it, i) => {
    const s = it.step;
    if (it.kept || s.element == null) return;
    const n = problem.need.get(s.element) ?? (problem.units.has(s.element) ? 1 : 0);
    const k = seen.get(s.element) ?? 0;
    if (k < n) out.push(i);
    seen.set(s.element, k + 1);
  });
  return out;
}

export interface Evaluation {
  fitness: Fitness;
  sim: Simulation;
}

export function evaluate(problem: Problem, items: Item[], full = false): Evaluation | null {
  problem.stats.evaluations++;
  const required = requiredIndices(problem, items);
  const ids = required.map((i) => items[i].step.id);
  const { input } = problem;
  const sim = simulate(orderWith(problem, items), problem.hub, {
    now: input.now, units: input.units, universe: input.universe, lean: !full, state: true, ...(full ? {} : { stop: { ids, at: 'end' as const } }),
  });
  return { sim, fitness: fitnessOf(problem, items, sim, required) };
}

export function fitnessOf(problem: Problem, items: Item[], sim: Simulation, required = requiredIndices(problem, items)): Fitness {
  const byId = new Map(sim.steps.map((s) => [s.id, s]));
  for (const s of sim.steps) if (s.state === 'invalid' && !problem.baselineInvalid.has(s.id)) return INVALID;
  // the optimizer's steps must fit into the storages: the timeline assumes what does not fit comes by transport
  for (const it of items) if (!it.kept && byId.get(it.step.id)?.transport) return INVALID;
  // every required step must have been simulated and planned
  let finish = problem.input.now;
  for (const i of required) {
    const r = byId.get(items[i].step.id);
    if (!r || r.state !== 'planned' || r.end == null) return INVALID;
    finish = Math.max(finish, r.end);
  }
  const last = required.length ? required[required.length - 1] : -1;
  let penalty = 0;
  if (problem.mineRatio) penalty += mineRatioPenalty(problem, items, last);
  if (problem.quietHours) penalty += quietPenalty(problem, items, last, byId);
  const wealth = wealthOf(problem, sim.final);
  // squashed below one second: only decides between equal finish times
  return { valid: true, finish, value: finish + penalty - 0.5 * (wealth / (wealth + 1e7)), wealth, last };
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
