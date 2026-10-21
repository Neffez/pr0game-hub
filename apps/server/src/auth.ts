import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { now, type DB } from './db.js';

export const SESSION_COOKIE = 'hub_session';

export interface SessionUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(db: DB, userId: number, reply: FastifyReply) {
  const token = randomToken();
  const expires = now() + config.sessionDays * 86400;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), userId);
  reply.setCookie(SESSION_COOKIE, token, {
    path: config.basePath || '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: config.sessionDays * 86400,
  });
}

export function destroySession(db: DB, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  reply.clearCookie(SESSION_COOKIE, { path: config.basePath || '/' });
}

export function loadSessionUser(db: DB, req: FastifyRequest): SessionUser | null {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), now()) as { id: number; username: string; is_admin: number } | undefined;
  return row ? { id: row.id, username: row.username, isAdmin: !!row.is_admin } : null;
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Nicht angemeldet');
  return req.user;
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const user = requireUser(req);
  if (!user.isAdmin) throw new HttpError(403, 'Nur für Admins');
  return user;
}

/** Creates the bootstrap admin on first start when configured and no user exists yet. */
export function bootstrapAdmin(db: DB, log: { info: (msg: string) => void }) {
  const { username, password } = config.adminBootstrap;
  if (!username || !password) return;
  const count = db.prepare('SELECT COUNT(*) FROM users').pluck().get() as number;
  if (count > 0) return;
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run(username, hashPassword(password));
  log.info(`bootstrap admin "${username}" created`);
}
