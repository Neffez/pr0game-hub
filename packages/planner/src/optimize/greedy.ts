import { BUILDINGS } from '@pr0hub/core/buildings';
import { simulate } from '../simulate.js';
import type { Step } from '../types.js';
import { evaluate, orderWith } from './evaluate.js';
import { PRODUCERS, type Item, type Problem } from './problem.js';
import { bestEconomy, ratioFirst, costOf, durationOf, levelIn, modelOf, project, requirementsMet, scoreOf, storageFor, viewOf, type View } from './score.js';
import { kindOf, OptimizeError } from './targets.js';

/**
 * Greedy construction (pr0plan `planner/greedyPlan.js`): step by step, the next required step whose requirements the
 * planned levels meet (research before buildings before units, by element id), unless an economy building scores
 * better (see `score.ts`). The state of each decision comes from the real simulation of the tail built so far, stopped
 * where its last step starts (pr0plan runs its engine's handlers directly; here the hub's `simulate` is the only
 * engine, so slots, other planets' research, transports and fleets count the same way as in the search).
 *
 * Kept steps go in once the decision time reaches the time they started in the current build order (so transports
 * and production steps keep their timing); those that never started there go last.
 */
export type GreedyMode = 'plain' | 'score' | 'rollout';

export function greedyPlan(problem: Problem, mode: GreedyMode = 'score'): Item[] {
  const economy = mode !== 'plain';
  const items: Item[] = [];
  const kept = [...problem.kept];
  const left = new Map(problem.need);
  const unitsLeft = new Map(problem.units);
  const total = [...left.values()].reduce((a, b) => a + b, 0) + unitsLeft.size;
  const guard = total * 20 + 200;
  for (let round = 0; left.size || unitsLeft.size; round++) {
    if (round > guard) throw new OptimizeError('greedy: no progress (a requirement cannot be met)');
    const last = items[items.length - 1];
    const sim = simulate(orderWith(problem, items), problem.hub, {
      now: problem.input.now, units: problem.input.units, universe: problem.input.universe, lean: true, state: true,
      stop: { ids: last ? [last.step.id] : [], at: 'start' },
    });
    const lastResult = last ? sim.steps.find((s) => s.id === last.step.id) : null;
    if (last && !last.kept && lastResult?.state === 'invalid') throw new OptimizeError(`greedy: step ${last.step.kind} ${last.step.element} can never start (${lastResult.wait})`);
    const state = sim.final!;
    if (kept.length && (problem.keptStart.get(kept[0].step.id) ?? Infinity) <= state.t) {
      items.push(kept.shift()!);
      continue;
    }
    const m = modelOf(problem, state);
    const v = viewOf(problem, state);
    const started = new Set(sim.steps.filter((s) => s.state === 'planned').map((s) => s.id));
    v.pending = {};
    for (const e of problem.elsewhere) if (!started.has(e.id)) v.pending[e.element] = (v.pending[e.element] ?? 0) + 1;
    const next = nextRequired(problem, v, left, unitsLeft);
    if (next == null) {
      // nothing is ready by the planned levels: a kept step may bring it (or nothing can)
      if (kept.length) {
        items.push(kept.shift()!);
        continue;
      }
      throw new OptimizeError('greedy: the requirements of the remaining targets cannot be met');
    }
    const count = unitsLeft.get(next) ?? 1;
    let chosen = next;
    if (mode === 'rollout' && problem.economy.length) {
      chosen = byRollout(problem, items, kept, m, v, next, left, unitsLeft, count);
    } else if (economy && problem.economy.length) {
      const cost = costOf(m, v, next, count);
      const score = scoreOf(m, v, cost, durationOf(m, v, next, cost, count), project(m, v, next, cost, count));
      const eco = bestEconomy(m, v);
      if (eco && eco.score < score && levelIn(v, eco.element) + 1 <= BUILDINGS[String(eco.element)].max) chosen = eco.element;
    }
    // a mine ratio: the mine that keeps it first
    chosen = ratioFirst(m, v, chosen);
    // a cost above the planned storage needs the storage first (the timeline would assume the rest comes by transport)
    const storage = storageFor(m, v, costOf(m, v, chosen, chosen === next ? count : 1));
    if (storage != null) chosen = storage;
    items.push({ step: stepOf(problem, chosen, chosen === next ? count : 1), kept: false });
    // deviation from pr0plan: an economy level of an element that is also a target counts as one of its required
    // levels (pr0plan only counts the required candidate, so its greedy plans overshoot such targets by the number of
    // economy levels taken; measured: HOME mines fixture 24/20/14 ended at metal 27 and crystal 23)
    if (unitsLeft.has(chosen)) unitsLeft.delete(chosen);
    else if (left.has(chosen)) {
      const n = left.get(chosen)! - 1;
      if (n > 0) left.set(chosen, n);
      else left.delete(chosen);
    }
  }
  return [...items, ...kept];
}

/** A new step of the optimizer for an element (`count` units for ships and defense). */
export function stepOf(problem: Problem, element: number, count = 1): Step {
  const kind = kindOf(element);
  return kind === 'ship' || kind === 'defense' ? { id: problem.newId(), kind, element, count } : { id: problem.newId(), kind, element };
}

/** The first required element whose requirements the planned levels meet: research, buildings, units, by id. */
function nextRequired(_problem: Problem, v: View, left: Map<number, number>, unitsLeft: Map<number, number>): number | null {
  const ids = [...left.keys(), ...unitsLeft.keys()].sort((a, b) => rank(a) - rank(b) || a - b);
  for (const id of ids) if (requirementsMet(v, id)) return id;
  return null;
}

/**
 * Deviation from pr0plan (its estimate `scoreCandidate` is kept as mode `score`): each candidate, the next required
 * step or an economy building, is scored by the real simulation of the tail so far, the candidate and then the
 * remaining required steps in the plain order (a rollout). Measured on the test account (3 planets, 151 steps): see
 * the comparison in `optimize`'s header.
 */
function byRollout(
  problem: Problem, items: Item[], kept: Item[], m: ReturnType<typeof modelOf>, v: View, next: number, left: Map<number, number>, unitsLeft: Map<number, number>, count: number,
): number {
  const candidates = [next, ...problem.economy.filter((id) => PRODUCERS.includes(id) && id !== next && requirementsMet(v, id) && levelIn(v, id) + 1 <= BUILDINGS[String(id)].max)];
  let best = next;
  let bestValue = Infinity;
  for (const c of candidates) {
    const n = c === next ? count : 1;
    const rest = new Map(left);
    const restUnits = new Map(unitsLeft);
    if (restUnits.has(c)) restUnits.delete(c);
    else if (rest.has(c)) rest.set(c, rest.get(c)! - 1);
    const view = { ...v, levels: { ...v.levels }, research: { ...v.research } };
    const tail = [...placed(problem, m, view, c, n), ...plainRest(problem, m, view, rest, restUnits), ...kept];
    const fit = evaluate(problem, [...items, ...tail])!.fitness;
    if (fit.valid && fit.value < bestValue) {
      bestValue = fit.value;
      best = c;
    }
  }
  return best;
}

/** Steps for `id` (`n` units) with the storage it needs first; updates the view's levels. */
function placed(problem: Problem, m: ReturnType<typeof modelOf>, view: View, id: number, n: number): Item[] {
  const out: Item[] = [];
  const first = ratioFirst(m, view, id);
  if (first !== id) out.push(...placed(problem, m, view, first, 1));
  for (let guard = 0; guard < 30; guard++) {
    const storage = storageFor(m, view, costOf(m, view, id, n));
    if (storage == null) break;
    out.push({ step: stepOf(problem, storage), kept: false });
    view.levels[storage] = (view.levels[storage] ?? 0) + 1;
  }
  out.push({ step: stepOf(problem, id, n), kept: false });
  if (kindOf(id) === 'research') view.research[id] = (view.research[id] ?? 0) + 1;
  else view.levels[id] = (view.levels[id] ?? 0) + n;
  return out;
}

/** The remaining required steps in the plain order: the first whose requirements are met, research, buildings, units. */
function plainRest(problem: Problem, m: ReturnType<typeof modelOf>, view: View, left: Map<number, number>, unitsLeft: Map<number, number>): Item[] {
  const out: Item[] = [];
  const rest = new Map([...left].filter(([, n]) => n > 0));
  const units = new Map(unitsLeft);
  while (rest.size || units.size) {
    const id = nextRequired(problem, view, rest, units);
    if (id == null) break;
    out.push(...placed(problem, m, view, id, units.get(id) ?? 1));
    if (units.has(id)) units.delete(id);
    else if (rest.get(id)! > 1) rest.set(id, rest.get(id)! - 1);
    else rest.delete(id);
  }
  return out;
}

const rank = (id: number) => ({ research: 0, building: 1, ship: 2, defense: 2 })[kindOf(id)];
