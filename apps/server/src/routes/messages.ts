import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { events } from '../events.js';
import { conversations } from '../domain/conversations.js';
import { messageShare, shareMessage, visibleMessages } from '../repo/messages.js';
import { clampInt, contextOf, type Q } from './util.js';

export function messageRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /**
   * Player messages the user may see (own and shared ones), newest first, and the conversations they form;
   * `share`: whether the user shares theirs. `ally` marks players of the own alliance.
   */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/messages', async (req) => {
    const ctx = ctxOf(req);
    const list = visibleMessages(db, ctx.groupId, ctx.user.id, clampInt(req.query.limit, 5000, 1, 20000));
    return { share: messageShare(db, ctx.user.id), ...conversations(db, ctx, list) };
  });

  /** Shares the user's own copy of a message with the alliance or not (overrides the account setting for it). */
  app.post<{ Params: { uni: string; id: string }; Body: { shared?: boolean } }>('/api/:uni/messages/:id/share', async (req) => {
    const ctx = ctxOf(req);
    const shared = req.body?.shared === true;
    if (!shareMessage(db, ctx.groupId, ctx.user.id, Number(req.params.id), shared)) throw new HttpError(404, 'not_found', 'Not found');
    events.publish(ctx.groupId, { type: 'data', tables: ['player_messages'], userId: ctx.user.id });
    return { shared };
  });
}
