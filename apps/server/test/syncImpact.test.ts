import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');
let group = 0;
let carolId = 0;
let carol: Record<string, string>;
const DAY = 86400;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const sync = async (payload: Record<string, unknown>) => {
  const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload });
  expect(res.statusCode).toBe(200);
  return res.json();
};

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const cookie = await login('admin', 'adminpass');
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: { cookie } });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: { cookie } })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
});

describe('impact of a sync', () => {
  it('tells nothing on a dry run', async () => {
    expect((await sync({ html: fixture('galaxy.html'), dryRun: true })).impact).toBeUndefined();
  });

  it('counts galaxy systems seen for the first time and the age of the views they replace', async () => {
    expect((await sync({ html: fixture('galaxy.html') })).impact.galaxy).toEqual({ systems: 1, first: 1, age: null });
    // the same view again is no news
    expect((await sync({ html: fixture('galaxy.html') })).impact.galaxy).toBeUndefined();
    db.prepare('UPDATE galaxy_views SET seen_at = seen_at - ? WHERE group_id = ?').run(2 * DAY, group);
    const galaxy = (await sync({ html: fixture('galaxy.html') })).impact.galaxy;
    expect(galaxy).toMatchObject({ systems: 1, first: 0 });
    expect(galaxy.age).toBeGreaterThanOrEqual(2 * DAY);
    expect(galaxy.age).toBeLessThan(2 * DAY + 60);
  });

  it('counts targets spied for the first time and older reports replaced', async () => {
    const first = (await sync({ text: fixture('messages.txt') })).impact.spy;
    expect(first.first).toBeGreaterThan(0);
    expect(first).toMatchObject({ replaced: 0, age: null });
    // the same reports again: nothing new
    expect((await sync({ text: fixture('messages.txt') })).impact.spy).toBeUndefined();
    // the stored reports a day older (other messages): the pasted ones replace them
    db.prepare("UPDATE spy_reports SET report_time = report_time - ?, msg_id = msg_id || 'x' WHERE group_id = ?").run(DAY, group);
    const again = (await sync({ text: fixture('messages.txt') })).impact.spy;
    expect(again).toEqual({ first: 0, replaced: first.first, age: DAY });
  });

  it('tells who pasted a statistics update first and which categories a sync added', async () => {
    const stats = (await sync({ html: fixture('stats-player.html') })).impact.stats;
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ first: true, types: [2] });
    expect((await sync({ html: fixture('stats-player.html') })).impact.stats).toBeUndefined();
  });

  it('names the own pages that are newer and the sync hints done with them', async () => {
    const impact = (await sync({ html: fixture('empire.html') })).impact;
    expect(impact.own).toEqual([{ page: 'empire', before: null }]);
    expect(impact.hintsDone).toContain('empire');
    // the same page within the hour is no news
    expect((await sync({ html: fixture('empire.html') })).impact.own).toBeUndefined();
    db.prepare('UPDATE empire_snapshots SET created_at = created_at - ? WHERE group_id = ?').run(3 * DAY, group);
    const old = (await sync({ html: fixture('empire.html') })).impact;
    expect(old.own[0].page).toBe('empire');
    expect(old.own[0].before).toBeLessThan(Date.now() / 1000 - 3 * DAY + 60);
  });
});

describe('contributors of a page', () => {
  const get = async (query: string) => app.inject({ method: 'GET', url: `/hub/api/u8/contributors?${query}`, headers: carol });

  it('counts the members who synced the data, names those who show their syncs', async () => {
    // carol synced the galaxy, spy reports and statistics above
    expect((await get('scope=stats')).json()).toEqual({ scope: 'stats', days: 7, members: 1, me: true, names: [], hidden: 0 });
    const user = (name: string, share: number) =>
      Number(db.prepare('INSERT INTO users (username, password_hash, share_syncs) VALUES (?, ?, ?)').run(name, 'x', share).lastInsertRowid);
    const bob = user('bob', 1);
    const dave = user('dave', 0);
    const eve = user('eve', 1);
    for (const id of [bob, dave]) db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(group, id);
    // eve left the group: her view is not counted
    for (const [s, id] of [[1, bob], [2, dave], [3, eve]]) db.prepare('INSERT INTO galaxy_views (group_id, g, s, seen_at, user_id) VALUES (?, 9, ?, 1, ?)').run(group, s, id);
    expect((await get('scope=galaxy')).json()).toEqual({ scope: 'galaxy', days: null, members: 3, me: true, names: ['bob'], hidden: 1 });
    // spy reports of the window only
    db.prepare("UPDATE spy_reports SET report_time = report_time - ? WHERE group_id = ?").run(400 * DAY, group);
    expect((await get('scope=farm&days=3')).json()).toMatchObject({ days: 3, members: 0, me: false });
  });

  it('refuses an unknown scope', async () => {
    expect((await get('scope=nope')).statusCode).toBe(400);
  });
});
