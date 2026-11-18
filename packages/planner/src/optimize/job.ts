import { unitCatalog, type UnitOverrides } from '@pr0hub/core/units';
import { optimize, type OptimizePhase, type OptimizeResult } from './index.js';
import type { OptimizeInput } from './problem.js';
import { OptimizeError } from './targets.js';

/**
 * One auto plan search as a job of a worker (a Web Worker in the browser, a worker thread on the server): plain data
 * in, messages out. The unit catalog is rebuilt from the universe's overrides, since a catalog does not survive the
 * structured clone of `postMessage`. To cancel, the caller terminates the worker; the best plan so far came as `best`.
 */

/** What a worker gets: the search's input without the catalog, the universe's unit overrides and the run's settings. */
export interface OptimizeJobRequest {
  input: Omit<OptimizeInput, 'units'>;
  units?: UnitOverrides | null;
  budgetMs?: number;
  iterations?: number;
  seed?: number;
}

export type OptimizeJobMessage =
  | { type: 'progress'; phase: OptimizePhase; iteration: number; evaluations: number; finishAt: number }
  | { type: 'best'; best: OptimizeResult }
  | { type: 'done'; best: OptimizeResult }
  | { type: 'error'; message: string; invalid: boolean };

/** Ids of the steps in a result: UUIDs where the platform has them (the build order's own ids are UUIDs too). */
export function stepId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Runs the search of `req` and reports through `post`: `progress` at most every `progressEveryMs` (default 250), `best`
 * when a better plan was found (at most every second), then `done` with the result, or `error` (`invalid`: the input
 * cannot be planned, the message says why).
 */
export function runOptimizeJob(req: OptimizeJobRequest, post: (m: OptimizeJobMessage) => void, opts: { newId?: () => string; progressEveryMs?: number } = {}): void {
  let lastProgress = 0;
  const every = opts.progressEveryMs ?? 250;
  try {
    const best = optimize(
      { ...req.input, units: unitCatalog(req.units) },
      {
        budgetMs: req.budgetMs,
        iterations: req.iterations,
        seed: req.seed,
        newId: opts.newId ?? stepId,
        bestEveryMs: 1000,
        onProgress: (p) => {
          const t = Date.now();
          if (t - lastProgress < every) return;
          lastProgress = t;
          post({ type: 'progress', ...p });
        },
        onBest: (best) => post({ type: 'best', best }),
      },
    );
    post({ type: 'done', best });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), invalid: err instanceof OptimizeError });
  }
}
