import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events, type DataEvent } from '../events.js';
import { contextOf, DISPLAY, MEMBER, type Q } from './util.js';

const MAX_LENGTH = 2000;

/** Thread target: a player of the group, a raid plan (its loot settlement), or a planet/moon by coordinates. */
type Target = { player: number } | { plan: number } | { g: number; s: number; p: number; type: 'planet' | 'moon' };

export function commentsRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  function targetOf(ctx: GroupContext, q: { player?: unknown; plan?: unknown; c?: unknown; type?: unknown }): Target {
    if (q.player != null) {
      const player = Number(q.player);
      if (!db.prepare('SELECT 1 FROM players WHERE id = ? AND group_id = ?').get(player, ctx.groupId)) {
        throw new HttpError(404, 'player_not_found', 'Player not found');
      }
      return { player };
    }
    if (q.plan != null) {
      const plan = Number(q.plan);
      if (!db.prepare('SELECT 1 FROM attack_plans WHERE id = ? AND group_id = ?').get(plan, ctx.groupId)) {
        throw new HttpError(404, 'plan_not_found', 'Plan not found');
      }
      return { plan };
    }
    const m = String(q.c ?? '').match(/^(\d+):(\d+):(\d+)$/);
    const { galaxies, systems, positions } = ctx.universe.settings;
    if (!m || +m[1] < 1 || +m[1] > galaxies || +m[2] < 1 || +m[2] > systems || +m[3] < 1 || +m[3] > positions) {
      throw new HttpError(400, 'coords_invalid', 'Invalid coordinates');
    }
    return { g: +m[1], s: +m[2], p: +m[3], type: q.type === 'moon' ? 'moon' : 'planet' };
  }
  const where = (t: Target) =>
    'player' in t
      ? { sql: 'c.player_id = ?', args: [t.player] }
      : 'plan' in t
      ? { sql: 'c.plan_id = ?', args: [t.plan] }
      : { sql: 'c.g = ? AND c.s = ? AND c.p = ? AND c.planet_type = ?', args: [t.g, t.s, t.p, t.type] };

  const bodyOf = (v: unknown) => {
    const body = String(v ?? '').trim();
    if (!body) throw new HttpError(400, 'comment_empty', 'Empty comment');
    if (body.length > MAX_LENGTH) throw new HttpError(400, 'comment_too_long', 'Comment too long');
    return body;
  };

  /** Comment of the group by id: its author may edit it; deleting also a group admin. */
  function comment(ctx: GroupContext, id: number, adminToo: boolean) {
    const row = db.prepare('SELECT id, user_id FROM comments WHERE id = ? AND group_id = ? AND deleted_at IS NULL').get(id, ctx.groupId) as
      | { id: number; user_id: number | null }
      | undefined;
    if (!row) throw new HttpError(404, 'comment_not_found', 'Comment not found');
    const allowed = row.user_id === ctx.user.id || (adminToo && (ctx.role === 'admin' || ctx.user.isAdmin));
    if (!allowed) throw new HttpError(403, 'comment_not_yours', 'Comment of another member');
    return row;
  }
  const changed = (ctx: GroupContext, comment?: DataEvent['comment']) =>
    events.publish(ctx.groupId, { type: 'data', tables: ['comments'], userId: ctx.user.id, comment });

  /** Thread of a player (`?player=id`), a plan's settlement (`?plan=id`) or a planet (`?c=g:s:p&type=moon`), oldest first. */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/comments', async (req) => {
    const ctx = ctxOf(req);
    const w = where(targetOf(ctx, req.query));
    return db
      .prepare(
        `SELECT c.id, c.user_id, ${DISPLAY} AS member, c.body, c.created_at, c.edited_at FROM comments c
         LEFT JOIN users u ON u.id = c.user_id ${MEMBER('c')}
         WHERE c.group_id = ? AND ${w.sql} AND c.deleted_at IS NULL ORDER BY c.created_at, c.id`,
      )
      .all(ctx.groupId, ...w.args);
  });

  /** Number of comments per player, per plan and per planet ("g:s:p:type"), for the badges. */
  app.get<{ Params: { uni: string } }>('/api/:uni/comments/counts', async (req) => {
    const ctx = ctxOf(req);
    const rows = db
      .prepare(
        `SELECT player_id, plan_id, g, s, p, planet_type, COUNT(*) AS n FROM comments WHERE group_id = ? AND deleted_at IS NULL
         GROUP BY player_id, plan_id, g, s, p, planet_type`,
      )
      .all(ctx.groupId) as { player_id: number | null; plan_id: number | null; g: number; s: number; p: number; planet_type: string; n: number }[];
    const players: Record<number, number> = {};
    const plans: Record<number, number> = {};
    const planets: Record<string, number> = {};
    for (const r of rows) {
      if (r.player_id != null) players[r.player_id] = r.n;
      else if (r.plan_id != null) plans[r.plan_id] = r.n;
      else planets[`${r.g}:${r.s}:${r.p}:${r.planet_type}`] = r.n;
    }
    return { players, plans, planets };
  });

  app.post<{ Params: { uni: string }; Body: { player?: number; plan?: number; c?: string; type?: string; body?: string } }>('/api/:uni/comments', async (req) => {
    const ctx = ctxOf(req);
    const b = req.body ?? {};
    const t = targetOf(ctx, b);
    const body = bodyOf(b.body);
    let id: number | bigint;
    if ('player' in t) {
      id = db.prepare('INSERT INTO comments (group_id, user_id, player_id, body) VALUES (?, ?, ?, ?)').run(ctx.groupId, ctx.user.id, t.player, body).lastInsertRowid;
      changed(ctx, { player: t.player, playerName: db.prepare('SELECT name FROM players WHERE id = ?').pluck().get(t.player) as string });
    } else if ('plan' in t) {
      id = db.prepare('INSERT INTO comments (group_id, user_id, plan_id, body) VALUES (?, ?, ?, ?)').run(ctx.groupId, ctx.user.id, t.plan, body).lastInsertRowid;
      changed(ctx, { plan: t.plan });
    } else {
      id = db
        .prepare('INSERT INTO comments (group_id, user_id, g, s, p, planet_type, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ctx.groupId, ctx.user.id, t.g, t.s, t.p, t.type, body).lastInsertRowid;
      changed(ctx, { coords: `${t.g}:${t.s}:${t.p}`, moon: t.type === 'moon' });
    }
    return { id: Number(id) };
  });

  app.put<{ Params: { uni: string; id: string }; Body: { body?: string } }>('/api/:uni/comments/:id', async (req) => {
    const ctx = ctxOf(req);
    const row = comment(ctx, Number(req.params.id), false);
    db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(bodyOf(req.body?.body), now(), row.id);
    changed(ctx);
    return { ok: true };
  });

  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/comments/:id', async (req) => {
    const ctx = ctxOf(req);
    const row = comment(ctx, Number(req.params.id), true);
    db.prepare('UPDATE comments SET deleted_at = ? WHERE id = ?').run(now(), row.id);
    changed(ctx);
    return { ok: true };
  });
}
