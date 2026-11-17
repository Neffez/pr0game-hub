import { BUILDINGS, RESEARCH_LAB } from '@pr0hub/core/buildings';
import { STORAGE } from '@pr0hub/core/tech';
import { simulate } from '../simulate.js';
import type { Step } from '../types.js';
import { evaluate, orderWith, structureError } from './evaluate.js';
import { PRODUCERS, type Item, type Problem } from './problem.js';
import { bestEconomy, costOf, durationOf, levelIn, modelOf, project, ratioFirst, requirementsMet, scoreOf, storageFor, viewOf, type Model, type View } from './score.js';
import { kindOf, OptimizeError, requirementsOfElement } from './targets.js';

/**
 * Greedy construction (pr0plan `planner/greedyPlan.js`): step by step, the next required step whose requirements the
 * planned levels meet, unless an economy building scores better (see `score.ts`). The state of each decision comes
 * from the real simulation of the tail built so far, stopped where its last step starts (pr0plan runs its engine's
 * handlers directly; here the hub's `simulate` is the only engine, so slots, other planets' research, transports and
 * fleets count the same way as in the search).
 *
 * Deviations from pr0plan: the ready required steps are ordered by their soft deadline (`Goal.by`), then research,
 * buildings, units; kept steps go in once the decision time reaches the time they started in the current build
 * order (so transports and production steps keep their timing), but only after what they need: their requirements
 * and, for a transport, the ships it carries; kept steps that never started there go last.
 */
export type GreedyMode = 'plain' | 'score' | 'rollout';

/** what is still to place: steps per building and research, the unit steps' counts per ship and defense */
export interface Left {
  levels: Map<number, number>;
  units: Map<number, number[]>;
}

const leftOf = (problem: Problem): Left => ({ levels: new Map(problem.need), units: new Map([...problem.units].map(([k, v]) => [k, [...v]])) });
const cloneLeft = (l: Left): Left => ({ levels: new Map(l.levels), units: new Map([...l.units].map(([k, v]) => [k, [...v]])) });
const isEmpty = (l: Left) => !l.levels.size && !l.units.size;
const countOf = (l: Left, id: number) => l.units.get(id)?.[0] ?? 1;
const has = (l: Left, id: number) => l.levels.has(id) || l.units.has(id);

/** takes one step of `id` off (a unit step: its first count) */
function take(l: Left, id: number) {
  const u = l.units.get(id);
  if (u) {
    u.shift();
    if (!u.length) l.units.delete(id);
    return;
  }
  const n = l.levels.get(id);
  if (n == null) return;
  if (n > 1) l.levels.set(id, n - 1);
  else l.levels.delete(id);
}

export function greedyPlan(problem: Problem, mode: GreedyMode = 'score'): Item[] {
  const economy = mode !== 'plain';
  const items: Item[] = [];
  const kept = [...problem.kept];
  const left = leftOf(problem);
  const total = [...left.levels.values()].reduce((a, b) => a + b, 0) + [...left.units.values()].reduce((a, b) => a + b.length, 0);
  const guard = total * 20 + kept.length + 200;
  for (let round = 0; !isEmpty(left); round++) {
    if (round > guard) throw new OptimizeError('greedy: no progress (a requirement cannot be met)');
    const last = items[items.length - 1];
    const sim = simulate(orderWith(problem, items), problem.hub, {
      now: problem.input.now, units: problem.input.units, universe: problem.input.universe, lean: true, state: true,
      stop: { ids: last ? [last.step.id] : [], at: 'start' },
    });
    const lastResult = last ? sim.steps.find((s) => s.id === last.step.id) : null;
    if (last && !last.kept && lastResult?.state === 'invalid') throw new OptimizeError(`greedy: step ${last.step.kind} ${last.step.element} can never start (${lastResult.wait})`);
    const state = sim.final!;
    const m = modelOf(problem, state);
    const v = viewOf(problem, state);
    const started = new Set(sim.steps.filter((s) => s.state === 'planned').map((s) => s.id));
    v.pending = {};
    for (const e of problem.elsewhere) if (!started.has(e.id)) v.pending[e.element] = (v.pending[e.element] ?? 0) + 1;

    const ready = readyRequired(problem, v, left);
    // a kept step that is due (its time in the current build order, or nothing else can go): what it needs first
    let restricted: number[] | null = null;
    if (kept.length && ((problem.keptStart.get(kept[0].step.id) ?? Infinity) <= state.t || !ready.length)) {
      const missing = missingFor(problem, v, kept[0].step, left);
      if (!missing.length) {
        items.push(kept.shift()!);
        continue;
      }
      restricted = missing.filter((id) => requirementsMet(v, id));
      if (!restricted.length) throw new OptimizeError(`greedy: kept step ${kept[0].step.id} needs ${missing.join(', ')}, which cannot come before it`);
    }
    const candidates = restricted ?? ready;
    if (!candidates.length) throw new OptimizeError('greedy: the requirements of the remaining targets cannot be met');
    const next = candidates[0];
    let chosen = next;
    if (!restricted && mode === 'rollout') {
      chosen = byRollout(problem, items, kept, m, v, candidates.slice(0, 4), left);
    } else if (!restricted && economy && problem.economy.length) {
      const count = countOf(left, next);
      const cost = costOf(m, v, next, count);
      const score = scoreOf(m, v, cost, durationOf(m, v, next, cost, count), project(m, v, next, cost, count));
      const eco = bestEconomy(m, v);
      if (eco && eco.score < score && levelIn(v, eco.element) + 1 <= BUILDINGS[String(eco.element)].max) chosen = eco.element;
    }
    // a mine ratio: the mine that keeps it first
    chosen = ratioFirst(m, v, chosen);
    // a cost above the planned storage needs the storage first (the timeline would assume the rest comes by transport)
    const storage = storageFor(m, v, costOf(m, v, chosen, has(left, chosen) ? countOf(left, chosen) : 1));
    if (storage != null) chosen = storage;
    items.push({ step: stepOf(problem, chosen, has(left, chosen) ? countOf(left, chosen) : 1), kept: false });
    // deviation from pr0plan: an economy level of an element that is also a target counts as one of its required
    // levels (pr0plan only counts the required candidate, so its greedy plans overshoot such targets by the number of
    // economy levels taken; measured: HOME mines fixture 24/20/14 ended at metal 27 and crystal 23)
    take(left, chosen);
  }
  const out = [...items, ...kept];
  const broken = structureError(problem, out);
  if (broken) throw new OptimizeError(`greedy: ${broken}`);
  return out;
}

/** A new step of the optimizer for an element (`count` units for ships and defense). */
export function stepOf(problem: Problem, element: number, count = 1): Step {
  const kind = kindOf(element);
  return kind === 'ship' || kind === 'defense' ? { id: problem.newId(), kind, element, count } : { id: problem.newId(), kind, element };
}

/** The earliest soft deadline of the goals of `id` its planned level does not reach yet (Infinity: none). */
function urgency(problem: Problem, v: View, id: number): number {
  const level = levelIn(v, id);
  let by = Infinity;
  for (const i of problem.levelGoals.get(id) ?? []) {
    const g = problem.goals[i];
    if (g.level! > level && g.by != null) by = Math.min(by, g.by);
  }
  return by;
}

const rank = (id: number) => ({ research: 0, building: 1, ship: 2, defense: 2 })[kindOf(id)];

/** The required elements whose requirements the planned levels meet: by deadline, then research, buildings, units, id. */
function readyRequired(problem: Problem, v: View, left: Left): number[] {
  const ids = [...left.levels.keys(), ...left.units.keys()].filter((id) => requirementsMet(v, id));
  const u = new Map(ids.map((id) => [id, urgency(problem, v, id)]));
  return ids.sort((a, b) => u.get(a)! - u.get(b)! || rank(a) - rank(b) || a - b);
}

/**
 * The required elements a kept step needs before it: its requirements (and theirs) that the planned levels do not
 * reach yet, for a transport the ships it carries that the list still has to build. Research first.
 */
function missingFor(problem: Problem, v: View, step: Step, left: Left): number[] {
  const out = new Set<number>();
  const reqs = (el: number) => {
    for (const [r, need] of Object.entries(requirementsOfElement(el))) visit(Number(r), need);
    if (kindOf(el) === 'research') visit(RESEARCH_LAB, 1);
  };
  const visit = (el: number, need: number) => {
    if (levelIn(v, el) + (v.pending?.[el] ?? 0) >= need || !has(left, el) || out.has(el)) return;
    out.add(el);
    reqs(el);
  };
  if (step.element != null && problem.keptOpen.has(step.id)) reqs(step.element);
  for (const { ship, count } of problem.transportShips.get(step.id) ?? []) {
    if ((v.levels[ship] ?? 0) < count && left.units.has(ship)) {
      out.add(ship);
      reqs(ship);
    }
  }
  return [...out].sort((a, b) => rank(a) - rank(b) || a - b);
}

/**
 * Deviation from pr0plan (its estimate `scoreCandidate` is kept as mode `score`): each candidate, one of the first
 * ready required steps or an economy building, is scored by the real simulation of the tail so far, the candidate and
 * then the remaining required steps in the plain order (a rollout). Measured on the test account (3 planets, 151
 * steps): see the comparison in `optimize`'s header.
 */
function byRollout(problem: Problem, items: Item[], kept: Item[], m: Model, v: View, required: number[], left: Left): number {
  const eco = problem.economy.filter((id) => PRODUCERS.includes(id) && !required.includes(id) && requirementsMet(v, id) && levelIn(v, id) + 1 <= BUILDINGS[String(id)].max);
  let best = required[0];
  let bestValue = Infinity;
  for (const c of [...required, ...eco]) {
    const rest = cloneLeft(left);
    const n = has(rest, c) ? countOf(rest, c) : 1;
    take(rest, c);
    const view = { ...v, levels: { ...v.levels }, research: { ...v.research } };
    const tail = [...placed(problem, m, view, c, n), ...plainRest(problem, m, view, rest), ...kept];
    const fit = evaluate(problem, [...items, ...tail]).fitness;
    if (fit.valid && fit.value < bestValue) {
      bestValue = fit.value;
      best = c;
    }
  }
  return best;
}

/** Steps for `id` (`n` units) with the storage it needs first; updates the view's levels. */
function placed(problem: Problem, m: Model, view: View, id: number, n: number): Item[] {
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

/** The remaining required steps in the plain order: the first ready one by deadline, research, buildings, units. */
function plainRest(problem: Problem, m: Model, view: View, left: Left): Item[] {
  const out: Item[] = [];
  const rest = cloneLeft(left);
  while (!isEmpty(rest)) {
    const id = readyRequired(problem, view, rest)[0];
    if (id == null) break;
    out.push(...placed(problem, m, view, id, countOf(rest, id)));
    take(rest, id);
  }
  return out;
}

/**
 * The current list as a start of the search (with `includeExisting`): its open steps as they are, then what the
 * targets need beyond them in the plain order. Null when that is not a valid tail.
 */
export function currentPlan(problem: Problem): Item[] | null {
  if (!problem.includeExisting) return null;
  const keptIds = new Set(problem.kept.map((k) => k.step.id));
  const items: Item[] = [];
  const left = leftOf(problem);
  for (const s of problem.tail) {
    if (keptIds.has(s.id)) {
      items.push({ step: s, kept: true });
      continue;
    }
    if (s.element == null) continue;
    const step: Step = { ...s, id: problem.newId() };
    delete step.done;
    items.push({ step, kept: false });
    take(left, s.element);
  }
  if (!isEmpty(left)) {
    const sim = simulate(orderWith(problem, items), problem.hub, {
      now: problem.input.now, units: problem.input.units, universe: problem.input.universe, lean: true, state: true,
    });
    const v = viewOf(problem, sim.final!);
    items.push(...plainRest(problem, modelOf(problem, sim.final!), v, left));
  }
  const repaired = withStorages(problem, items);
  return structureError(problem, repaired) ? null : repaired;
}

/**
 * A storage level before each of the optimizer's steps that does not fit into the storages (a list written by hand
 * often counts on resources coming by transport; the search does not), at most 30.
 */
function withStorages(problem: Problem, items: Item[]): Item[] {
  let out = items;
  for (let guard = 0; guard < 30; guard++) {
    const sim = simulate(orderWith(problem, out), problem.hub, { now: problem.input.now, units: problem.input.units, universe: problem.input.universe, lean: true });
    const byId = new Map(sim.steps.map((r) => [r.id, r]));
    const i = out.findIndex((it) => !it.kept && byId.get(it.step.id)?.transport);
    if (i < 0) return out;
    const r = Number(Object.keys(byId.get(out[i].step.id)!.transport!)[0]);
    out = [...out.slice(0, i), { step: stepOf(problem, STORAGE[r]), kept: false }, ...out.slice(i)];
  }
  return out;
}
