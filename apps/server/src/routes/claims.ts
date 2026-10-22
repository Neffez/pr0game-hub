import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { contextOf, DISPLAY, MEMBER } from './util.js';

const KINDS = ['farm', 'attack', 'spy'];
/** Claim durations in minutes: default and limits. */
const DEFAULT_MINUTES = 120;
const MAX_MINUTES = 24 * 60;

interface ClaimBody {
  g?: number;
  s?: number;
  p?: number;
  type?: string;
  kind?: string;
  minutes?: number;
  note?: string | null;
  /** group admins: take over a target someone else claimed */
  force?: boolean;
}

const ACTIVE = 'c.released_at IS NULL AND c.expires_at > ?';

export function claimsRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const isAdmin = (ctx: GroupContext) => ctx.role === 'admin' || ctx.user.isAdmin;
  const changed = (ctx: GroupContext) => events.publish(ctx.groupId, { type: 'data', tables: ['target_claims'], userId: ctx.user.id });

  const minutesOf = (v: unknown) => {
    const m = v == null ? DEFAULT_MINUTES : Number(v);
    if (!Number.isInteger(m) || m < 1 || m > MAX_MINUTES) throw new HttpError(400, 'claim_duration_invalid', 'Duration: 1 minute to 24 hours');
    return m;
  };
  const noteOf = (v: unknown) => {
    const note = v == null ? '' : String(v).trim();
    if (note.length > 200) throw new HttpError(400, 'note_too_long', 'Note too long');
    return note || null;
  };

  /** Active claim of the group by id, editable by its member or a group admin. */
  function own(ctx: GroupContext, id: number) {
    const row = db.prepare(`SELECT c.* FROM target_claims c WHERE c.id = ? AND c.group_id = ? AND ${ACTIVE}`).get(id, ctx.groupId, now()) as
      | { id: number; user_id: number }
      | undefined;
    if (!row) throw new HttpError(404, 'claim_not_found', 'Claim not found or expired');
    if (row.user_id !== ctx.user.id && !isAdmin(ctx)) throw new HttpError(403, 'claim_not_yours', 'Claimed by another member');
    return row;
  }

  /** Active claims of the group with the member and the target's owner (galaxy data). */
  app.get<{ Params: { uni: string } }>('/api/:uni/claims', async (req) => {
    const ctx = ctxOf(req);
    return db
      .prepare(
        `SELECT c.id, c.user_id, ${DISPLAY} AS member, c.g, c.s, c.p, c.planet_type, c.kind, c.note, c.created_at, c.expires_at,
           pl.player_id, pr.name AS player_name, CASE WHEN c.planet_type = 'moon' THEN pl.moon_name ELSE pl.name END AS planet_name
         FROM target_claims c
         JOIN users u ON u.id = c.user_id ${MEMBER('c')}
         LEFT JOIN planets pl ON pl.group_id = c.group_id AND pl.g = c.g AND pl.s = c.s AND pl.p = c.p
         LEFT JOIN players pr ON pr.id = pl.player_id
         WHERE c.group_id = ? AND ${ACTIVE} ORDER BY c.expires_at`,
      )
      .all(ctx.groupId, now());
  });

  app.post<{ Params: { uni: string }; Body: ClaimBody }>('/api/:uni/claims', async (req) => {
    const ctx = ctxOf(req);
    const b = req.body ?? {};
    const { galaxies, systems, positions } = ctx.universe.settings;
    const inRange = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max;
    if (!inRange(b.g, galaxies) || !inRange(b.s, systems) || !inRange(b.p, positions)) throw new HttpError(400, 'coords_invalid', 'Invalid coordinates');
    const type = b.type === 'moon' ? 'moon' : 'planet';
    const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : 'farm';
    const minutes = minutesOf(b.minutes);
    const note = noteOf(b.note);
    return db.transaction(() => {
      const t = now();
      const held = db
        .prepare(`SELECT c.id, c.user_id, ${DISPLAY} AS member FROM target_claims c JOIN users u ON u.id = c.user_id ${MEMBER('c')}
                  WHERE c.group_id = ? AND c.g = ? AND c.s = ? AND c.p = ? AND c.planet_type = ? AND ${ACTIVE}`)
        .get(ctx.groupId, b.g, b.s, b.p, type, t) as { id: number; user_id: number; member: string } | undefined;
      if (held && held.user_id !== ctx.user.id && !(b.force && isAdmin(ctx))) {
        throw new HttpError(409, 'target_claimed', `Already claimed by ${held.member}`);
      }
      // claiming again (own or taken over) replaces the active claim
      if (held) db.prepare('UPDATE target_claims SET released_at = ? WHERE id = ?').run(t, held.id);
      const id = db
        .prepare(
          `INSERT INTO target_claims (group_id, user_id, g, s, p, planet_type, kind, note, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ctx.groupId, ctx.user.id, b.g, b.s, b.p, type, kind, note, t, t + minutes * 60).lastInsertRowid;
      changed(ctx);
      return { id: Number(id), expires_at: t + minutes * 60 };
    })();
  });

  /** Extends a claim (from now on) and/or changes its note. */
  app.put<{ Params: { uni: string; id: string }; Body: { minutes?: number; note?: string | null } }>('/api/:uni/claims/:id', async (req) => {
    const ctx = ctxOf(req);
    const claim = own(ctx, Number(req.params.id));
    const b = req.body ?? {};
    if (b.minutes != null) db.prepare('UPDATE target_claims SET expires_at = ? WHERE id = ?').run(now() + minutesOf(b.minutes) * 60, claim.id);
    if (b.note !== undefined) db.prepare('UPDATE target_claims SET note = ? WHERE id = ?').run(noteOf(b.note), claim.id);
    changed(ctx);
    return { ok: true };
  });

  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/claims/:id', async (req) => {
    const ctx = ctxOf(req);
    const claim = own(ctx, Number(req.params.id));
    db.prepare('UPDATE target_claims SET released_at = ? WHERE id = ?').run(now(), claim.id);
    changed(ctx);
    return { ok: true };
  });
}
