import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let admin: Record<string, string>;
let groupId = 0;
let placeholder = 0;

const request = (payload: object, ip = '10.0.0.1') =>
  app.inject({ method: 'POST', url: '/hub/api/access-requests', payload, remoteAddress: ip });
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const login = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'admin', password: 'adminpass' } });
  admin = { cookie: `hub_session=${login.cookies.find((c) => c.name === 'hub_session')!.value}` };
  await call('POST', '/admin/universes', admin, { slug: 'u8', name: 'Universum 8' });
  groupId = (await call('POST', '/admin/groups', admin, { universe: 'u8', name: 'A' })).json().id;
  placeholder = (await call('POST', `/admin/groups/${groupId}/members`, admin, { name: 'Bob' })).json().id;
});

describe('access requests', () => {
  it('validates the request and rejects a taken username', async () => {
    expect((await request({ username: 'x', password: 'longenough' })).statusCode).toBe(400);
    expect((await request({ username: 'bobby', password: 'short' })).statusCode).toBe(400);
    expect((await request({ username: 'admin', password: 'longenough' })).statusCode).toBe(409);
    expect((await request({ username: 'bobby', password: 'longenough', message: 'x'.repeat(501) })).statusCode).toBe(400);
  });

  it('is visible to global admins only and assigned to a player without an account', async () => {
    expect((await request({ username: 'bobby', password: 'longenough', message: 'Hi, I am Bob', lang: 'en' })).statusCode).toBe(200);
    expect((await request({ username: 'bobby', password: 'longenough' })).statusCode).toBe(409);
    expect((await call('GET', '/admin/access-requests', {})).statusCode).toBe(401);

    const list = (await call('GET', '/admin/access-requests', admin)).json();
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0]).toMatchObject({ username: 'bobby', message: 'Hi, I am Bob' });
    expect(list.requests[0].password_hash).toBeUndefined();
    expect(list.placeholders.map((p: { id: number }) => p.id)).toContain(placeholder);

    // players with an account can't be taken over
    const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get();
    expect((await call('POST', `/admin/access-requests/${list.requests[0].id}/assign`, admin, { userId: adminId })).statusCode).toBe(400);

    expect((await call('POST', `/admin/access-requests/${list.requests[0].id}/assign`, admin, { userId: placeholder })).statusCode).toBe(200);
    expect((await call('GET', '/admin/access-requests', admin)).json().requests).toHaveLength(0);
    // the claim link of the player is gone, the requested login works
    expect(db.prepare('SELECT COUNT(*) FROM invites WHERE user_id = ?').pluck().get(placeholder)).toBe(0);
    const login = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'bobby', password: 'longenough' } });
    expect(login.statusCode).toBe(200);
  });

  it('can reject a request', async () => {
    await request({ username: 'carl', password: 'longenough' });
    const [r] = (await call('GET', '/admin/access-requests', admin)).json().requests;
    expect((await call('DELETE', `/admin/access-requests/${r.id}`, admin)).statusCode).toBe(200);
    expect((await call('DELETE', `/admin/access-requests/${r.id}`, admin)).statusCode).toBe(404);
  });

  it('limits requests per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request({ username: `spam${i}`, password: 'longenough' }, '10.0.0.9')).statusCode);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
  });
});
