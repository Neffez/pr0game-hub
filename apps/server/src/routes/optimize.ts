import { baseFromHub, checkOptimizeInput, OptimizeError, type BuildOrder, type HubState } from '@pr0hub/planner';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import { catalogOf } from '../context.js';
import { now, type DB } from '../db.js';
import { jobView, OptimizeJobs, parseOptimizeRequest } from '../optimize.js';
import { buildOrderOf, syncBuildOrder, timelineHub } from '../repo/buildOrders.js';
import { buildingsState } from '../repo/buildings.js';
import { contextOf } from './util.js';

/**
 * Auto plan for scripts and assistants: searches the build order that reaches target levels of one planet fastest
 * (greedy plan, then simulated annealing against the timeline's simulation) in a worker thread, as a job to poll. It
 * returns a proposal and writes nothing, so read-only API tokens may start, read and cancel jobs (`allowToken`).
 */
export function optimizeRoutes(app: FastifyInstance, db: DB, jobs = new OptimizeJobs()) {
  const ctxOf = contextOf(db);
  const free = { config: { allowToken: true } };
  app.addHook('onClose', async () => jobs.close());

  app.post<{ Params: { uni: string } }>('/api/:uni/build-order/optimize', free, async (req, reply) => {
    const ctx = ctxOf(req);
    const body = parseOptimizeRequest(req.body);
    const t = now();
    const state = buildingsState(db, ctx, ctx.user.id);
    const found = buildOrderOf(db, ctx, ctx.user.id);
    const stored = found ? syncBuildOrder(db, ctx, ctx.user.id, found, state, false) : null;
    let order: BuildOrder = stored?.order ?? { base: baseFromHub(state, []), planets: {} };
    // a synced planet without a list yet starts with an empty one
    const synced = state.planets.some((p) => p.key === body.planet);
    if (!order.planets[body.planet]) {
      if (!synced) throw new HttpError(404, 'optimize_planet_not_found', 'The planet is neither one of your synced planets nor a planet of your build order');
      const base = baseFromHub(state, [body.planet]);
      order = { ...order, base: { ...order.base, planets: { ...order.base.planets, ...base.planets } }, planets: { ...order.planets, [body.planet]: [] } };
    }
    const universe = ctx.universe.settings;
    // the worker gets plain data: the unit catalog of the state is rebuilt there from the universe's overrides
    const { units: _catalog, ...hub } = timelineHub(order, state, t, universe) as HubState & { units?: unknown };
    const input = { order, hub, planet: body.planet, targets: body.targets, keep: body.keep, now: t, universe, options: body.options };
    try {
      checkOptimizeInput({ ...input, units: catalogOf(ctx.universe) });
    } catch (err) {
      if (err instanceof OptimizeError) throw new HttpError(400, 'optimize_invalid', err.message);
      throw err;
    }
    const job = jobs.start({ groupId: ctx.groupId, userId: ctx.user.id }, body, input, ctx.universe.units, stored?.revision ?? null);
    reply.code(202);
    return { job: job.id, status: job.status };
  });

  app.get<{ Params: { uni: string; job: string } }>('/api/:uni/build-order/optimize/:job', free, async (req) => {
    const ctx = ctxOf(req);
    return jobView(jobs.get({ groupId: ctx.groupId, userId: ctx.user.id }, req.params.job));
  });

  app.delete<{ Params: { uni: string; job: string } }>('/api/:uni/build-order/optimize/:job', free, async (req) => {
    const ctx = ctxOf(req);
    return jobView(jobs.cancel({ groupId: ctx.groupId, userId: ctx.user.id }, req.params.job));
  });
}
