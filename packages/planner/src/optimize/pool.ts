import type { OptimizePhase, OptimizeResult } from './index.js';
import type { OptimizeJobMessage, OptimizeJobRequest } from './job.js';
import { OptimizeError } from './targets.js';

/**
 * Several searches of one auto plan at once, each in a worker of its own with another seed; the best plan of all wins
 * (by the objective). For the browser (Web Workers) and anything with the same shape: the caller creates the workers,
 * each runs `runOptimizeJob` on the request it is sent. Annealing from other seeds finds other local optima, so N
 * workers for the same time find a better plan than one.
 */

/** The part of a Web Worker the pool uses. */
export interface WorkerLike {
  postMessage(message: OptimizeJobRequest): void;
  terminate(): void;
  onmessage: ((e: { data: OptimizeJobMessage }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}

export interface OptimizePoolProgress {
  /** phase of the furthest worker */
  phase: OptimizePhase;
  /** iterations and simulations of all workers together */
  iterations: number;
  evaluations: number;
  /** workers still searching */
  running: number;
  workers: number;
  /** the best plan so far (null until the first worker has one) */
  best: OptimizeResult | null;
}

export interface OptimizePoolOptions {
  request: OptimizeJobRequest;
  createWorker: () => WorkerLike;
  /** number of workers (default 1) */
  workers?: number;
  onProgress?: (p: OptimizePoolProgress) => void;
  /** a worker that does not end this long after the budget is stopped (default 30 s) */
  graceMs?: number;
}

export interface OptimizePool {
  /** stops every worker; `done` resolves with the best plan so far */
  stop(): void;
  /** the best plan (null: stopped before any), rejects with `OptimizeError` when the input cannot be planned */
  done: Promise<OptimizeResult | null>;
}

const PHASES: OptimizePhase[] = ['greedy', 'anneal', 'throttle'];

/** Seed of worker `i`: the request's (or a random) seed, spread so the workers search differently. */
export const workerSeed = (base: number, i: number) => (base + i * 0x9e3779b1) >>> 0;

/** The better of two results (by the objective, then the finish). */
export function betterResult(a: OptimizeResult | null, b: OptimizeResult | null): OptimizeResult | null {
  if (!a) return b;
  if (!b) return a;
  if (b.objective !== a.objective) return b.objective < a.objective ? b : a;
  return b.finishAt < a.finishAt ? b : a;
}

export function startOptimizePool(opts: OptimizePoolOptions): OptimizePool {
  const n = Math.max(1, Math.floor(opts.workers ?? 1));
  const base = opts.request.seed ?? Math.floor(Math.random() * 2 ** 32);
  const state = Array.from({ length: n }, () => ({ phase: 'greedy' as OptimizePhase, iteration: 0, evaluations: 0, running: true, error: null as string | null }));
  const workers: WorkerLike[] = [];
  let best: OptimizeResult | null = null;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolve!: (r: OptimizeResult | null) => void;
  let reject!: (e: Error) => void;
  const done = new Promise<OptimizeResult | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const progress = () => {
    if (finished) return;
    opts.onProgress?.({
      phase: state.reduce<OptimizePhase>((p, s) => (PHASES.indexOf(s.phase) > PHASES.indexOf(p) ? s.phase : p), 'greedy'),
      iterations: state.reduce((a, s) => a + s.iteration, 0),
      evaluations: state.reduce((a, s) => a + s.evaluations, 0),
      running: state.filter((s) => s.running).length,
      workers: n,
      best,
    });
  };
  const finish = (error?: Error) => {
    if (finished) return;
    for (const w of workers) w.terminate();
    for (const s of state) s.running = false;
    if (timer) clearTimeout(timer);
    progress();
    finished = true;
    if (error) reject(error);
    else resolve(best);
  };
  const ended = (i: number) => {
    state[i].running = false;
    if (state.some((s) => s.running)) return progress();
    // all ended: an error only when none found a plan
    if (best) return finish();
    const failed = state.find((s) => s.error);
    finish(new OptimizeError(failed?.error ?? 'no plan found'));
  };

  for (let i = 0; i < n; i++) {
    const w = opts.createWorker();
    workers.push(w);
    w.onmessage = ({ data: m }) => {
      if (finished || !state[i].running) return;
      const s = state[i];
      if (m.type === 'progress') {
        s.phase = m.phase;
        s.iteration = m.iteration;
        s.evaluations = m.evaluations;
        progress();
      } else if (m.type === 'best' || m.type === 'done') {
        best = betterResult(best, m.best);
        s.iteration = Math.max(s.iteration, m.best.iterations);
        s.evaluations = Math.max(s.evaluations, m.best.evaluations);
        if (m.type === 'done') ended(i);
        else progress();
      } else if (m.type === 'error') {
        // the input cannot be planned: the others would say the same
        if (m.invalid) return finish(new OptimizeError(m.message));
        s.error = m.message;
        ended(i);
      }
    };
    w.onerror = (e) => {
      if (finished || !state[i].running) return;
      state[i].error = e.message || 'worker failed';
      ended(i);
    };
    w.postMessage({ ...opts.request, seed: workerSeed(base, i) });
  }
  if (opts.request.budgetMs != null) timer = setTimeout(() => finish(), opts.request.budgetMs + (opts.graceMs ?? 30_000));
  progress();
  return { stop: () => finish(), done };
}
