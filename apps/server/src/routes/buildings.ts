import { BUILDINGS, RESEARCH } from '@pr0hub/core/buildings';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { storageMuted } from '../notify.js';
import { alertsOf, buildingsState, planetElements, planetOf, pruneAlerts } from '../repo/buildings.js';
import { contextOf } from './util.js';

interface AlertBody {
  g?: number;
  s?: number;
  p?: number;
  type?: string;
  id?: number;
  level?: number;
}

/** Buildings the user hid on the buildings page (all planets and universes). */
export function hiddenBuildings(db: DB, userId: number): number[] {
  const raw = db.prepare('SELECT hidden_buildings FROM users WHERE id = ?').pluck().get(userId) as string | null | undefined;
  return raw ? (JSON.parse(raw) as number[]) : [];
}

export function buildingsRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const changed = (ctx: GroupContext) => events.publish(ctx.groupId, { type: 'data', tables: ['building_alerts'], userId: ctx.user.id });

  /** The viewer's planets and moons for the buildings page, with their alerts. */
  app.get<{ Params: { uni: string } }>('/api/:uni/buildings', async (req) => {
    const ctx = ctxOf(req);
    const state = buildingsState(db, ctx, ctx.user.id);
    const { units: _, ...rest } = state;
    // a read: finished alerts are left out here and removed when a page is pasted
    return { ...rest, alerts: pruneAlerts(db, ctx, state, ctx.now, false), hidden: hiddenBuildings(db, ctx.user.id) };
  });

  /** The viewer's planets with whether their full storages notify by push and Discord (`muted`: they don't). */
  const storageAlerts = (ctx: GroupContext) => {
    const muted = storageMuted(db, ctx.groupId, ctx.user.id);
    return {
      planets: buildingsState(db, ctx, ctx.user.id)
        .planets.filter((bp) => bp.type === 'planet')
        .map((bp) => ({ ...bp.coords, name: bp.name, muted: muted.has(`${bp.coords.g}:${bp.coords.s}:${bp.coords.p}`) })),
    };
  };

  app.get<{ Params: { uni: string } }>('/api/:uni/storage-alerts', async (req) => storageAlerts(ctxOf(req)));

  /** Sets the planets ("g:s:p") whose full storages stay silent; the bell lists them all the same. */
  app.put<{ Params: { uni: string }; Body: { muted?: unknown } }>('/api/:uni/storage-alerts', async (req) => {
    const ctx = ctxOf(req);
    const list = req.body?.muted;
    if (!Array.isArray(list) || list.length > 200 || list.some((c) => typeof c !== 'string' || !/^\d{1,3}:\d{1,4}:\d{1,3}$/.test(c))) {
      throw new HttpError(400, 'storage_alerts_invalid', 'muted: list of planet coordinates "g:s:p"');
    }
    db.transaction(() => {
      db.prepare('DELETE FROM storage_muted WHERE group_id = ? AND user_id = ?').run(ctx.groupId, ctx.user.id);
      const add = db.prepare('INSERT OR IGNORE INTO storage_muted (group_id, user_id, g, s, p) VALUES (?, ?, ?, ?, ?)');
      for (const c of list as string[]) add.run(ctx.groupId, ctx.user.id, ...c.split(':').map(Number));
    })();
    return storageAlerts(ctx);
  });

  /**
   * Notify the viewer when `level` of a building or research on one of their planets is affordable (one alert per
   * element and planet).
   */
  app.put<{ Params: { uni: string }; Body: AlertBody }>('/api/:uni/buildings/alerts', async (req) => {
    const ctx = ctxOf(req);
    const b = req.body ?? {};
    const int = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
    if (![b.g, b.s, b.p, b.id, b.level].every(int) || (b.type !== 'planet' && b.type !== 'moon')) {
      throw new HttpError(400, 'alert_invalid', 'Expected g, s, p, type, id and level');
    }
    // research is started on planets (they have the labs)
    const known = RESEARCH[String(b.id)] ? b.type === 'planet' : BUILDINGS[String(b.id)]?.on.includes(b.type);
    if (!known) throw new HttpError(400, 'building_unknown', 'No such building or research on this planet type');
    const state = buildingsState(db, ctx, ctx.user.id);
    if (!planetOf(state, { g: b.g!, s: b.s!, p: b.p!, planet_type: b.type })) throw new HttpError(404, 'planet_not_found', 'Not one of your synced planets');
    db.prepare(
      `INSERT INTO building_alerts (group_id, user_id, g, s, p, planet_type, element_id, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (group_id, user_id, g, s, p, planet_type, element_id) DO UPDATE SET level = excluded.level, created_at = excluded.created_at`,
    ).run(ctx.groupId, ctx.user.id, b.g, b.s, b.p, b.type, b.id, b.level, now());
    changed(ctx);
    return { alerts: alertsOf(db, ctx, ctx.user.id) };
  });

  /** Replaces the viewer's hidden buildings (kept in the account, so on every device). */
  app.put<{ Params: { uni: string }; Body: { ids?: unknown } }>('/api/:uni/buildings/hidden', { config: { allowEnded: true } }, async (req) => {
    const ctx = ctxOf(req);
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && (BUILDINGS[String(id)] || RESEARCH[String(id)]))) {
      throw new HttpError(400, 'hidden_invalid', 'Expected ids: building or research ids');
    }
    const list = [...new Set(ids as number[])].sort((a, b) => a - b);
    db.prepare('UPDATE users SET hidden_buildings = ? WHERE id = ?').run(list.length ? JSON.stringify(list) : null, ctx.user.id);
    return { hidden: list };
  });

  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/buildings/alerts/:id', async (req) => {
    const ctx = ctxOf(req);
    const res = db.prepare('DELETE FROM building_alerts WHERE id = ? AND group_id = ? AND user_id = ?').run(Number(req.params.id), ctx.groupId, ctx.user.id);
    if (!res.changes) throw new HttpError(404, 'alert_not_found', 'Alert not found');
    changed(ctx);
    return { alerts: alertsOf(db, ctx, ctx.user.id) };
  });
}
