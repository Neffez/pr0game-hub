import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { latestMarket, latestMarketRate, marketRates } from '../repo/market.js';
import { contextOf } from './util.js';

/** Highest metal or crystal per deuterium accepted as a rate set by hand. */
const MAX_RATE = 100;

export function marketRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /** Current market rate, its history and the open offers of the latest marketplace sync. */
  app.get<{ Params: { uni: string } }>('/api/:uni/market', async (req) => {
    const ctx = ctxOf(req);
    const market = latestMarket(db, ctx.groupId, now());
    return {
      rate: latestMarketRate(db, ctx.groupId),
      rates: marketRates(db, ctx.groupId),
      syncedAt: market?.syncedAt ?? null,
      syncedBy: market?.syncedBy ?? null,
      offers: market?.offers ?? [],
    };
  });

  /** Sets the group's market rate by hand (metal and crystal per 1 deuterium). */
  app.put<{ Params: { uni: string }; Body: { m?: unknown; k?: unknown } }>('/api/:uni/market/rate', async (req) => {
    const ctx = ctxOf(req);
    const m = Number(req.body?.m);
    const k = Number(req.body?.k);
    const valid = (v: number) => Number.isFinite(v) && v > 0 && v <= MAX_RATE;
    if (!valid(m) || !valid(k)) throw new HttpError(400, 'rate_invalid', `Expected m and k: numbers above 0 and at most ${MAX_RATE}`);
    db.prepare("INSERT INTO market_rates (group_id, time, metal, crystal, source, user_id) VALUES (?, ?, ?, ?, 'manual', ?)").run(ctx.groupId, now(), m, k, ctx.user.id);
    events.publish(ctx.groupId, { type: 'data', tables: ['market_rates'] });
    return latestMarketRate(db, ctx.groupId);
  });
}
