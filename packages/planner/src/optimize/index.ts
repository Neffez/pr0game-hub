/**
 * Auto plan: the build order that reaches the targets of one planet fastest. Ported from the "Auto Plan" of pr0plan
 * (https://pr0sync.pages.dev/, `src/planner/*`, `src/targets/*`), with the kind permission of its author: target
 * expansion, greedy construction with one shared score for required steps and economy buildings, then simulated
 * annealing with reheating against the real simulation. The engine is the hub's `simulate` (not pr0plan's
 * `GameReducer`): the universe's settings, several planets, transports, synced fleets and queues count as in the
 * timeline.
 *
 * v1 optimizes one planet: the open tail of its list (done and queued steps stay, kept steps keep their order); the
 * other planets' lists, their transports and colonizations are simulated as they are. It returns a proposal and
 * writes nothing.
 *
 * Deliberate deviations from pr0plan, measured on `test/optimizeFixture.ts` (3 planets, 151 steps, three targets,
 * seeds 1-3, `test/optimize.bench.test.ts`):
 * - greedy candidates are scored by a rollout (the real simulation of candidate + remaining required steps in the
 *   plain order) instead of pr0plan's estimate; pr0plan's is kept as `greedy: 'score'`. Greedy plans 27.3 / 375 /
 *   32.2 h instead of 74.1 / 517 / 82.6 h; after 20 000 simulations 21.1 / 311.5 / 28.8 h instead of 21.1 / 317.0 /
 *   28.9 h (`greedy.ts`);
 * - an economy level of a target element counts as one of its required levels (pr0plan's greedy overshoots such
 *   targets, `greedy.ts`);
 * - storages are built when a cost does not fit, and the search may insert them (the hub caps resources at the
 *   storage, pr0plan has none); a plan that would need resources "by transport" is invalid (`evaluate.ts`);
 * - with a mine ratio the greedy builds the mine that keeps it first (the soft penalty alone left 7 levels between
 *   metal and crystal after 300 iterations);
 * - evaluations stop the simulation once the targets are reached and skip the timeline's display data (`simulate`
 *   options `stop`, `lean`): 1.3 ms instead of 3.9 ms per evaluation.
 * - priorities (not in pr0plan, whose only objective is the finish): the objective is the finish of everything (kept
 *   steps included, e.g. a colonization landing), plus the weighted lateness of goals with a deadline (targets with
 *   `by`, and under `noLater` every open ship, defense and research step of the list at its end now), plus 0.1 × the
 *   mean weighted completion time; existing unit steps keep their counts as steps of their own. Over 8 seeds this
 *   changed nothing for the finish of plain targets (COL1 21.69 / 21.69 h, mines 320.2 / 320.9 h, impulse 29.95 /
 *   29.94 h before / after at 4 000 simulations);
 * - structure as a hard constraint checked before simulating: every step after its requirements, a transport after
 *   the ship steps that build the ships it carries (the simulation does not track ships); the greedy builds a kept
 *   step's requirements and ships before it; the current list (storages added where it counted on transports) is a
 *   start of the search, so the result is never worse by the objective.
 * Tried and not kept (no better at equal simulations): a single pass with the production moves mixed in (COL1 23.8 h
 * instead of 21.4 h), a local shift move, start temperatures of 600 and 1800 s instead of pr0plan's 2 h.
 */
import { withUnits } from '@pr0hub/core/units';
import { simulate } from '../simulate.js';
import type { Base, Step } from '../types.js';
import { anneal, adjustThrottleMove, insertEconomyMove, insertThrottleMove, moveMove, removeMove, swapMove, type Move } from './anneal.js';
import { evaluate, goalAt, orderWith, requiredIndices, type Fitness } from './evaluate.js';
import { currentPlan, greedyPlan } from './greedy.js';
import { setupProblem, type Goal, type Item, type OptimizeInput, type Problem } from './problem.js';
import { createRng } from './rng.js';

export { expandTargets, OptimizeError, type OptimizeTargets, type TargetEntry } from './targets.js';
export { quietWait } from './evaluate.js';
export type { Goal, MineRatio, OptimizeInput, OptimizeOptions, QuietHours } from './problem.js';

export interface OptimizeRun {
  /** wall time of the search after the greedy plan (default 10 s, unless `iterations` is given) */
  budgetMs?: number;
  /** or a fixed number of annealing iterations (reproducible regardless of the machine) */
  iterations?: number;
  /** stop once this many simulations ran in total, the greedy plans included (fair comparisons of variants) */
  maxEvaluations?: number;
  seed?: number;
  /** ids of the steps in the result (default `opt-…`) */
  newId?: () => string;
  /** checked during the search: true stops it (the best so far is returned) */
  shouldStop?: () => boolean;
  onProgress?: (p: OptimizeProgress) => void;
  /** a better plan was found (at most every `bestEveryMs`, and once at the end of each phase) */
  onBest?: (best: OptimizeResult) => void;
  bestEveryMs?: number;
  /** annealing: start temperature in seconds (default 7200), cooling per iteration (0.999), reheat interval (5000) */
  temperature?: number;
  coolingRate?: number;
  reheatEvery?: number;
  /** how the greedy scores its candidates (default `rollout`, `score`: pr0plan's estimate) */
  greedy?: 'score' | 'rollout';
}

export type OptimizePhase = 'greedy' | 'anneal' | 'throttle';

export interface OptimizeProgress {
  phase: OptimizePhase;
  iteration: number;
  evaluations: number;
  /** finish of the best plan so far (epoch seconds) */
  finishAt: number;
}

export interface OptimizeStepTime {
  id: string;
  start: number | null;
  end: number | null;
}

/** A goal of the objective with its end in the current build order and in the result. */
export interface OptimizeGoalResult {
  element: number;
  /** level or count reached; null: the end of the kept step `step` */
  level: number | null;
  by: number | null;
  weight: number;
  source: Goal['source'];
  /** id of the step it stems from in the result (a new id for an existing step that moved), null for a target */
  step: string | null;
  /** end in the current build order (null: not reached there) */
  currentEnd: number | null;
  end: number;
}

export interface OptimizeResult {
  /** the planet's whole list: the steps before the open tail as they are, then the optimized tail */
  steps: Step[];
  /** the build order's base, raised where the hub already has more than its steps (send it along with the steps) */
  base: Base;
  /** start and end of each step of the optimized tail */
  timeline: OptimizeStepTime[];
  /** epoch seconds everything is done: all goals reached and all kept steps finished (a colonization landed) */
  finishAt: number;
  /** epoch seconds the goals with a level (targets, the list's steps) are reached */
  targetsFinishAt: number;
  /** `finishAt` of the current list (its open steps as they are, plus what the targets need), null without one */
  currentFinishAt: number | null;
  /** the same with only the required steps, in the greedy order without economy (the plain order) */
  baselineFinishAt: number;
  /** the greedy plan before the search */
  greedyFinishAt: number;
  /** each goal: element, level, deadline, its end now and in the result */
  goals: OptimizeGoalResult[];
  iterations: number;
  evaluations: number;
}

export function optimize(input: OptimizeInput, run: OptimizeRun = {}): OptimizeResult {
  return withUnits(input.units, () => search(input, run));
}

/**
 * Checks the input the way `optimize` starts (planet, kept steps, targets and their requirements): throws
 * `OptimizeError` with the reason when it cannot run. Cheap (one simulation), for a request before the search starts.
 */
export function checkOptimizeInput(input: OptimizeInput): { required: number } {
  return withUnits(input.units, () => {
    const p = setupProblem(input);
    return { required: [...p.need.values()].reduce((a, b) => a + b, 0) + [...p.units.values()].reduce((a, b) => a + b.length, 0) };
  });
}

function search(input: OptimizeInput, run: OptimizeRun): OptimizeResult {
  const problem = setupProblem(input);
  const rng = createRng(run.seed ?? 12345);
  let iterations = 0;
  const fit = (items: Item[]): Fitness => evaluate(problem, items).fitness;

  const plain = greedyPlan(problem, 'plain');
  const plainFit = fit(plain);
  let best = plain;
  let bestFit = plainFit;
  let greedyFit = plainFit;
  if (problem.economy.length) {
    const greedy = greedyPlan(problem, run.greedy ?? 'rollout');
    greedyFit = fit(greedy);
    if (greedyFit.valid && greedyFit.value < bestFit.value) {
      best = greedy;
      bestFit = greedyFit;
    }
  }
  // the current list is a start too: with deadlines at its own ends it is hard to beat, and the result is never worse
  const current = currentPlan(problem);
  const currentFit = current ? fit(current) : null;
  if (current && currentFit?.valid && currentFit.value < bestFit.value) {
    best = current;
    bestFit = currentFit;
  }
  if (!bestFit.valid) {
    // the plain order is checked by the simulation the greedy steps stem from; invalid here means a kept or other step broke
    throw new Error('optimize: no valid plan found');
  }
  const baselineFinishAt = plainFit.finish;
  const greedyFinishAt = greedyFit.valid ? greedyFit.finish : plainFit.finish;
  const currentFinishAt = currentFit?.valid ? currentFit.finish : null;
  let lastBest = 0;
  const report = (force: boolean) => {
    if (!run.onBest) return;
    const t = Date.now();
    if (!force && t - lastBest < (run.bestEveryMs ?? 1000)) return;
    lastBest = t;
    run.onBest(resultOf(problem, best, { baselineFinishAt, greedyFinishAt, currentFinishAt, iterations, evaluations: problem.stats.evaluations }, run.newId));
  };
  run.onProgress?.({ phase: 'greedy', iteration: 0, evaluations: problem.stats.evaluations, finishAt: bestFit.finish });
  report(true);

  const total = run.iterations ?? Infinity;
  const budget = run.iterations != null ? Infinity : (run.budgetMs ?? 10_000);
  const phases: { phase: OptimizePhase; moves: Move[]; share: number }[] = [];
  const structural: Move[] = problem.economy.length ? [swapMove, moveMove, removeMove, insertEconomyMove] : [swapMove, moveMove, removeMove];
  const throttle = problem.throttle;
  phases.push({ phase: 'anneal', moves: structural, share: throttle ? 0.7 : 1 });
  if (throttle) {
    // pr0plan's weights: mostly production moves, a few structural ones to make room
    phases.push({ phase: 'throttle', moves: [insertThrottleMove, insertThrottleMove, adjustThrottleMove, adjustThrottleMove, adjustThrottleMove, removeMove, swapMove, moveMove], share: 0.3 });
  }
  // the budget counts from the start of the search (after the greedy plan), split between the phases
  const searchStart = Date.now();
  const evalStart = problem.stats.evaluations;
  let share = 0;
  for (const ph of phases) {
    share += ph.share;
    const evalCap = run.maxEvaluations != null ? evalStart + (run.maxEvaluations - evalStart) * share : Infinity;
    const res = anneal(problem, best, bestFit, ph.moves, rng, {
      iterations: total === Infinity ? Infinity : Math.round(total * ph.share),
      deadline: searchStart + budget * share,
      temperature: run.temperature ?? 7200,
      coolingRate: run.coolingRate ?? 0.999,
      reheatEvery: run.reheatEvery ?? 5000,
      shouldStop: () => problem.stats.evaluations >= evalCap || (run.shouldStop?.() ?? false),
      onImprovement: (f, items) => {
        best = items;
        bestFit = f;
        report(false);
      },
      onProgress: (i) => run.onProgress?.({ phase: ph.phase, iteration: iterations + i, evaluations: problem.stats.evaluations, finishAt: bestFit.finish }),
    });
    iterations += res.iterations;
    best = res.items;
    bestFit = res.fitness;
    report(true);
    if (run.shouldStop?.()) break;
  }
  return resultOf(problem, best, { baselineFinishAt, greedyFinishAt, currentFinishAt, iterations, evaluations: problem.stats.evaluations }, run.newId);
}

let idCount = 0;
const defaultId = () => `opt-${Date.now().toString(36)}-${(idCount++).toString(36)}`;

/** The proposal of a tail: dead steps dropped, ids given, the timeline, the goals' ends. */
function resultOf(
  problem: Problem, items: Item[], stats: Pick<OptimizeResult, 'baselineFinishAt' | 'greedyFinishAt' | 'currentFinishAt' | 'iterations' | 'evaluations'>,
  newId = defaultId,
): OptimizeResult {
  // the optimizer's steps after the last required or kept one change nothing
  const req = requiredIndices(problem, items);
  let last = req.length ? req[req.length - 1] : -1;
  items.forEach((it, i) => {
    if (it.kept) last = Math.max(last, i);
  });
  const tail = items.filter((it, i) => it.kept || i <= last);
  const ids = new Map<string, string>();
  const steps = tail.map((it) => {
    if (it.kept) return it.step;
    const id = newId();
    ids.set(it.step.id, id);
    return { ...it.step, id };
  });
  const sim = simulate(orderWith(problem, tail), problem.hub, { now: problem.input.now, units: problem.input.units, universe: problem.input.universe, lean: true });
  const fitness = evaluate(problem, tail).fitness;
  const byId = new Map(sim.steps.map((s) => [s.id, s]));
  // an existing step's goal names the step of the result that reaches it
  const reached = goalSteps(problem, tail);
  return {
    steps: [...problem.prefix, ...steps],
    base: problem.order.base,
    timeline: tail.map((it) => {
      const r = byId.get(it.step.id);
      return { id: ids.get(it.step.id) ?? it.step.id, start: r?.start ?? null, end: r?.end ?? null };
    }),
    finishAt: fitness.finish,
    targetsFinishAt: fitness.targetsFinish,
    goals: problem.goals.map((g, i) => ({
      element: g.element, level: g.level, by: g.by, weight: g.weight, source: g.source,
      step: g.source === 'target' ? null : g.level == null ? g.step : (ids.get(reached[i] ?? '') ?? reached[i] ?? null),
      currentEnd: g.current, end: fitness.ends[i],
    })),
    ...stats,
  };
}

/** The step of the tail whose cumulative level reaches each goal (kept goals: their step). */
function goalSteps(problem: Problem, items: Item[]): (string | null)[] {
  return goalAt<string>(problem, items, (id) => id, null);
}
