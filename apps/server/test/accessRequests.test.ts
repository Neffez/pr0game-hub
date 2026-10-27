import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const pushed: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
const posted: { url: string; message: { embeds: { title: string; description: string }[] } }[] = [];
const app = buildApp(db, {
  logger: false,
  push: {
    contact: 'mailto:hub@example.com',
    sender: async (target, payload) => (pushed.push({ endpoint: target.endpoint, payload: JSON.parse(payload) }), 201),
  },
  discord: { sender: vi.fn(async (url: string, message: never) => (posted.push({ url, message }), { status: 204 })) },
});
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
    expect((await request({ username: 'bobby', password: 'short', message: 'Hi' })).statusCode).toBe(400);
    expect((await request({ username: 'bobby', password: 'longenough' })).statusCode).toBe(400);
    expect((await request({ username: 'bobby', password: 'longenough', message: '  ' })).statusCode).toBe(400);
    expect((await request({ username: 'admin', password: 'longenough', message: 'Hi' })).statusCode).toBe(409);
    expect((await request({ username: 'bobby', password: 'longenough', message: 'x'.repeat(501) })).statusCode).toBe(400);
  });

  it('is visible to global admins only and assigned to a player without an account', async () => {
    expect((await request({ username: 'bobby', password: 'longenough', message: 'Hi, I am Bob', lang: 'en' })).statusCode).toBe(200);
    expect((await request({ username: 'bobby', password: 'longenough', message: 'Hi' })).statusCode).toBe(409);
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

  it('notifies global admins by push and Discord, as far as they want it', async () => {
    const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get();
    db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, 0)').run(adminId, 'https://push.example/admin', 'B'.repeat(87), 'a'.repeat(22));
    db.prepare('UPDATE users SET discord_webhook = ? WHERE id = ?').run(`https://discord.com/api/webhooks/123456789012345678/${'T'.repeat(68)}`, adminId);
    const wait = () => vi.waitFor(() => expect(pushed.length).toBeGreaterThan(0));

    expect((await request({ username: 'dora', password: 'longenough', message: 'Dora here' }, '10.0.1.1')).statusCode).toBe(200);
    await wait();
    expect(pushed[0].endpoint).toBe('https://push.example/admin');
    expect(pushed[0].payload).toMatchObject({ title: expect.stringContaining('dora'), body: 'Dora here', url: '/hub/admin' });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].message.embeds[0].title).toContain('dora');

    // switched off per channel
    pushed.length = posted.length = 0;
    db.prepare('UPDATE users SET push_prefs = ?, discord_prefs = ? WHERE id = ?').run('{"accessRequests":false}', '{"accessRequests":false}', adminId);
    await request({ username: 'emil', password: 'longenough', message: 'Emil here' }, '10.0.1.2');
    await new Promise((r) => setTimeout(r, 50));
    expect(pushed).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it('lets alliance admins assign to players of their own alliance only', async () => {
    db.prepare("INSERT INTO users (username, password_hash) VALUES ('lena', ?)").run(hashPassword('lenapass'));
    const lena = db.prepare("SELECT id FROM users WHERE username = 'lena'").pluck().get();
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(groupId, lena);
    const other = (await call('POST', '/admin/groups', admin, { universe: 'u8', name: 'B' })).json().id;
    const stranger = (await call('POST', `/admin/groups/${other}/members`, admin, { name: 'Stranger' })).json().id;
    const own = (await call('POST', `/admin/groups/${groupId}/members`, admin, { name: 'Own' })).json().id;
    const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'lena', password: 'lenapass' } });
    const lenaH = { cookie: `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}` };
    const member = db.prepare("INSERT INTO users (username, password_hash) VALUES ('norma', ?)").run(hashPassword('normapass')).lastInsertRowid;
    db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)").run(groupId, member);
    const normaLogin = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'norma', password: 'normapass' } });
    const normaH = { cookie: `hub_session=${normaLogin.cookies.find((c) => c.name === 'hub_session')!.value}` };

    await request({ username: 'frida', password: 'longenough', message: 'Frida' }, '10.0.2.1');
    const list = (await call('GET', '/admin/access-requests', lenaH)).json();
    const frida = list.requests.find((r: { username: string }) => r.username === 'frida');
    expect(frida).toBeTruthy();
    const ids = list.placeholders.map((p: { id: number }) => p.id);
    expect(ids).toContain(own);
    expect(ids).not.toContain(stranger);
    // plain members have no access, rejecting is for global admins
    expect((await call('GET', '/admin/access-requests', normaH)).statusCode).toBe(403);
    expect((await call('DELETE', `/admin/access-requests/${frida.id}`, lenaH)).statusCode).toBe(403);
    expect((await call('POST', `/admin/access-requests/${frida.id}/assign`, lenaH, { userId: stranger })).statusCode).toBe(403);
    expect((await call('POST', `/admin/access-requests/${frida.id}/assign`, lenaH, { userId: own })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'frida', password: 'longenough' } })).statusCode).toBe(200);
  });

  it('can reject a request', async () => {
    await request({ username: 'carl', password: 'longenough', message: 'Hi' });
    const [r] = (await call('GET', '/admin/access-requests', admin)).json().requests;
    expect((await call('DELETE', `/admin/access-requests/${r.id}`, admin)).statusCode).toBe(200);
    expect((await call('DELETE', `/admin/access-requests/${r.id}`, admin)).statusCode).toBe(404);
  });

  it('limits requests per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request({ username: `spam${i}`, password: 'longenough', message: 'Hi' }, '10.0.0.9')).statusCode);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
  });
});
