import type { FastifyInstance } from 'fastify';
import {
  checkUsername, createSession, destroyOtherSessions, destroySession, hashPassword, HttpError, loginBlocked, loginFailed, loginSucceeded, requireUser,
  verifyPassword, verifyPasswordOrDummy,
} from '../auth.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { fleetShare, SHARE_MISSIONS } from '../repo/fleets.js';
import { messageShare } from '../repo/messages.js';
import { showOnlineEnabled } from '../repo/presence.js';
import { mergeUser } from '../repo/members.js';

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

  /** Which fleet movements the user shares with the other members of their groups. */
  app.get('/api/auth/fleet-share', async (req) => fleetShare(db, requireUser(req).id));

  app.post<{ Body: { enabled?: boolean; hidden?: number[]; history?: boolean } }>('/api/auth/fleet-share', async (req) => {
    const user = requireUser(req);
    const hidden = Array.isArray(req.body?.hidden) ? [...new Set(req.body.hidden.map(Number))].filter((m) => SHARE_MISSIONS.includes(m)).sort((a, b) => a - b) : [];
    const share = { enabled: req.body?.enabled !== false, hidden, history: req.body?.history !== false };
    db.prepare('UPDATE users SET fleet_share = ? WHERE id = ?').run(JSON.stringify(share), user.id);
    // the others see more or fewer fleets now
    for (const g of db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').pluck().all(user.id) as number[]) {
      events.publish(g, { type: 'data', tables: ['fleets'], userId: user.id });
    }
    return share;
  });

  /** Whether the user shares their player messages with the other members of their groups. */
  app.get('/api/auth/message-share', async (req) => ({ enabled: messageShare(db, requireUser(req).id) }));

  app.post<{ Body: { enabled?: boolean } }>('/api/auth/message-share', async (req) => {
    const user = requireUser(req);
    const enabled = req.body?.enabled === true;
    db.prepare('UPDATE users SET message_share = ? WHERE id = ?').run(enabled ? 1 : 0, user.id);
    for (const g of db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').pluck().all(user.id) as number[]) {
      events.publish(g, { type: 'data', tables: ['player_messages'], userId: user.id });
    }
    return { enabled };
  });

  /** Whether other members see this user as online in the hub (global admins always see the real status). */
  app.get('/api/auth/show-online', async (req) => ({ enabled: showOnlineEnabled(db, requireUser(req).id) }));

  app.post<{ Body: { enabled?: boolean } }>('/api/auth/show-online', async (req) => {
    const user = requireUser(req);
    const enabled = req.body?.enabled !== false;
    db.prepare('UPDATE users SET show_online = ? WHERE id = ?').run(enabled ? 1 : 0, user.id);
    for (const g of db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').pluck().all(user.id) as number[]) {
      events.refreshPresence(g);
    }
    return { enabled };
  });

  /** Invite info for the registration form. */
  app.get<{ Params: { token: string } }>('/api/invites/:token', async (req) => {
    const inv = openInvite(db, req.params.token);
    const group = inv.group_id
      ? db.prepare('SELECT g.name, u.name AS universe FROM groups g JOIN universes u ON u.id = g.universe_id WHERE g.id = ?').get(inv.group_id)
      : null;
    let member: { name: string } | undefined;
    let recovery = false;
    let username: string | undefined;
    if (inv.user_id) {
      const user = db.prepare('SELECT username, password_hash FROM users WHERE id = ?').get(inv.user_id) as
        | { username: string; password_hash: string }
        | undefined;
      if (!user) throw new HttpError(404, 'invite_invalid', 'Invite invalid or expired');
      recovery = user.password_hash !== '';
      username = user.username;
      const row = db
        .prepare('SELECT ingame_name FROM group_members WHERE group_id = ? AND user_id = ?')
        .get(inv.group_id, inv.user_id) as { ingame_name: string | null } | undefined;
      if (row?.ingame_name) member = { name: row.ingame_name };
    }
    return { group, role: inv.role, expiresAt: inv.expires_at, member, recovery, username };
  });

  /**
   * Accepts an invite: creates an account (username + password) or, when logged in,
   * adds the current account to the invite's group.
   */
  app.post<{ Params: { token: string }; Body: { username?: string; password?: string; lang?: string } }>('/api/invites/:token/accept', async (req, reply) => {
    const inv = openInvite(db, req.params.token);
    let userId = req.user?.id;
    let newSession = false;
    db.transaction(() => {
      if (inv.user_id) {
        const hash = db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(inv.user_id) as string | undefined;
        if (hash === undefined) throw new HttpError(404, 'invite_invalid', 'Invite invalid or expired');
        if (hash === '') {
          if (userId) {
            mergeUser(db, inv.user_id, userId);
          } else {
            const username = checkUsername(db, req.body?.username, inv.user_id);
            const password = String(req.body?.password ?? '');
            if (password.length < 8) throw new HttpError(400, 'password_too_short', 'Password must have at least 8 characters');
            db.prepare('UPDATE users SET username = ?, password_hash = ?, lang = ? WHERE id = ?').run(
              username,
              hashPassword(password),
              req.body?.lang === 'en' ? 'en' : 'de',
              inv.user_id,
            );
            userId = inv.user_id;
            newSession = true;
          }
        } else {
          if (userId && userId !== inv.user_id) {
            throw new HttpError(403, 'invite_wrong_account', 'Log out and open the link again, or use the account this link is for');
          }
          const password = String(req.body?.password ?? '');
          if (password.length < 8) throw new HttpError(400, 'password_too_short', 'Password must have at least 8 characters');
          db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), inv.user_id);
          userId = inv.user_id;
          if (!req.user?.id) newSession = true;
        }
      } else {
        if (!userId) {
          const username = checkUsername(db, req.body?.username);
          const password = String(req.body?.password ?? '');
          if (password.length < 8) throw new HttpError(400, 'password_too_short', 'Password must have at least 8 characters');
          userId = Number(
            db
              .prepare('INSERT INTO users (username, password_hash, is_admin, lang) VALUES (?, ?, 0, ?)')
              .run(username, hashPassword(password), req.body?.lang === 'en' ? 'en' : 'de').lastInsertRowid,
          );
          newSession = true;
        }
        if (inv.group_id) {
          db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(inv.group_id, userId, inv.role);
        }
      }
      db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE token = ?').run(userId, now(), inv.token);
    })();
    if (newSession) createSession(db, userId!, reply);
    if (inv.group_id) events.publish(inv.group_id, { type: 'data', tables: ['group_members'] });
    return { ok: true };
  });
}

type InviteRow = { token: string; group_id: number | null; role: string; expires_at: number; used_at: number | null; user_id: number | null };

function openInvite(db: DB, token: string): InviteRow {
  const inv = db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow | undefined;
  if (!inv || inv.used_at || inv.expires_at < now()) throw new HttpError(404, 'invite_invalid', 'Invite invalid or expired');
  return inv;
}
