// Auto plan search in a worker thread (POST /api/:uni/build-order/optimize): greedy plan and simulated annealing of
// @pr0hub/planner, so a search of minutes never blocks the server. Reports progress and the best plan so far; the
// server terminates the worker to cancel it. Plain JavaScript next to src/ and dist/, so the same file runs under
// tsx, vitest and the built server.
import { randomUUID } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { optimize, OptimizeError } from '@pr0hub/planner';
import { unitCatalog } from '@pr0hub/core/units';

const { input, units, budgetMs, seed } = workerData;
let lastProgress = 0;
try {
  const best = optimize(
    { ...input, units: unitCatalog(units) },
    {
      budgetMs,
      seed,
      newId: () => randomUUID(),
      bestEveryMs: 1000,
      onProgress: (p) => {
        const t = Date.now();
        if (t - lastProgress < 250) return;
        lastProgress = t;
        parentPort.postMessage({ type: 'progress', ...p });
      },
      onBest: (result) => parentPort.postMessage({ type: 'best', best: result }),
    },
  );
  parentPort.postMessage({ type: 'done', best });
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err), invalid: err instanceof OptimizeError });
}
