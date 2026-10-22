import type { FastifyInstance } from 'fastify';
import { HttpError, loadSessionUser } from '../auth.js';
import { groupContext, resolveGroup } from '../context.js';
import type { DB } from '../db.js';
import { events } from '../events.js';

/** Comment line that keeps proxies from closing an idle stream; also when session and membership are checked again. */
export const HEARTBEAT_MS = 25_000;
/** Open streams per user and group (tabs share one, see the web app's live.ts). */
const MAX_CONNECTIONS = 10;

export function eventRoutes(app: FastifyInstance, db: DB) {
  const open = new Set<() => void>();
  // hijacked streams never finish on their own: end them before the server waits for its connections
  app.addHook('preClose', async () => {
    for (const end of [...open]) end();
  });

  /** Server-Sent Events of the group (see events.ts). EventSource can't send headers: the group comes as `?group=`. */
  app.get<{ Params: { uni: string } }>('/api/:uni/events', async (req, reply) => {
    const ctx = groupContext(db, req, req.params.uni);
    if (events.connections(ctx.groupId, ctx.user.id) >= MAX_CONNECTIONS) throw new HttpError(429, 'too_many_connections', 'Too many open connections');

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // nginx would buffer the stream otherwise
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const unsubscribe = events.subscribe(ctx.groupId, {
      userId: ctx.user.id,
      send: (event) => res.write(`data: ${JSON.stringify(event)}\n\n`),
    });
    // logged out or removed from the group while the tab stays open: the stream ends
    const timer = setInterval(() => {
      const user = loadSessionUser(db, req);
      try {
        if (user?.id !== ctx.user.id) return end();
        resolveGroup(db, user, ctx.universe, ctx.groupId);
      } catch {
        return end();
      }
      res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    function end() {
      if (!open.delete(end)) return;
      clearInterval(timer);
      unsubscribe();
      res.end();
    }
    open.add(end);
    // the response's close (not the request's: that one fires once the request is read)
    res.on('close', end);
  });
}
