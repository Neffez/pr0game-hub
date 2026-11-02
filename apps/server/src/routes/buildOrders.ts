import { validateBuildOrder } from '@pr0hub/planner';
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

/**
 * The viewer's build order (imported from pr0plan, shown under build & research): read, import or replace, change
 * the steps (order, done, deactivated, removed), delete. The next step of each planet notifies once it can start.
 */
export function buildOrderRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const changed = (ctx: GroupContext) => events.publish(ctx.groupId, { type: 'data', tables: ['build_orders'], userId: ctx.user.id });
  const result = (ctx: GroupContext) => ({ buildOrder: buildOrderOf(db, ctx, ctx.user.id) });

  /** The build order; production and transport steps the synced pages show as done are checked off first. */
  app.get<{ Params: { uni: string } }>('/api/:uni/build-order', async (req) => {
    const ctx = ctxOf(req);
    const stored = buildOrderOf(db, ctx, ctx.user.id);
    if (!stored) return { buildOrder: null };
    return { buildOrder: syncBuildOrder(db, ctx, ctx.user.id, stored, buildingsState(db, ctx, ctx.user.id)) };
  });

  /** Imports a build order: replaces the viewer's one in this group. */
  app.put<{ Params: { uni: string }; Body: { order?: unknown; meta?: unknown } }>('/api/:uni/build-order', async (req) => {
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

  /** Replaces the steps (new order, done and deactivated flags, removed steps); base and meta stay. */
  app.patch<{ Params: { uni: string }; Body: { planets?: unknown } }>('/api/:uni/build-order', async (req) => {
    const ctx = ctxOf(req);
    const stored = buildOrderOf(db, ctx, ctx.user.id);
    if (!stored) throw new HttpError(404, 'build_order_not_found', 'No build order');
    const res = withUnits(catalogOf(ctx.universe), () => validateBuildOrder({ base: stored.order.base, planets: req.body?.planets }));
    if ('error' in res) throw new HttpError(400, 'build_order_invalid', res.error);
    db.prepare('UPDATE build_orders SET data = ?, updated_at = ? WHERE group_id = ? AND user_id = ?').run(JSON.stringify(res.order), now(), ctx.groupId, ctx.user.id);
    changed(ctx);
    return result(ctx);
  });

  app.delete<{ Params: { uni: string } }>('/api/:uni/build-order', async (req) => {
    const ctx = ctxOf(req);
    db.prepare('DELETE FROM build_orders WHERE group_id = ? AND user_id = ?').run(ctx.groupId, ctx.user.id);
    changed(ctx);
    return { buildOrder: null };
  });
}

