import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let groupA = 0;
let groupB = 0;
let admin: Record<string, string>;
let carol: Record<string, string>;
let carolB: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api/u8${url}`, headers, payload });

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass'));
  const adminCookie = await login('admin', 'adminpass');
  const h = { headers: { cookie: adminCookie } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  groupB = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, ...h })).json().id;
  const carolId = db.prepare("SELECT id FROM users WHERE username = 'carol'").pluck().get();
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(groupA, carolId);
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupB, carolId);
  const carolCookie = await login('carol', 'carolpass');
  admin = { cookie: adminCookie, 'x-hub-group': String(groupA) };
  carol = { cookie: carolCookie, 'x-hub-group': String(groupA) };
  carolB = { cookie: carolCookie, 'x-hub-group': String(groupB) };
});

describe('target claims', () => {
  it('claims a target once per alliance', async () => {
    const res = await call('POST', '/claims', carol, { g: 1, s: 234, p: 5, type: 'planet', kind: 'farm', minutes: 60, note: ' Deff weg ' });
    expect(res.statusCode).toBe(200);
    const list = (await call('GET', '/claims', admin)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ g: 1, s: 234, p: 5, planet_type: 'planet', kind: 'farm', member: 'Carol', note: 'Deff weg' });
    expect(list[0].expires_at - list[0].created_at).toBe(3600);

    // the moon is another target; the planet is taken
    expect((await call('POST', '/claims', admin, { g: 1, s: 234, p: 5, type: 'moon' })).statusCode).toBe(200);
    const taken = await call('POST', '/claims', admin, { g: 1, s: 234, p: 5, type: 'planet' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe('target_claimed');
    // other alliances don't see it and may claim the same target
    expect((await call('GET', '/claims', carolB)).json()).toEqual([]);
    expect((await call('POST', '/claims', carolB, { g: 1, s: 234, p: 5 })).statusCode).toBe(200);
  });

  it('lets group admins take a target over, members only change their own', async () => {
    const theirs = (await call('GET', '/claims', admin)).json().find((c: any) => c.planet_type === 'moon');
    expect((await call('DELETE', `/claims/${theirs.id}`, carol)).statusCode).toBe(403);
    expect((await call('PUT', `/claims/${theirs.id}`, carol, { minutes: 30 })).statusCode).toBe(403);

    const taken = await call('POST', '/claims', admin, { g: 1, s: 234, p: 5, type: 'planet', kind: 'attack', force: true });
    expect(taken.statusCode).toBe(200);
    const list = (await call('GET', '/claims', carol)).json();
    expect(list.filter((c: any) => c.planet_type === 'planet').map((c: any) => [c.member, c.kind])).toEqual([['admin', 'attack']]);
  });

  it('extends, releases and lets claims expire', async () => {
    const mine = (await call('POST', '/claims', carol, { g: 2, s: 1, p: 1, minutes: 10 })).json();
    expect((await call('PUT', `/claims/${mine.id}`, carol, { minutes: 300, note: 'später' })).statusCode).toBe(200);
    let row = (await call('GET', '/claims', carol)).json().find((c: any) => c.id === mine.id);
    expect(row.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(290 * 60);
    expect(row.note).toBe('später');

    expect((await call('PUT', `/claims/${mine.id}`, carol, { minutes: 24 * 60 + 1 })).json().code).toBe('claim_duration_invalid');
    expect((await call('DELETE', `/claims/${mine.id}`, carol)).statusCode).toBe(200);
    expect((await call('DELETE', `/claims/${mine.id}`, carol)).statusCode).toBe(404);

    const old = (await call('POST', '/claims', carol, { g: 2, s: 1, p: 2 })).json();
    db.prepare('UPDATE target_claims SET expires_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 1, old.id);
    row = (await call('GET', '/claims', carol)).json().find((c: any) => c.id === old.id);
    expect(row).toBeUndefined();
    // an expired claim doesn't block the target
    expect((await call('POST', '/claims', admin, { g: 2, s: 1, p: 2 })).statusCode).toBe(200);
  });

  it('validates coordinates', async () => {
    expect((await call('POST', '/claims', carol, { g: 9, s: 1, p: 1 })).json().code).toBe('coords_invalid');
    expect((await call('POST', '/claims', carol, { g: 1, s: 1, p: 16 })).json().code).toBe('coords_invalid');
  });
});
