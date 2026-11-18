import { runOptimizeJob, type OptimizeJobMessage, type OptimizeJobRequest } from '@pr0hub/planner';

/**
 * Auto plan search in the browser (one of several workers of `startOptimizePool`): runs one search of the request it
 * is sent and posts progress, better plans and the result. The page terminates the worker to cancel it.
 */
const scope = self as unknown as { onmessage: ((e: MessageEvent<OptimizeJobRequest>) => void) | null; postMessage(m: OptimizeJobMessage): void };
scope.onmessage = (e) => runOptimizeJob(e.data, (m) => scope.postMessage(m));
