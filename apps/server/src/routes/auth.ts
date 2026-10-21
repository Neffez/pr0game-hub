import type { FastifyInstance } from 'fastify';
import { createSession, destroySession, hashPassword, HttpError, requireUser, verifyPassword } from '../auth.js';
import { now, type DB } from '../db.js';

export function authRoutes(app: FastifyInstance, db: DB) {
  app.post<{ Body: { username: string; password: string } }>('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? ({} as never);
    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(String(username ?? '')) as
      | { id: number; password_hash: string }
      | undefined;
    if (!user || !verifyPassword(String(password ?? ''), user.password_hash)) throw new HttpError(401, 'Benutzername oder Passwort falsch');
    createSession(db, user.id, reply);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(db, req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.user) return { user: null, groups: [] };
    const groups = db
      .prepare(
        `SELECT g.id, g.name, m.role, u.slug AS universe, u.name AS universe_name
         FROM group_members m JOIN groups g ON g.id = m.group_id JOIN universes u ON u.id = g.universe_id
         WHERE m.user_id = ? ORDER BY u.slug, g.name`,
      )
      .all(req.user.id);
    return { user: req.user, groups };
  });

  app.post<{ Body: { oldPassword: string; newPassword: string } }>('/api/auth/password', async (req) => {
    const user = requireUser(req);
    const { oldPassword, newPassword } = req.body ?? ({} as never);
    const hash = db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(user.id) as string;
    if (!verifyPassword(String(oldPassword ?? ''), hash)) throw new HttpError(400, 'Altes Passwort falsch');
    if (String(newPassword ?? '').length < 8) throw new HttpError(400, 'Passwort muss mindestens 8 Zeichen haben');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
    return { ok: true };
  });

  /** Invite info for the registration form. */
  app.get<{ Params: { token: string } }>('/api/invites/:token', async (req) => {
    const inv = openInvite(db, req.params.token);
    const group = inv.group_id
      ? db.prepare('SELECT g.name, u.name AS universe FROM groups g JOIN universes u ON u.id = g.universe_id WHERE g.id = ?').get(inv.group_id)
      : null;
    return { group, role: inv.role, expiresAt: inv.expires_at };
  });

  /**
   * Accepts an invite: creates an account (username + password) or, when logged in,
   * adds the current account to the invite's group.
   */
  app.post<{ Params: { token: string }; Body: { username?: string; password?: string } }>('/api/invites/:token/accept', async (req, reply) => {
    const inv = openInvite(db, req.params.token);
    let userId = req.user?.id;
    db.transaction(() => {
      if (!userId) {
        const username = String(req.body?.username ?? '').trim();
        const password = String(req.body?.password ?? '');
        if (!/^[\w.\- ]{3,32}$/.test(username)) throw new HttpError(400, 'Benutzername: 3–32 Zeichen (Buchstaben, Zahlen, . _ -)');
        if (password.length < 8) throw new HttpError(400, 'Passwort muss mindestens 8 Zeichen haben');
        if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Benutzername vergeben');
        userId = Number(
          db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)').run(username, hashPassword(password)).lastInsertRowid,
        );
      }
      if (inv.group_id) {
        db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(inv.group_id, userId, inv.role);
      }
      db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE token = ?').run(userId, now(), inv.token);
    })();
    if (!req.user) createSession(db, userId!, reply);
    return { ok: true };
  });
}

type InviteRow = { token: string; group_id: number | null; role: string; expires_at: number; used_at: number | null };

function openInvite(db: DB, token: string): InviteRow {
  const inv = db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow | undefined;
  if (!inv || inv.used_at || inv.expires_at < now()) throw new HttpError(404, 'Einladung ungültig oder abgelaufen');
  return inv;
}
