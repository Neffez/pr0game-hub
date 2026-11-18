// Auto plan search in a worker thread (POST /api/:uni/build-order/optimize): the job of @pr0hub/planner
// (`runOptimizeJob`, the same the web app runs in Web Workers), so a search of minutes never blocks the server. Reports
// progress and the best plan so far; the server terminates the worker to cancel it. Plain JavaScript next to src/ and
// dist/, so the same file runs under tsx, vitest and the built server.
import { randomUUID } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { runOptimizeJob } from '@pr0hub/planner';

const { input, units, budgetMs, seed } = workerData;
runOptimizeJob({ input, units, budgetMs, seed }, (m) => parentPort.postMessage(m), { newId: () => randomUUID() });
