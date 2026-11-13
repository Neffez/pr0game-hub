import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let admin: Record<string, string>;
let lead: Record<string, string>;
let carol: Record<string, string>;
let dave: Record<string, string>;
let group = 0;
let carolId = 0;
let daveId = 0;
let leadId = 0;
let playerCarol = 0;

const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });
const login = async (username: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return { cookie: `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}` };
};

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  admin = await login('admin', 'adminpass');
  await call('POST', '/admin/universes', admin, { slug: 'u8', name: 'Universum 8' });
  group = (await call('POST', '/admin/groups', admin, { universe: 'u8', name: 'A' })).json().id;
  leadId = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('lead', ?)").run(hashPassword('leadpass')).lastInsertRowid);
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(group, leadId);
  lead = { ...(await login('lead', 'leadpass')) };
  carolId = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('carol', ?)").run(hashPassword('carolpass')).lastInsertRowid);
  daveId = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('dave', ?)").run(hashPassword('davepass')).lastInsertRowid);
  db.prepare("INSERT INTO group_members (group_id, user_id, role, ingame_name) VALUES (?, ?, 'member', 'Carol')").run(group, carolId);
  db.prepare("INSERT INTO group_members (group_id, user_id, role, ingame_name) VALUES (?, ?, 'member', 'Dave')").run(group, daveId);
  playerCarol = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Carol')").run(group).lastInsertRowid);
  carol = { ...(await login('carol', 'carolpass')), 'x-hub-group': String(group) };
  dave = { ...(await login('dave', 'davepass')), 'x-hub-group': String(group) };
  lead = { ...lead, 'x-hub-group': String(group) };
});

describe('display name', () => {
  it('is empty by default and falls back to the username, without a password', async () => {
    expect((await call('GET', '/auth/display-name', carol)).json()).toEqual({ displayName: null });
    const ctx = (await call('GET', '/u8/context', carol)).json();
    expect(ctx.members.find((m: { id: number }) => m.id === carolId)).toMatchObject({
      username: 'carol', name: 'carol', display_name: null, ingame_name: 'Carol',
    });
    expect((await call('POST', '/u8/comments', carol, { player: playerCarol, body: 'hello' })).statusCode).toBe(200);
    const thread = (await call('GET', `/u8/comments?player=${playerCarol}`, dave)).json();
    expect(thread[0].member).toBe('carol');
  });

  it('rejects invalid values and accepts unicode without a password', async () => {
    expect((await call('POST', '/auth/display-name', carol, { displayName: 'has@at' })).json().code).toBe('display_name_invalid');
    expect((await call('POST', '/auth/display-name', carol, { displayName: 'x'.repeat(33) })).json().code).toBe('display_name_invalid');
    expect((await call('POST', '/auth/display-name', carol, { displayName: 'bad\nname' })).json().code).toBe('display_name_invalid');
    expect((await call('POST', '/auth/display-name', carol, { displayName: 'Ärzte Nick_1' })).json()).toEqual({ displayName: 'Ärzte Nick_1' });
    expect((await call('GET', '/auth/display-name', carol)).json()).toEqual({ displayName: 'Ärzte Nick_1' });
    const ctx = (await call('GET', '/u8/context', dave)).json();
    expect(ctx.members.find((m: { id: number }) => m.id === carolId).name).toBe('Ärzte Nick_1');
  });

  it('allows the same display name twice and clears back to the username', async () => {
    expect((await call('POST', '/auth/display-name', dave, { displayName: 'Ärzte Nick_1' })).statusCode).toBe(200);
    expect((await call('POST', '/auth/display-name', carol, { displayName: '   ' })).json()).toEqual({ displayName: null });
    const ctx = (await call('GET', '/u8/context', carol)).json();
    expect(ctx.members.find((m: { id: number }) => m.id === carolId).name).toBe('carol');
    expect(ctx.members.find((m: { id: number }) => m.id === daveId).name).toBe('Ärzte Nick_1');
    await call('POST', '/auth/display-name', dave, { displayName: '' });
  });

  it('lets an alliance admin set it, not the login username', async () => {
    expect((await call('PUT', `/admin/groups/${group}/members/${carolId}`, lead, { displayName: 'Neffez' })).statusCode).toBe(200);
    expect((await call('PUT', `/admin/users/${carolId}`, lead, { username: 'hacked' })).statusCode).toBe(403);
    const members = (await call('GET', `/admin/groups/${group}/members`, lead)).json() as { id: number; username: string; display_name: string | null }[];
    expect(members.find((m) => m.id === carolId)).toMatchObject({ username: 'carol', display_name: 'Neffez' });
    expect((await call('GET', '/u8/context', dave)).json().members.find((m: { id: number }) => m.id === carolId).name).toBe('Neffez');
  });

  it('notifies @display, @ingame and @username', async () => {
    await call('POST', '/auth/display-name', carol, { displayName: 'Neffez' });
    const player = (await call('POST', '/u8/comments', dave, { c: '1:10:4', type: 'planet', body: '@Neffez look' })).statusCode;
    expect(player).toBe(200);
    const bell = (await call('GET', '/u8/notifications', carol)).json().filter((n: { kind: string; thread?: { p?: number } }) => n.kind === 'comment' && n.thread?.p === 4);
    expect(bell).toMatchObject([{ member: 'dave', mention: true }]);
    expect((await call('POST', '/u8/comments', dave, { c: '1:10:5', type: 'planet', body: '@Carol also' })).statusCode).toBe(200);
    expect(
      (await call('GET', '/u8/notifications', carol)).json().filter((n: { kind: string; thread?: { p?: number } }) => n.kind === 'comment' && n.thread?.p === 5),
    ).toMatchObject([{ mention: true }]);
    expect((await call('POST', '/u8/comments', dave, { c: '1:10:6', type: 'planet', body: '@carol too' })).statusCode).toBe(200);
    expect(
      (await call('GET', '/u8/notifications', carol)).json().filter((n: { kind: string; thread?: { p?: number } }) => n.kind === 'comment' && n.thread?.p === 6),
    ).toMatchObject([{ mention: true }]);
  });

  it('keeps matching, invites and placeholders on the in-game name', async () => {
    await call('POST', '/auth/display-name', carol, { displayName: 'Neffez' });
    const ctx = (await call('GET', '/u8/context', carol)).json();
    expect(ctx.player).toMatchObject({ id: playerCarol });
    const health = (await call('GET', '/u8/alliance-health', lead)).json().members.find((m: { userId: number }) => m.userId === carolId);
    expect(health).toMatchObject({ name: 'Neffez', ingameName: 'Carol' });
    const alliance = (await call('GET', '/u8/alliance', carol)).json() as { user_id: number | null; display_name: string | null; username: string }[];
    expect(alliance.find((m) => m.user_id === carolId)).toMatchObject({ display_name: 'Neffez', username: 'carol' });
    const added = await call('POST', `/admin/groups/${group}/members`, lead, { name: 'Bob' });
    expect(added.statusCode).toBe(200);
    const placeholder = added.json().id as number;
    const list = (await call('GET', `/admin/groups/${group}/members`, lead)).json() as { id: number; ingame_name: string; display_name: string | null }[];
    expect(list.find((m) => m.id === placeholder)).toMatchObject({ ingame_name: 'Bob', display_name: null });
    const token = (await call('POST', `/admin/groups/${group}/members/${placeholder}/invite`, admin)).json().token as string;
    expect((await call('GET', `/invites/${token}`, admin)).json().member).toEqual({ name: 'Bob' });
  });
});
