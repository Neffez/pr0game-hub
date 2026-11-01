import type { FastifyInstance } from 'fastify';
import { HttpError, loadSessionUser } from '../auth.js';
import { groupContext, isRunning, resolveGroup } from '../context.js';
import { now, type DB } from '../db.js';
import { events, type Whereabouts } from '../events.js';
import { memberOnline } from '../repo/activity.js';
import { presenceForViewer } from '../repo/presence.js';

/** Comment line that keeps proxies from closing an idle stream; also when session and membership are checked again. */
export const HEARTBEAT_MS = 25_000;
/** Open streams per user and group (tabs share one, see the web app's live.ts). */
const MAX_CONNECTIONS = 10;

export function eventRoutes(app: FastifyInstance, db: DB) {
  events.setPresenceFilter((viewer, members) =>
    presenceForViewer(db, { id: viewer.userId, isAdmin: viewer.isAdmin }, members),
  );
  const open = new Set<(closing?: boolean) => void>();
  // hijacked streams never finish on their own: end them before the server waits for its connections
  app.addHook('preClose', async () => {
    for (const end of [...open]) end(true);
  });

  /** Server-Sent Events of the group (see events.ts). EventSource can't send headers: the group comes as `?group=`. */
  app.get<{ Params: { uni: string } }>('/api/:uni/events', async (req, reply) => {
    const ctx = groupContext(db, req, req.params.uni);
    if (events.connections(ctx.groupId, ctx.user.id) >= MAX_CONNECTIONS) throw new HttpError(429, 'too_many_connections', 'Too many open connections');

    reply.hijack();
    const res = reply.raw;
    // kept: an ended response lets go of its socket
    const socket = res.socket;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // nginx would buffer the stream otherwise
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const unsubscribe = events.subscribe(
      ctx.groupId,
      { userId: ctx.user.id, isAdmin: ctx.user.isAdmin, send: (event) => res.write(`data: ${JSON.stringify(event)}\n\n`) },
      () => db.prepare('UPDATE group_members SET last_seen_at = ? WHERE group_id = ? AND user_id = ?').run(now(), ctx.groupId, ctx.user.id),
    );
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

    function end(closing = false) {
      if (!open.delete(end)) return;
      clearInterval(timer);
      unsubscribe();
      res.end();
      // server shutdown: the connection itself too, the client would keep it open
      if (closing) socket?.destroy();
    }
    open.add(end);
    // the response's close (not the request's: that one fires once the request is read)
    res.on('close', end);
  });

  /** Online members and where they are (afterwards kept up to date by `presence` events). */
  app.get<{ Params: { uni: string } }>('/api/:uni/presence', async (req) => {
    const ctx = groupContext(db, req, req.params.uni);
    return presenceForViewer(db, ctx.user, events.presence(ctx.groupId));
  });

  /**
   * A tab of the current user reports its page (and the shown system or player), whether it is active and focused;
   * `closed` when it goes away. `tab` tells the user's tabs apart.
   */
  app.post<{ Params: { uni: string }; Body: Partial<Whereabouts> & { tab?: unknown; focused?: unknown; closed?: unknown } }>(
    '/api/:uni/presence',
    { config: { allowEnded: true } },
    async (req) => {
      const ctx = groupContext(db, req, req.params.uni);
      const b = req.body ?? {};
      const tab = typeof b.tab === 'string' && /^[\w-]{1,40}$/.test(b.tab) ? b.tab : '';
      if (b.closed === true) {
        events.closeTab(ctx.groupId, ctx.user.id, tab);
        return { ok: true };
      }
      const id = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 1e9 ? (v as number) : undefined);
      events.setWhereabouts(
        ctx.groupId,
        ctx.user.id,
        {
          page: typeof b.page === 'string' && /^[a-z-]{1,32}$/.test(b.page) ? b.page : null,
          ...(id(b.g) && { g: id(b.g) }),
          ...(id(b.s) && { s: id(b.s) }),
          ...(id(b.player) && { player: id(b.player) }),
          active: b.active !== false,
        },
        { id: tab, focused: b.focused === true },
      );
      // an active hub tab: the member is around (activity pattern of their player)
      if (b.active !== false && isRunning(ctx.universe)) memberOnline(db, ctx.groupId, ctx.user.id, now());
      return { ok: true };
    },
  );
}
