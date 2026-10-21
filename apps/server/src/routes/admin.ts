import type { FastifyInstance } from 'fastify';
import { HttpError, randomToken, requireAdmin, requireUser } from '../auth.js';
import { UNIVERSE_DEFAULTS } from '../config.js';
import { toUniverse } from '../context.js';
import { now, type DB } from '../db.js';
import { backfillActivity, reparse } from '../ingest.js';

/**
 * Global admins manage universes, groups and invites. Group admins may invite
 * into and manage their own group.
 */
export function adminRoutes(app: FastifyInstance, db: DB) {
  const isGroupAdmin = (userId: number, groupId: number) =>
    !!db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'admin'").get(groupId, userId);

  const requireGroupAdmin = (req: Parameters<typeof requireUser>[0], groupId: number) => {
    const user = requireUser(req);
    if (!user.isAdmin && !isGroupAdmin(user.id, groupId)) throw new HttpError(403, 'Nur für Allianz-Admins');
    return user;
  };

  // ------------------------------------------------------------- universes

  app.get('/api/universes', async (req) => {
    requireUser(req);
    return (db.prepare('SELECT * FROM universes ORDER BY slug').all() as never[]).map(toUniverse);
  });

  app.post<{ Body: { slug: string; name: string; settings?: object; deck?: unknown } }>('/api/admin/universes', async (req) => {
    requireAdmin(req);
    const { slug, name, settings, deck } = req.body ?? ({} as never);
    if (!/^[a-z0-9-]{1,16}$/.test(slug ?? '')) throw new HttpError(400, 'Slug: a-z, 0-9, -');
    if (db.prepare('SELECT 1 FROM universes WHERE slug = ?').get(slug)) throw new HttpError(409, 'Universum existiert bereits');
    validateSettings(settings);
    db.prepare('INSERT INTO universes (slug, name, settings, deck_config) VALUES (?, ?, ?, ?)').run(
      slug,
      name || slug,
      JSON.stringify({ ...UNIVERSE_DEFAULTS, ...(settings ?? {}) }),
      deck ? JSON.stringify(validateDeck(deck)) : null,
    );
    return { ok: true };
  });

  app.put<{ Params: { slug: string }; Body: { name?: string; settings?: object; deck?: unknown | null } }>(
    '/api/admin/universes/:slug',
    async (req) => {
      requireAdmin(req);
      const { name, settings, deck } = req.body ?? {};
      const cur = db.prepare('SELECT * FROM universes WHERE slug = ?').get(req.params.slug) as { settings: string } | undefined;
      if (!cur) throw new HttpError(404, 'Universum nicht gefunden');
      validateSettings(settings);
      db.prepare('UPDATE universes SET name = COALESCE(?, name), settings = ? WHERE slug = ?').run(
        name ?? null,
        JSON.stringify({ ...JSON.parse(cur.settings), ...(settings ?? {}) }),
        req.params.slug,
      );
      if (deck !== undefined) {
        db.prepare('UPDATE universes SET deck_config = ? WHERE slug = ?').run(deck ? JSON.stringify(validateDeck(deck)) : null, req.params.slug);
      }
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------- groups

  app.get('/api/admin/groups', async (req) => {
    const user = requireUser(req);
    const groups = db
      .prepare(
        `SELECT g.id, g.name, u.slug AS universe, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS members
         FROM groups g JOIN universes u ON u.id = g.universe_id
         WHERE ? OR g.id IN (SELECT group_id FROM group_members WHERE user_id = ? AND role = 'admin')
         ORDER BY u.slug, g.name`,
      )
      .all(user.isAdmin ? 1 : 0, user.id);
    return groups;
  });

  app.post<{ Body: { universe: string; name: string } }>('/api/admin/groups', async (req) => {
    const user = requireAdmin(req);
    const uni = db.prepare('SELECT id FROM universes WHERE slug = ?').pluck().get(req.body?.universe) as number | undefined;
    if (!uni) throw new HttpError(404, 'Universum nicht gefunden');
    const name = String(req.body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Name fehlt');
    if (db.prepare('SELECT 1 FROM groups WHERE universe_id = ? AND name = ?').get(uni, name)) throw new HttpError(409, 'Allianz existiert bereits');
    const id = db.prepare('INSERT INTO groups (universe_id, name) VALUES (?, ?)').run(uni, name).lastInsertRowid;
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(id, user.id);
    return { id: Number(id) };
  });

  app.get<{ Params: { id: string } }>('/api/admin/groups/:id/members', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdmin(req, groupId);
    return db
      .prepare(
        `SELECT u.id, u.username, m.role, m.ingame_name, m.joined_at, u.last_login_at
         FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.username`,
      )
      .all(groupId);
  });

  app.put<{ Params: { id: string; userId: string }; Body: { role?: string; ingameName?: string | null } }>(
    '/api/admin/groups/:id/members/:userId',
    async (req) => {
      const groupId = Number(req.params.id);
      requireGroupAdmin(req, groupId);
      const role = req.body?.role;
      if (role && role !== 'member' && role !== 'admin') throw new HttpError(400, 'Rolle ungültig');
      const hasName = req.body !== undefined && req.body !== null && 'ingameName' in req.body;
      db.prepare('UPDATE group_members SET role = COALESCE(?, role), ingame_name = CASE WHEN ? THEN ? ELSE ingame_name END WHERE group_id = ? AND user_id = ?').run(
        role ?? null,
        hasName ? 1 : 0,
        String(req.body?.ingameName ?? '').trim() || null,
        groupId,
        Number(req.params.userId),
      );
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>('/api/admin/groups/:id/members/:userId', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdmin(req, groupId);
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, Number(req.params.userId));
    return { ok: true };
  });

  // --------------------------------------------------------------- invites

  app.get<{ Params: { id: string } }>('/api/admin/groups/:id/invites', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdmin(req, groupId);
    return db
      .prepare(
        `SELECT i.token, i.role, i.created_at, i.expires_at, i.used_at, u.username AS used_by
         FROM invites i LEFT JOIN users u ON u.id = i.used_by WHERE i.group_id = ? ORDER BY i.created_at DESC LIMIT 50`,
      )
      .all(groupId);
  });

  app.post<{ Params: { id: string }; Body: { role?: string; days?: number } }>('/api/admin/groups/:id/invites', async (req) => {
    const groupId = Number(req.params.id);
    const user = requireGroupAdmin(req, groupId);
    const role = req.body?.role === 'admin' ? 'admin' : 'member';
    const days = Math.min(Math.max(Number(req.body?.days ?? 7), 1), 90);
    const token = randomToken(24);
    db.prepare('INSERT INTO invites (token, group_id, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?)').run(
      token,
      groupId,
      role,
      user.id,
      now() + days * 86400,
    );
    return { token };
  });

  app.delete<{ Params: { token: string } }>('/api/admin/invites/:token', async (req) => {
    const inv = db.prepare('SELECT group_id FROM invites WHERE token = ?').get(req.params.token) as { group_id: number } | undefined;
    if (!inv) throw new HttpError(404, 'Einladung nicht gefunden');
    requireGroupAdmin(req, inv.group_id);
    db.prepare('DELETE FROM invites WHERE token = ? AND used_at IS NULL').run(req.params.token);
    return { ok: true };
  });

  // ------------------------------------------------- players / data hygiene

  /** Merges `from` into `into` (rename that couldn't be matched by id). */
  app.post<{ Params: { id: string }; Body: { from: number; into: number } }>('/api/admin/groups/:id/players/merge', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdmin(req, groupId);
    const { from, into } = req.body ?? ({} as never);
    const both = db.prepare('SELECT id, name, ingame_id, first_seen, last_seen FROM players WHERE group_id = ? AND id IN (?, ?)').all(groupId, from, into) as {
      id: number;
      name: string;
      ingame_id: number | null;
      first_seen: number;
      last_seen: number;
    }[];
    if (!Number.isInteger(from) || !Number.isInteger(into) || both.length !== 2 || from === into) throw new HttpError(400, 'Spieler ungültig');
    const src = both.find((p) => p.id === from)!;
    db.transaction(() => {
      // Scores of the same snapshot: keep the target's.
      db.prepare('UPDATE OR IGNORE player_scores SET player_id = ? WHERE player_id = ?').run(into, from);
      for (const table of ['spy_reports', 'planets']) db.prepare(`UPDATE ${table} SET player_id = ? WHERE player_id = ?`).run(into, from);
      db.prepare('UPDATE OR IGNORE player_aliases SET player_id = ? WHERE player_id = ?').run(into, from);
      db.prepare('UPDATE player_status_log SET player_id = ? WHERE player_id = ?').run(into, from);
      db.prepare('INSERT OR REPLACE INTO player_aliases (player_id, name, seen_until) VALUES (?, ?, ?)').run(into, src.name, src.last_seen);
      if (src.ingame_id) db.prepare('UPDATE players SET ingame_id = NULL WHERE id = ?').run(from);
      db.prepare('UPDATE players SET ingame_id = COALESCE(ingame_id, ?), first_seen = MIN(first_seen, ?) WHERE id = ?').run(src.ingame_id, src.first_seen, into);
      db.prepare('DELETE FROM players WHERE id = ?').run(from);
    })();
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/admin/groups/:id/ingests', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdmin(req, groupId);
    return db
      .prepare(
        `SELECT r.id, r.source, r.page_type, r.url, r.summary, r.created_at, u.username,
           length(r.html_gz) AS html_size, length(r.text_gz) AS text_size
         FROM raw_ingests r LEFT JOIN users u ON u.id = r.user_id WHERE r.group_id = ? ORDER BY r.id DESC LIMIT 200`,
      )
      .all(groupId)
      .map((r: any) => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : null }));
  });

  app.post<{ Params: { id: string } }>('/api/admin/ingests/:id/reparse', async (req) => {
    const row = db
      .prepare('SELECT r.group_id, u.settings FROM raw_ingests r JOIN groups g ON g.id = r.group_id JOIN universes u ON u.id = g.universe_id WHERE r.id = ?')
      .get(Number(req.params.id)) as { group_id: number; settings: string } | undefined;
    if (!row) throw new HttpError(404, 'Nicht gefunden');
    requireGroupAdmin(req, row.group_id);
    const tz = JSON.parse(row.settings).timezone ?? UNIVERSE_DEFAULTS.timezone;
    return reparse(db, Number(req.params.id), tz);
  });

  /** Fills the activity log from already stored stats and spy reports. */
  app.post<{ Params: { id: string } }>('/api/admin/groups/:id/activity/backfill', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdmin(req, groupId);
    const row = db.prepare('SELECT u.settings FROM groups g JOIN universes u ON u.id = g.universe_id WHERE g.id = ?').get(groupId) as
      | { settings: string }
      | undefined;
    if (!row) throw new HttpError(404, 'Nicht gefunden');
    const tz = JSON.parse(row.settings).timezone ?? UNIVERSE_DEFAULTS.timezone;
    return { added: backfillActivity(db, groupId, tz) };
  });
}

function validateSettings(settings: object | undefined) {
  if (!settings) return;
  const s = settings as Record<string, unknown>;
  if (s.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: String(s.timezone) });
    } catch {
      throw new HttpError(400, 'Zeitzone ungültig');
    }
  }
  if (s.gameUrl && !/^https?:\/\//i.test(String(s.gameUrl))) throw new HttpError(400, 'Spiel-URL muss mit http(s):// beginnen');
}

function validateDeck(deck: unknown) {
  if (!Array.isArray(deck)) throw new HttpError(400, 'Deck muss ein Array sein');
  return deck.map((c) => {
    const { type, size, count } = c as Record<string, unknown>;
    if (typeof type !== 'string' || typeof size !== 'string' || !Number.isInteger(count) || (count as number) < 0) {
      throw new HttpError(400, 'Deck-Eintrag ungültig: {type, size, count}');
    }
    return { type, size, count };
  });
}
