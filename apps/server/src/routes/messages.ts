import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { messageShare, visibleMessages } from '../repo/messages.js';
import { clampInt, contextOf, type Q } from './util.js';

export function messageRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /** Player messages the user may see (own and shared ones), newest first; `share`: whether the user shares theirs. */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/messages', async (req) => {
    const ctx = ctxOf(req);
    return {
      share: messageShare(db, ctx.user.id),
      messages: visibleMessages(db, ctx.groupId, ctx.user.id, clampInt(req.query.limit, 5000, 1, 20000)),
    };
  });
}
