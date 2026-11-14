import { assignPlanet, isPlannedKey, validateBuildOrder } from '@pr0hub/planner';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import { withUnits } from '@pr0hub/core/units';
import { catalogOf, type GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { buildOrderOf, syncBuildOrder } from '../repo/buildOrders.js';
import { buildingsState } from '../repo/buildings.js';
import { contextOf } from './util.js';

/** Meta data of an import (file settings, mapping) is kept as sent, up to this size. */
const META_MAX = 64 * 1024;
/** the build order is the member's own planning: it can be set up before the universe starts */
const beforeStart = { config: { allowBeforeStart: true } };

/**
 * The viewer's build order (imported from pr0plan or started by hand, shown under build & research): read, import or
 * replace, change the steps (order, done, deactivated, removed, added), delete. The next step of each planet notifies once it can start.
 */
export function buildOrderRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const changed = (ctx: GroupContext) => events.publish(ctx.groupId, { type: 'data', tables: ['build_orders'], userId: ctx.user.id });
  const result = (ctx: GroupContext) => ({ buildOrder: buildOrderOf(db, ctx, ctx.user.id) });

  /**
   * The build order; steps the synced pages show as done are shown checked off (a read: they are stored as done when
   * a page is pasted).
   */
  app.get<{ Params: { uni: string } }>('/api/:uni/build-order', async (req) => {
    const ctx = ctxOf(req);
    const stored = buildOrderOf(db, ctx, ctx.user.id);
    if (!stored) return { buildOrder: null };
    return { buildOrder: syncBuildOrder(db, ctx, ctx.user.id, stored, buildingsState(db, ctx, ctx.user.id), false) };
  });

  /** Imports a build order (or starts one by hand): replaces the viewer's one in this group. */
  app.put<{ Params: { uni: string }; Body: { order?: unknown; meta?: unknown } }>('/api/:uni/build-order', beforeStart, async (req) => {
    const ctx = ctxOf(req);
    const res = withUnits(catalogOf(ctx.universe), () => validateBuildOrder(req.body?.order));
    if ('error' in res) throw new HttpError(400, 'build_order_invalid', res.error);
    const meta = req.body?.meta ?? {};
    const metaJson = JSON.stringify(meta);
    if (typeof meta !== 'object' || Array.isArray(meta) || metaJson.length > META_MAX) throw new HttpError(400, 'build_order_invalid', 'Invalid meta');
    const t = now();
    db.prepare(
      `INSERT INTO build_orders (group_id, user_id, data, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (group_id, user_id) DO UPDATE SET data = excluded.data, meta = excluded.meta, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    ).run(ctx.groupId, ctx.user.id, JSON.stringify(res.order), metaJson, t, t);
    changed(ctx);
    return result(ctx);
  });

  /**
   * Replaces the steps (new order, done and deactivated flags, removed or added steps); the base only when sent (start
   * levels of elements added by hand), meta stays.
   */
  app.patch<{ Params: { uni: string }; Body: { planets?: unknown; base?: unknown } }>('/api/:uni/build-order', beforeStart, async (req) => {
    const ctx = ctxOf(req);
    const stored = buildOrderOf(db, ctx, ctx.user.id);
    if (!stored) throw new HttpError(404, 'build_order_not_found', 'No build order');
    const base = req.body?.base ?? stored.order.base;
    const res = withUnits(catalogOf(ctx.universe), () => validateBuildOrder({ base, planets: req.body?.planets }));
    if ('error' in res) throw new HttpError(400, 'build_order_invalid', res.error);
    db.prepare('UPDATE build_orders SET data = ?, updated_at = ? WHERE group_id = ? AND user_id = ?').run(JSON.stringify(res.order), now(), ctx.groupId, ctx.user.id);
    changed(ctx);
    return result(ctx);
  });

  /**
   * Assigns a planned planet (key `0:0:<n>:planet`, imported before its coordinates were known) to a planet: its
   * steps, base and the transports to it move there.
   */
  app.post<{ Params: { uni: string }; Body: { from?: unknown; to?: unknown } }>('/api/:uni/build-order/assign', beforeStart, async (req) => {
    const ctx = ctxOf(req);
    const { from, to } = req.body ?? {};
    if (typeof from !== 'string' || typeof to !== 'string' || !isPlannedKey(from)) throw new HttpError(400, 'build_order_invalid', 'Expected a planned planet and a target');
    const stored = buildOrderOf(db, ctx, ctx.user.id);
    if (!stored) throw new HttpError(404, 'build_order_not_found', 'No build order');
    const order = assignPlanet(stored.order, from, to);
    if (!order) throw new HttpError(409, 'build_order_planet_taken', 'The planet is not in the build order or the target already has steps');
    const res = withUnits(catalogOf(ctx.universe), () => validateBuildOrder(order));
    if ('error' in res) throw new HttpError(400, 'build_order_invalid', res.error);
    const meta = stored.meta as { mapping?: Record<string, string | null> };
    if (meta.mapping) meta.mapping = Object.fromEntries(Object.entries(meta.mapping).map(([id, k]) => [id, k === from ? to : k]));
    db.prepare('UPDATE build_orders SET data = ?, meta = ?, updated_at = ? WHERE group_id = ? AND user_id = ?').run(
      JSON.stringify(res.order), JSON.stringify(meta), now(), ctx.groupId, ctx.user.id,
    );
    changed(ctx);
    return result(ctx);
  });

  app.delete<{ Params: { uni: string } }>('/api/:uni/build-order', beforeStart, async (req) => {
    const ctx = ctxOf(req);
    db.prepare('DELETE FROM build_orders WHERE group_id = ? AND user_id = ?').run(ctx.groupId, ctx.user.id);
    changed(ctx);
    return { buildOrder: null };
  });
}

