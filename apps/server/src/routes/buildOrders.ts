import { assignPlanet, isPlannedKey, validateBuildOrder } from '@pr0hub/planner';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../auth.js';
import { withUnits } from '@pr0hub/core/units';
import { catalogOf, type GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { buildOrderOf, buildOrderTimeline, syncBuildOrder, type StoredBuildOrder } from '../repo/buildOrders.js';
import { buildingsState } from '../repo/buildings.js';
import { addCredits, dayOf, MINER_AHEAD } from '../repo/achievements.js';
import { contextOf } from './util.js';

/** Meta data of an import (file settings, mapping) is kept as sent, up to this size. */
const META_MAX = 64 * 1024;
/**
 * the build order is the member's own planning: it can be set up before the universe starts, and API tokens may write
 * it (scripts and assistants that plan for the member)
 */
const beforeStart = { config: { allowBeforeStart: true, tokenWrite: true } };

/** The revisions of an `If-Match` / `If-None-Match` header (`"5"`, `5`, `W/"5"`, lists), `*` as `'*'`. */
function revisionsOf(header: string): (number | '*')[] {
  return header.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (t === '*' ? '*' : Number(t.replace(/^W\//, '').replace(/^"(.*)"$/, '$1'))));
}

/**
 * Optimistic concurrency of the writes: `If-Match` names the revision the change is based on (`*`: any existing build
 * order), `If-None-Match: *` asks for none to exist (a `PUT` that starts one). A mismatch is a 412 with the current
 * build order so the client can merge and retry. Without a header a session request writes as before; a token must
 * send one (scripts and assistants are the clients that write from stale copies).
 */
function checkPrecondition(req: FastifyRequest, stored: StoredBuildOrder | null, conflict: () => HttpError): void {
  const match = req.headers['if-match'];
  const noneMatch = req.headers['if-none-match'];
  if (match === undefined && noneMatch === undefined) {
    if (req.authSource === 'token') {
      throw new HttpError(
        428, 'build_order_revision_required',
        'Send the revision your change is based on as If-Match (the ETag of GET /build-order), or If-None-Match: * to start one',
      );
    }
    return;
  }
  if (typeof noneMatch === 'string') {
    const tags = revisionsOf(noneMatch);
    if (stored && (tags.includes('*') || tags.includes(stored.revision))) throw conflict();
  }
  if (typeof match === 'string') {
    const tags = revisionsOf(match);
    if (!stored || !(tags.includes('*') || tags.includes(stored.revision))) throw conflict();
  }
}

/**
 * The viewer's build order (imported from pr0plan or started by hand, shown under build & research): read, import or
 * replace, change the steps (order, done, deactivated, removed, added), delete. The next step of each planet notifies once it can start.
 * The timeline (when each step starts and ends by the hub's state) can be read to check a plan.
 */
export function buildOrderRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  /** The miner badge: a build order whose timeline reaches at least `MINER_AHEAD` into the future (once per member). */
  const creditMiner = (ctx: GroupContext, ends?: (number | null)[]) => {
    try {
      if (db.prepare("SELECT 1 FROM sync_credits WHERE group_id = ? AND user_id = ? AND kind = 'miner'").get(ctx.groupId, ctx.user.id)) return;
      const t = now();
      if (!ends) {
        const found = buildOrderOf(db, ctx, ctx.user.id);
        if (!found) return;
        const state = buildingsState(db, ctx, ctx.user.id);
        ends = buildOrderTimeline(syncBuildOrder(db, ctx, ctx.user.id, found, state, false).order, state, t, ctx.universe.settings).steps.map((x) => x.end);
      }
      if (Math.max(0, ...ends.map((e) => e ?? 0)) >= t + MINER_AHEAD) addCredits(db, ctx.groupId, ctx.user.id, dayOf(t, ctx.universe.settings.timezone), [{ kind: 'miner' }]);
    } catch {
      /* a badge only */
    }
  };
  const changed = (ctx: GroupContext) => {
    events.publish(ctx.groupId, { type: 'data', tables: ['build_orders'], userId: ctx.user.id });
    creditMiner(ctx);
  };
  /** The build order as the GET shows it (steps the synced pages show as done checked off), with its ETag. */
  const current = (ctx: GroupContext, reply?: FastifyReply) => {
    const stored = buildOrderOf(db, ctx, ctx.user.id);
    if (!stored) return { buildOrder: null };
    reply?.header('etag', `"${stored.revision}"`);
    return { buildOrder: syncBuildOrder(db, ctx, ctx.user.id, stored, buildingsState(db, ctx, ctx.user.id), false) };
  };
  /** The answer of a write: the stored build order with its new revision, also as ETag. */
  const result = (ctx: GroupContext, reply: FastifyReply) => {
    const buildOrder = buildOrderOf(db, ctx, ctx.user.id);
    if (buildOrder) reply.header('etag', `"${buildOrder.revision}"`);
    return { buildOrder };
  };
  const conflict = (ctx: GroupContext) => () =>
    new HttpError(412, 'build_order_conflict', 'The build order was changed since the revision you sent: merge your change onto the returned one and retry', current(ctx));
  /**
   * The stored build order a change starts from, its precondition checked early (the 412 comes before validation
   * errors); a revision sent for one that is gone is a conflict too (the 412 shows it deleted).
   */
  const existing = (req: FastifyRequest, ctx: GroupContext): StoredBuildOrder => {
    const stored = buildOrderOf(db, ctx, ctx.user.id);
    if (stored || req.headers['if-match'] !== undefined) checkPrecondition(req, stored, conflict(ctx));
    if (!stored) throw new HttpError(404, 'build_order_not_found', 'No build order');
    return stored;
  };
  /**
   * Checks the precondition against the stored build order and runs the write in one transaction; `write` returns the
   * number of changed rows of its conditional statement (`WHERE revision = ?`), 0 is a conflict as well.
   */
  const guarded = (req: FastifyRequest, ctx: GroupContext, write: (stored: StoredBuildOrder | null) => number) =>
    db.transaction(() => {
      const stored = buildOrderOf(db, ctx, ctx.user.id);
      checkPrecondition(req, stored, conflict(ctx));
      if (write(stored) === 0) throw conflict(ctx)();
    })();

  /**
   * The build order; steps the synced pages show as done are shown checked off (a read: they are stored as done when
   * a page is pasted).
   */
  app.get<{ Params: { uni: string } }>('/api/:uni/build-order', async (req, reply) => current(ctxOf(req), reply));

  /**
   * The timeline of the build order from the hub's state now: per step its state, start and end, cost and what it
   * waits for; planned planets are simulated as new planets.
   */
  app.get<{ Params: { uni: string } }>('/api/:uni/build-order/timeline', async (req) => {
    const ctx = ctxOf(req);
    const t = now();
    const found = buildOrderOf(db, ctx, ctx.user.id);
    if (!found) throw new HttpError(404, 'build_order_not_found', 'No build order');
    const state = buildingsState(db, ctx, ctx.user.id);
    const stored = syncBuildOrder(db, ctx, ctx.user.id, found, state, false);
    const timeline = buildOrderTimeline(stored.order, state, t, ctx.universe.settings);
    creditMiner(ctx, timeline.steps.map((x) => x.end));
    return { now: t, ...timeline };
  });

  /** Imports a build order (or starts one by hand): replaces the viewer's one in this group. */
  app.put<{ Params: { uni: string }; Body: { order?: unknown; meta?: unknown } }>('/api/:uni/build-order', beforeStart, async (req, reply) => {
    const ctx = ctxOf(req);
    const res = withUnits(catalogOf(ctx.universe), () => validateBuildOrder(req.body?.order));
    if ('error' in res) throw new HttpError(400, 'build_order_invalid', res.error);
    const meta = req.body?.meta ?? {};
    const metaJson = JSON.stringify(meta);
    if (typeof meta !== 'object' || Array.isArray(meta) || metaJson.length > META_MAX) throw new HttpError(400, 'build_order_invalid', 'Invalid meta');
    const t = now();
    const data = JSON.stringify(res.order);
    // a new build order starts at revision 1, a replaced one counts on (a copy of the old one stays stale)
    guarded(req, ctx, (stored) =>
      stored
        ? db.prepare('UPDATE build_orders SET data = ?, meta = ?, created_at = ?, updated_at = ?, revision = revision + 1 WHERE group_id = ? AND user_id = ? AND revision = ?')
          .run(data, metaJson, t, t, ctx.groupId, ctx.user.id, stored.revision).changes
        : db.prepare('INSERT INTO build_orders (group_id, user_id, data, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (group_id, user_id) DO NOTHING')
          .run(ctx.groupId, ctx.user.id, data, metaJson, t, t).changes,
    );
    changed(ctx);
    return result(ctx, reply);
  });

  /**
   * Replaces the steps (new order, done and deactivated flags, removed or added steps); the base only when sent (start
   * levels of elements added by hand), so the details of the planned planets (those of removed planets are dropped);
   * meta stays.
   */
  app.patch<{ Params: { uni: string }; Body: { planets?: unknown; base?: unknown; planned?: unknown } }>('/api/:uni/build-order', beforeStart, async (req, reply) => {
    const ctx = ctxOf(req);
    const stored = existing(req, ctx);
    const base = req.body?.base ?? stored.order.base;
    const lists = req.body?.planets;
    const kept = Object.entries(stored.order.planned ?? {}).filter(([k]) => typeof lists === 'object' && lists !== null && k in lists);
    const planned = req.body?.planned ?? Object.fromEntries(kept);
    const res = withUnits(catalogOf(ctx.universe), () => validateBuildOrder({ base, planets: lists, planned }));
    if ('error' in res) throw new HttpError(400, 'build_order_invalid', res.error);
    guarded(req, ctx, () =>
      db.prepare('UPDATE build_orders SET data = ?, updated_at = ?, revision = revision + 1 WHERE group_id = ? AND user_id = ? AND revision = ?')
        .run(JSON.stringify(res.order), now(), ctx.groupId, ctx.user.id, stored.revision).changes,
    );
    changed(ctx);
    return result(ctx, reply);
  });

  /**
   * Assigns a planned planet (key `0:0:<n>:planet`, imported before its coordinates were known) to a planet: its
   * steps, base and the transports to it move there.
   */
  app.post<{ Params: { uni: string }; Body: { from?: unknown; to?: unknown } }>('/api/:uni/build-order/assign', beforeStart, async (req, reply) => {
    const ctx = ctxOf(req);
    const { from, to } = req.body ?? {};
    if (typeof from !== 'string' || typeof to !== 'string' || !isPlannedKey(from)) throw new HttpError(400, 'build_order_invalid', 'Expected a planned planet and a target');
    const stored = existing(req, ctx);
    // the target is one of the viewer's synced planets (not a moon, not another planned planet)
    const own = buildingsState(db, ctx, ctx.user.id).planets.some((p) => p.type === 'planet' && `${p.coords.g}:${p.coords.s}:${p.coords.p}:planet` === to);
    if (!own) throw new HttpError(400, 'build_order_target_invalid', 'The target is not one of your synced planets');
    const order = assignPlanet(stored.order, from, to);
    if (!order) throw new HttpError(409, 'build_order_planet_taken', 'The planet is not in the build order or the target already has steps');
    const res = withUnits(catalogOf(ctx.universe), () => validateBuildOrder(order));
    if ('error' in res) throw new HttpError(400, 'build_order_invalid', res.error);
    const meta = stored.meta as { mapping?: Record<string, string | null> };
    if (meta.mapping) meta.mapping = Object.fromEntries(Object.entries(meta.mapping).map(([id, k]) => [id, k === from ? to : k]));
    guarded(req, ctx, () =>
      db.prepare('UPDATE build_orders SET data = ?, meta = ?, updated_at = ?, revision = revision + 1 WHERE group_id = ? AND user_id = ? AND revision = ?')
        .run(JSON.stringify(res.order), JSON.stringify(meta), now(), ctx.groupId, ctx.user.id, stored.revision).changes,
    );
    changed(ctx);
    return result(ctx, reply);
  });

  app.delete<{ Params: { uni: string } }>('/api/:uni/build-order', beforeStart, async (req) => {
    const ctx = ctxOf(req);
    let deleted = false;
    guarded(req, ctx, (stored) => {
      if (!stored) return 1; // nothing to delete (only reached without a precondition): fine as before
      deleted = db.prepare('DELETE FROM build_orders WHERE group_id = ? AND user_id = ? AND revision = ?').run(ctx.groupId, ctx.user.id, stored.revision).changes > 0;
      return Number(deleted);
    });
    if (deleted) changed(ctx);
    return { buildOrder: null };
  });
}

