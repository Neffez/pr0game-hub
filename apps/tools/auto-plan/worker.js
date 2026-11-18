/* Auto plan worker: one search of the request it is sent (runOptimizeJob of @pr0hub/planner), posting progress, better
   plans and the result. The page runs several with other seeds and terminates them to cancel. */
import { runOptimizeJob } from '@pr0hub/planner';

self.onmessage = function (e) {
  runOptimizeJob(e.data, function (m) { self.postMessage(m); });
};
