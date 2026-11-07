import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let admin: Record<string, string>;
let lead: Record<string, string>;
let oldGroup = 0;
let newGroup = 0;
let otherGroup = 0;
let player = 0;
let placeholder = 0;
let stranger = 0;

const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });
const login = async (username: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return { cookie: `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}` };
};
const userCount = () => db.prepare('SELECT COUNT(*) FROM users').pluck().get() as number;
const memberOf = (userId: number) => db.prepare('SELECT group_id FROM group_members WHERE user_id = ? ORDER BY group_id').pluck().all(userId);

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  admin = await login('admin', 'adminpass');
  await call('POST', '/admin/universes', admin, { slug: 'u7', name: 'Universum 7' });
  await call('POST', '/admin/universes', admin, { slug: 'u8', name: 'Universum 8' });
  oldGroup = (await call('POST', '/admin/groups', admin, { universe: 'u7', name: 'A' })).json().id;
  newGroup = (await call('POST', '/admin/groups', admin, { universe: 'u8', name: 'A' })).json().id;
  otherGroup = (await call('POST', '/admin/groups', admin, { universe: 'u7', name: 'B' })).json().id;

  // alliance admin "lead" of A in u7 and u8, a player with an account and a placeholder in A of u7
  const leadId = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('lead', ?)").run(hashPassword('leadpass')).lastInsertRowid);
  for (const g of [oldGroup, newGroup]) db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(g, leadId);
  lead = await login('lead', 'leadpass');
  player = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('carol', ?)").run(hashPassword('carolpass')).lastInsertRowid);
  db.prepare("INSERT INTO group_members (group_id, user_id, role, ingame_name) VALUES (?, ?, 'member', 'Carola')").run(oldGroup, player);
  placeholder = (await call('POST', `/admin/groups/${oldGroup}/members`, admin, { name: 'Bob' })).json().id;
  stranger = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('dave', ?)").run(hashPassword('davepass')).lastInsertRowid);
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(otherGroup, stranger);
});

describe('assigning existing accounts', () => {
  it('lists the accounts an admin may add, without the members', async () => {
    const all = (await call('GET', `/admin/groups/${newGroup}/candidates`, admin)).json() as { id: number; ingameName: string | null; groups: string[] }[];
    expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([player, placeholder, stranger]));
    expect(all.find((c) => c.id === player)).toMatchObject({ ingameName: 'Carola', account: true, groups: ['u7 · A'] });
    expect(all.find((c) => c.id === placeholder)).toMatchObject({ ingameName: 'Bob', account: false });
    // the alliance admin only sees members of their own alliances
    const own = (await call('GET', `/admin/groups/${newGroup}/candidates`, lead)).json() as { id: number }[];
    expect(own.map((c) => c.id).sort()).toEqual([player, placeholder].sort());
    expect((await call('GET', `/admin/groups/${otherGroup}/candidates`, lead)).statusCode).toBe(403);
  });

  it('adds the account to the alliance of another universe without a new account', async () => {
    const before = userCount();
    const res = await call('POST', `/admin/groups/${newGroup}/members`, lead, { userId: player });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: player });
    expect(userCount()).toBe(before);
    expect(memberOf(player)).toEqual([oldGroup, newGroup]);
    expect(db.prepare('SELECT ingame_name FROM group_members WHERE group_id = ? AND user_id = ?').pluck().get(newGroup, player)).toBe('Carola');
    expect((await call('POST', `/admin/groups/${newGroup}/members`, lead, { userId: player })).statusCode).toBe(409);
    // accounts outside the alliance admin's alliances can't be added
    expect((await call('POST', `/admin/groups/${newGroup}/members`, lead, { userId: stranger })).statusCode).toBe(404);
  });

  it('keeps a placeholder that is still in another alliance', async () => {
    expect((await call('POST', `/admin/groups/${newGroup}/members`, lead, { userId: placeholder, ingameName: 'Bobby' })).statusCode).toBe(200);
    expect(db.prepare('SELECT ingame_name FROM group_members WHERE group_id = ? AND user_id = ?').pluck().get(newGroup, placeholder)).toBe('Bobby');
    const members = (await call('GET', `/admin/groups/${newGroup}/members`, lead)).json() as { id: number; other_groups: number }[];
    expect(members.find((m) => m.id === placeholder)!.other_groups).toBe(1);

    expect((await call('DELETE', `/admin/groups/${oldGroup}/members/${placeholder}`, lead)).statusCode).toBe(200);
    expect(memberOf(placeholder)).toEqual([newGroup]);
    expect(db.prepare('SELECT COUNT(*) FROM invites WHERE group_id = ? AND user_id = ? AND used_at IS NULL').pluck().get(oldGroup, placeholder)).toBe(0);
    // the last membership takes the placeholder with it
    expect((await call('DELETE', `/admin/groups/${newGroup}/members/${placeholder}`, lead)).statusCode).toBe(200);
    expect(db.prepare('SELECT 1 FROM users WHERE id = ?').get(placeholder)).toBeUndefined();
  });
});

describe('placeholders shared by several alliances', () => {
  it('are handed out only by admins of all their alliances', async () => {
    // "Eve" in A of u7 and A of u8; "solo" is admin of A in u8 only
    const shared = (await call('POST', `/admin/groups/${oldGroup}/members`, admin, { name: 'Eve' })).json().id as number;
    expect((await call('POST', `/admin/groups/${newGroup}/members`, lead, { userId: shared })).statusCode).toBe(200);
    const soloId = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('solo', ?)").run(hashPassword('solopass')).lastInsertRowid);
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(newGroup, soloId);
    const solo = await login('solo', 'solopass');

    // a claim link would make its user a member of A in u7 too
    expect((await call('POST', `/admin/groups/${newGroup}/members/${shared}/invite`, solo)).statusCode).toBe(403);
    expect(db.prepare('SELECT COUNT(*) FROM invites WHERE user_id = ? AND used_at IS NULL').pluck().get(shared)).toBe(1);
    expect((await call('POST', `/admin/groups/${newGroup}/members/${shared}/invite`, lead)).statusCode).toBe(200);

    // the same for access requests: not offered, not assignable
    const asked = await app.inject({ method: 'POST', url: '/hub/api/access-requests', payload: { username: 'evelyn', password: 'longenough', message: 'Eve here' } });
    expect(asked.statusCode).toBe(200);
    const list = (await call('GET', '/admin/access-requests', solo)).json() as { requests: { id: number }[]; placeholders: { id: number }[] };
    expect(list.placeholders.map((p) => p.id)).not.toContain(shared);
    const requestId = list.requests[0].id;
    expect((await call('POST', `/admin/access-requests/${requestId}/assign`, solo, { userId: shared })).statusCode).toBe(403);
    expect((await call('GET', '/admin/access-requests', lead)).json().placeholders.map((p: { id: number }) => p.id)).toContain(shared);
    expect((await call('POST', `/admin/access-requests/${requestId}/assign`, lead, { userId: shared })).statusCode).toBe(200);
  });
});
