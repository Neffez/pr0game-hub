import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword, MAX_PASSWORD_LENGTH } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'hub_session')!;
  return { cookie: `hub_session=${cookie.value}` };
}

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
});

describe('auth', () => {
  it('rejects oversized passwords before hashing', async () => {
    const huge = 'x'.repeat(MAX_PASSWORD_LENGTH + 1);
    const loginRes = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'admin', password: huge } });
    expect(loginRes.statusCode).toBe(400);
    expect(loginRes.json().code).toBe('password_too_long');

    const access = await app.inject({
      method: 'POST',
      url: '/hub/api/access-requests',
      payload: { username: 'toolong', password: huge, message: 'Hi' },
    });
    expect(access.statusCode).toBe(400);
    expect(access.json().code).toBe('password_too_long');

    const headers = await login('admin', 'adminpass');
    const change = await app.inject({
      method: 'POST',
      url: '/hub/api/auth/password',
      headers,
      payload: { oldPassword: 'adminpass', newPassword: huge },
    });
    expect(change.statusCode).toBe(400);
    expect(change.json().code).toBe('password_too_long');
  });

  it('treats placeholder accounts like unknown users (wrong password, no instant reject)', async () => {
    const id = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES (?, '')").run('placeholder').lastInsertRowid);
    const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'placeholder', password: 'anypass12' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('login_failed');
    expect(db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(id)).toBe('');
  });

  it('revokes API tokens when the password changes', async function () {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('changer', hashPassword('oldpass12'));
    const headers = await login('changer', 'oldpass12');
    const created = await app.inject({ method: 'POST', url: '/hub/api/auth/tokens', headers, payload: { name: 'keep' } });
    expect(created.statusCode).toBe(200);
    const { token } = created.json();
    const bearer = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: bearer })).json().user.username).toBe('changer');

    const change = await app.inject({
      method: 'POST',
      url: '/hub/api/auth/password',
      headers,
      payload: { oldPassword: 'oldpass12', newPassword: 'newpass12' },
    });
    expect(change.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: bearer })).json().user).toBeNull();
    expect(db.prepare("SELECT COUNT(*) FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE u.username = 'changer'").pluck().get()).toBe(0);
    expect((await login('changer', 'newpass12')).cookie).toBeTruthy();
  });

  it('clears the session cookie with the same flags it was set with', async () => {
    const signedIn = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'admin', password: 'adminpass' } });
    const set = signedIn.cookies.find((c) => c.name === 'hub_session')!;
    const out = await app.inject({
      method: 'POST',
      url: '/hub/api/auth/logout',
      headers: { cookie: `hub_session=${set.value}` },
    });
    expect(out.statusCode).toBe(200);
    const cleared = out.cookies.find((c) => c.name === 'hub_session')!;
    expect(cleared.value).toBe('');
    expect(cleared.path).toBe(set.path);
    expect(cleared.httpOnly).toBe(true);
    expect(String(cleared.sameSite).toLowerCase()).toBe('lax');
    expect(cleared.secure).toBe(set.secure);
  });
});
