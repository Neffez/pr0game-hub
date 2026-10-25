import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let groupA = 0;
let groupB = 0;
let playerA = 0;
let playerB = 0;
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
  playerA = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Victim')").run(groupA).lastInsertRowid);
  playerB = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Victim')").run(groupB).lastInsertRowid);
  const carolCookie = await login('carol', 'carolpass');
  admin = { cookie: adminCookie, 'x-hub-group': String(groupA) };
  carol = { cookie: carolCookie, 'x-hub-group': String(groupA) };
  carolB = { cookie: carolCookie, 'x-hub-group': String(groupB) };
});

describe('comments', () => {
  it('keeps threads per player and per planet or moon, within the alliance', async () => {
    expect((await call('POST', '/comments', carol, { player: playerA, body: '  Saved fleet at 3 am  ' })).statusCode).toBe(200);
    expect((await call('POST', '/comments', admin, { player: playerA, body: 'Has a phalanx' })).statusCode).toBe(200);
    expect((await call('POST', '/comments', carol, { c: '1:234:5', type: 'moon', body: 'Moon with jump gate' })).statusCode).toBe(200);

    const thread = (await call('GET', `/comments?player=${playerA}`, admin)).json();
    expect(thread.map((c: any) => [c.member, c.body])).toEqual([['Carol', 'Saved fleet at 3 am'], ['admin', 'Has a phalanx']]);
    expect((await call('GET', '/comments?c=1:234:5&type=moon', admin)).json()).toHaveLength(1);
    expect((await call('GET', '/comments?c=1:234:5', admin)).json()).toEqual([]);
    expect((await call('GET', '/comments/counts', admin)).json()).toEqual({ players: { [playerA]: 2 }, plans: {}, planets: { '1:234:5:moon': 1 } });

    // another alliance: neither its players' threads nor its comments are reachable
    expect((await call('GET', `/comments?player=${playerA}`, carolB)).statusCode).toBe(404);
    expect((await call('POST', '/comments', carolB, { player: playerA, body: 'x' })).statusCode).toBe(404);
    expect((await call('GET', '/comments?c=1:234:5&type=moon', carolB)).json()).toEqual([]);
    expect((await call('GET', '/comments/counts', carolB)).json()).toEqual({ players: {}, plans: {}, planets: {} });
    expect((await call('GET', `/comments?player=${playerB}`, carolB)).json()).toEqual([]);
  });

  it('keeps a thread per loot settlement of a plan, within the alliance', async () => {
    const userId = db.prepare("SELECT id FROM users WHERE username = 'carol'").pluck().get();
    const insert = db.prepare("INSERT INTO attack_plans (group_id, user_id, g, s, p, planet_type, target_time) VALUES (?, ?, 1, 2, 3, 'planet', 1000)");
    const planA = Number(insert.run(groupA, userId).lastInsertRowid);
    const planB = Number(insert.run(groupB, userId).lastInsertRowid);
    expect((await call('POST', '/comments', carol, { plan: planA, body: 'Deut share looks off' })).statusCode).toBe(200);
    expect((await call('POST', '/comments', admin, { plan: planA, body: 'Fixed' })).statusCode).toBe(200);
    expect((await call('GET', `/comments?plan=${planA}`, admin)).json().map((c: any) => c.body)).toEqual(['Deut share looks off', 'Fixed']);
    expect((await call('GET', '/comments/counts', admin)).json().plans).toEqual({ [planA]: 2 });
    // the plan of another alliance is not reachable; the thread does not mix with the plan's coordinates
    expect((await call('GET', `/comments?plan=${planB}`, carol)).statusCode).toBe(404);
    expect((await call('POST', '/comments', carol, { plan: planB, body: 'x' })).statusCode).toBe(404);
    expect((await call('GET', '/comments?c=1:2:3', carol)).json()).toEqual([]);
  });

  it('lets the author edit, the author or an admin delete', async () => {
    const [own, other] = (await call('GET', `/comments?player=${playerA}`, carol)).json();
    expect((await call('PUT', `/comments/${other.id}`, carol, { body: 'mine now' })).statusCode).toBe(403);
    expect((await call('DELETE', `/comments/${other.id}`, carol)).statusCode).toBe(403);
    expect((await call('PUT', `/comments/${own.id}`, carol, { body: 'Saves fleet at 3 am' })).statusCode).toBe(200);
    // admins delete, but don't edit others' words
    expect((await call('PUT', `/comments/${own.id}`, admin, { body: 'x' })).statusCode).toBe(403);
    expect((await call('DELETE', `/comments/${own.id}`, admin)).statusCode).toBe(200);
    const thread = (await call('GET', `/comments?player=${playerA}`, carol)).json();
    expect(thread.map((c: any) => c.body)).toEqual(['Has a phalanx']);
    expect((await call('DELETE', `/comments/${own.id}`, carol)).statusCode).toBe(404);
  });

  it('validates the text and the target', async () => {
    expect((await call('POST', '/comments', carol, { player: playerA, body: '   ' })).json().code).toBe('comment_empty');
    expect((await call('POST', '/comments', carol, { player: playerA, body: 'x'.repeat(2001) })).json().code).toBe('comment_too_long');
    expect((await call('POST', '/comments', carol, { c: '1:234:99', body: 'x' })).json().code).toBe('coords_invalid');
  });
});
