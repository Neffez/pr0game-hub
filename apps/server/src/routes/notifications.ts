import type { FastifyInstance } from 'fastify';
import { isRunning } from '../context.js';
import type { DB } from '../db.js';
import { notificationsFor } from '../repo/notifications.js';
import { contextOf } from './util.js';

export function notificationRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /** Current notifications of the group for the viewer, the next first (see repo/notifications.ts). */
  app.get<{ Params: { uni: string } }>('/api/:uni/notifications', async (req) => {
    const ctx = ctxOf(req);
    // nothing is due before the start or after the end of the universe
    return !isRunning(ctx.universe) ? [] : notificationsFor(db, ctx, ctx.now);
  });
}
