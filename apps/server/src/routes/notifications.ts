import type { FastifyInstance } from 'fastify';
import { now, type DB } from '../db.js';
import { notificationsFor } from '../repo/notifications.js';
import { contextOf } from './util.js';

export function notificationRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /** Current notifications of the group for the viewer, the next first (see repo/notifications.ts). */
  app.get<{ Params: { uni: string } }>('/api/:uni/notifications', async (req) => notificationsFor(db, ctxOf(req), now()));
}
