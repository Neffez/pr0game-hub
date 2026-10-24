import { BUILDINGS } from '@pr0hub/core/buildings';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { alertDone, alertsOf, buildingsState, planetBuildings, planetOf, type BuildingAlert, type BuildingsState } from '../repo/buildings.js';
import { contextOf } from './util.js';

interface AlertBody {
  g?: number;
  s?: number;
  p?: number;
  type?: string;
  id?: number;
  level?: number;
}

/** Removes the viewer's alerts whose level is built or queued (or whose planet is gone); returns the others. */
export function pruneAlerts(db: DB, ctx: GroupContext, state: BuildingsState, t = now()): BuildingAlert[] {
  const done: number[] = [];
  const open = alertsOf(db, ctx, ctx.user.id).filter((a) => {
    const bp = planetOf(state, a);
    if (bp && !alertDone(a, planetBuildings(state, bp, t).find((b) => b.id === a.element_id))) return true;
    // without any synced page the alert stays (nothing to judge by)
    if (!state.planets.length) return true;
    done.push(a.id);
    return false;
  });
  if (done.length) db.prepare('DELETE FROM building_alerts WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(done));
  return open;
}

export function buildingsRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const changed = (ctx: GroupContext) => events.publish(ctx.groupId, { type: 'data', tables: ['building_alerts'], userId: ctx.user.id });

  /** The viewer's planets and moons for the buildings page, with their alerts. */
  app.get<{ Params: { uni: string } }>('/api/:uni/buildings', async (req) => {
    const ctx = ctxOf(req);
    const state = buildingsState(db, ctx, ctx.user.id);
    return { ...state, alerts: pruneAlerts(db, ctx, state) };
  });

  /** Notify the viewer when `level` of a building on one of their planets is affordable (one alert per building). */
  app.put<{ Params: { uni: string }; Body: AlertBody }>('/api/:uni/buildings/alerts', async (req) => {
    const ctx = ctxOf(req);
    const b = req.body ?? {};
    const int = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
    if (![b.g, b.s, b.p, b.id, b.level].every(int) || (b.type !== 'planet' && b.type !== 'moon')) {
      throw new HttpError(400, 'alert_invalid', 'Expected g, s, p, type, id and level');
    }
    if (!BUILDINGS[String(b.id)]?.on.includes(b.type)) throw new HttpError(400, 'building_unknown', 'No such building on this planet type');
    const state = buildingsState(db, ctx, ctx.user.id);
    if (!planetOf(state, { g: b.g!, s: b.s!, p: b.p!, planet_type: b.type })) throw new HttpError(404, 'planet_not_found', 'Not one of your synced planets');
    db.prepare(
      `INSERT INTO building_alerts (group_id, user_id, g, s, p, planet_type, element_id, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (group_id, user_id, g, s, p, planet_type, element_id) DO UPDATE SET level = excluded.level, created_at = excluded.created_at`,
    ).run(ctx.groupId, ctx.user.id, b.g, b.s, b.p, b.type, b.id, b.level, now());
    changed(ctx);
    return { alerts: alertsOf(db, ctx, ctx.user.id) };
  });

  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/buildings/alerts/:id', async (req) => {
    const ctx = ctxOf(req);
    const res = db.prepare('DELETE FROM building_alerts WHERE id = ? AND group_id = ? AND user_id = ?').run(Number(req.params.id), ctx.groupId, ctx.user.id);
    if (!res.changes) throw new HttpError(404, 'alert_not_found', 'Alert not found');
    changed(ctx);
    return { alerts: alertsOf(db, ctx, ctx.user.id) };
  });
}
