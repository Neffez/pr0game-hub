import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { notificationsFor } from '../repo/notifications.js';
import { contextOf } from './util.js';

export function notificationRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /** Current notifications of the group for the viewer, the next first (see repo/notifications.ts). */
  app.get<{ Params: { uni: string } }>('/api/:uni/notifications', async (req) => {
    const ctx = ctxOf(req);
    // nothing is due any more in an ended universe
    return ctx.universe.endedAt != null ? [] : notificationsFor(db, ctx, ctx.now);
  });
}
