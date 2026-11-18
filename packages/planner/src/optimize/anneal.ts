import { evaluate, requiredIndices, type Fitness } from './evaluate.js';
import { stepOf } from './greedy.js';
import { MINES, type Item, type Problem } from './problem.js';
import { pick } from './rng.js';

/**
 * Simulated annealing over the tail (pr0plan `planner/localSearch.js`): the required steps stay a fixed multiset,
 * their order and the extra economy and production steps change. The fitness is the real simulation (`evaluate`);
 * an invalid tail is never accepted, whatever the temperature. The best tail so far is kept apart from the walk, so
 * the result is never worse than the start. Kept steps are never moved: the optimizer's steps move around them, so
 * the kept ones keep their order.
 */

export type Move = (items: Item[], problem: Problem, rng: () => number) => Item[] | null;

const movable = (items: Item[]) => items.reduce<number[]>((out, it, i) => (it.kept ? out : (out.push(i), out)), []);

/** two of the optimizer's steps trade places */
export const swapMove: Move = (items, _p, rng) => {
  const idx = movable(items);
  if (idx.length < 2) return null;
  const a = pick(rng, idx.length);
  let b = pick(rng, idx.length - 1);
  if (b >= a) b++;
  const out = [...items];
  [out[idx[a]], out[idx[b]]] = [out[idx[b]], out[idx[a]]];
  return out;
};

/** one of the optimizer's steps moves to another place */
export const moveMove: Move = (items, _p, rng) => {
  const idx = movable(items);
  if (!idx.length || items.length < 2) return null;
  const from = idx[pick(rng, idx.length)];
  let to = pick(rng, items.length);
  if (to === from) to = (to + 1) % items.length;
  const out = [...items];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
};

/** Steps the optimizer may drop: extra economy levels beyond the required ones and its production steps. */
function removable(items: Item[], problem: Problem): number[] {
  const required = new Set(requiredIndices(problem, items));
  return items.reduce<number[]>((out, it, i) => (!it.kept && !required.has(i) ? (out.push(i), out) : out), []);
}

/** drop an extra step (an economy level or a production step) */
export const removeMove: Move = (items, problem, rng) => {
  const idx = removable(items, problem);
  if (!idx.length) return null;
  const out = [...items];
  out.splice(idx[pick(rng, idx.length)], 1);
  return out;
};

/** insert a level of an economy building somewhere */
export const insertEconomyMove: Move = (items, problem, rng) => {
  if (!problem.economy.length) return null;
  const element = problem.economy[pick(rng, problem.economy.length)];
  const out = [...items];
  out.splice(pick(rng, items.length + 1), 0, { step: stepOf(problem, element), kept: false });
  return out;
};

/** the game's production settings: 0 … 100 % in steps of 10 (pr0plan tried 25 % steps) */
const LEVELS = Array.from({ length: 11 }, (_, i) => i / 10);

/** insert a production step with random factors of the mines (10 % steps) */
export const insertThrottleMove: Move = (items, problem, rng) => {
  const factors: Record<string, number> = {};
  for (const id of MINES) factors[id] = LEVELS[pick(rng, LEVELS.length)];
  const out = [...items];
  out.splice(pick(rng, items.length + 1), 0, {
    step: { id: problem.newId(), kind: 'prod', prod: { factors, awaitBuilding: true, awaitResearch: false, awaitShipyard: false, wait: 0 } },
    kept: false,
  });
  return out;
};

/** change one factor of one of the optimizer's production steps: half the time by 10 %, else to any level */
export const adjustThrottleMove: Move = (items, _p, rng) => {
  const idx = items.reduce<number[]>((out, it, i) => (!it.kept && it.step.kind === 'prod' ? (out.push(i), out) : out), []);
  if (!idx.length) return null;
  const i = idx[pick(rng, idx.length)];
  const s = items[i].step;
  const mine = MINES[pick(rng, MINES.length)];
  const now = Math.round((s.prod!.factors[mine] ?? 1) * 10);
  const level = rng() < 0.5 ? Math.min(10, Math.max(0, now + (rng() < 0.5 ? -1 : 1))) : pick(rng, LEVELS.length);
  if (level === now) return null;
  const out = [...items];
  out[i] = { ...items[i], step: { ...s, prod: { ...s.prod!, factors: { ...s.prod!.factors, [mine]: LEVELS[level] } } } };
  return out;
};

/** two production steps with nothing between them: only the second counts, so the first is a useless variant */
export const adjacentProd = (items: Item[]) => items.some((it, i) => i > 0 && it.step.kind === 'prod' && items[i - 1].step.kind === 'prod');

export interface AnnealOptions {
  /** stop after this many iterations */
  iterations: number;
  /** or at this time (Date.now()) */
  deadline: number;
  /** temperature at the start and after each reheat (seconds) */
  temperature: number;
  coolingRate: number;
  reheatEvery: number;
  /** checked every few iterations: true stops the search */
  shouldStop?: () => boolean;
  onImprovement?: (best: Fitness, items: Item[], iteration: number) => void;
  onProgress?: (iteration: number) => void;
}

export interface AnnealResult {
  items: Item[];
  fitness: Fitness;
  iterations: number;
  evaluations: number;
}

export function anneal(problem: Problem, start: Item[], startFitness: Fitness, moves: Move[], rng: () => number, o: AnnealOptions): AnnealResult {
  let current = start;
  let currentFit = startFitness;
  let best = start;
  let bestFit = startFitness;
  let temperature = o.temperature;
  let evaluations = 0;
  let i = 0;
  for (; i < o.iterations; i++) {
    if ((i & 15) === 0 && (Date.now() >= o.deadline || o.shouldStop?.())) break;
    const move = moves[pick(rng, moves.length)];
    const next = move(current, problem, rng);
    if (next && !adjacentProd(next)) {
      evaluations++;
      const fit = evaluate(problem, next)?.fitness;
      if (fit?.valid) {
        const delta = fit.value - currentFit.value;
        if (delta < 0 || rng() < Math.exp(-delta / temperature)) {
          current = next;
          currentFit = fit;
          if (fit.value < bestFit.value) {
            best = next;
            bestFit = fit;
            o.onImprovement?.(bestFit, best, i);
          }
        }
      }
    }
    temperature *= o.coolingRate;
    // reheating: the temperature is near zero after a few thousand iterations and the walk freezes; restart from the
    // best with the temperature up again
    if ((i + 1) % o.reheatEvery === 0) {
      current = best;
      currentFit = bestFit;
      temperature = o.temperature;
    }
    if (i % 50 === 0) o.onProgress?.(i);
  }
  return { items: best, fitness: bestFit, iterations: i, evaluations };
}
