import type { FastifyInstance } from 'fastify';
import {
  checkUsername, createSession, destroyOtherSessions, destroySession, hashPassword, HttpError, loginBlocked, loginFailed, loginSucceeded, requireUser,
  verifyPassword, verifyPasswordOrDummy,
} from '../auth.js';
import { now, type DB } from '../db.js';

/** Failed logins per IP (any username) within the window; the per-username limit is 10. */
const IP_LIMIT = 30;

export function authRoutes(app: FastifyInstance, db: DB) {
  app.post<{ Body: { username: string; password: string } }>('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? ({} as never);
    const key = `${req.ip}|${String(username ?? '').toLowerCase()}`;
    const ipKey = `${req.ip}|`;
    if (loginBlocked(key) || loginBlocked(ipKey, IP_LIMIT)) throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts, please try again later');
    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(String(username ?? '')) as
      | { id: number; password_hash: string }
      | undefined;
    if (!(await verifyPasswordOrDummy(String(password ?? ''), user?.password_hash)) || !user) {
      loginFailed(key);
      loginFailed(ipKey);
      throw new HttpError(401, 'login_failed', 'Wrong username or password');
    }
    loginSucceeded(key);
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
    if (!(await verifyPassword(String(oldPassword ?? ''), hash))) throw new HttpError(400, 'old_password_wrong', 'Old password wrong');
    if (String(newPassword ?? '').length < 8) throw new HttpError(400, 'password_too_short', 'Password must have at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(newPassword)), user.id);
    destroyOtherSessions(db, user.id, req);
    return { ok: true };
  });

  app.post<{ Body: { username: string; password: string } }>('/api/auth/username', async (req) => {
    const user = requireUser(req);
    const hash = db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(user.id) as string;
    if (!(await verifyPassword(String(req.body?.password ?? ''), hash))) throw new HttpError(400, 'password_wrong', 'Wrong password');
    const username = checkUsername(db, req.body?.username, user.id);
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, user.id);
    return { ok: true, username };
  });

  app.post<{ Body: { lang: string } }>('/api/auth/lang', async (req) => {
    const user = requireUser(req);
    const lang = String(req.body?.lang ?? '');
    if (lang !== 'de' && lang !== 'en') throw new HttpError(400, 'lang_invalid', 'Invalid language');
    db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, user.id);
    return { ok: true, lang };
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
  app.post<{ Params: { token: string }; Body: { username?: string; password?: string; lang?: string } }>('/api/invites/:token/accept', async (req, reply) => {
    const inv = openInvite(db, req.params.token);
    let userId = req.user?.id;
    db.transaction(() => {
      if (!userId) {
        const username = checkUsername(db, req.body?.username);
        const password = String(req.body?.password ?? '');
        if (password.length < 8) throw new HttpError(400, 'password_too_short', 'Password must have at least 8 characters');
        userId = Number(
          db
            .prepare('INSERT INTO users (username, password_hash, is_admin, lang) VALUES (?, ?, 0, ?)')
            .run(username, hashPassword(password), req.body?.lang === 'en' ? 'en' : 'de').lastInsertRowid,
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
  if (!inv || inv.used_at || inv.expires_at < now()) throw new HttpError(404, 'invite_invalid', 'Invite invalid or expired');
  return inv;
}
