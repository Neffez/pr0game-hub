import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { lastStatUpdate, expectedStatUpdate } = await import('../src/repo/syncHints.js');
const { localToEpoch } = await import('@pr0hub/core');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let carolId = 0;
let carol: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const hints = async () => (await app.inject({ method: 'GET', url: '/hub/api/u8/sync-hints', headers: carol })).json().hints as any[];
const keys = async () => (await hints()).map((h) => h.key);

const empire = {
  kind: 'empire',
  research: {},
  planets: [
    { name: 'Home', coords: { g: 1, s: 100, p: 4 }, type: 'planet', values: { 1: 10 }, resources: { 901: 0, 902: 0, 903: 0 } },
    { name: 'Moon', coords: { g: 1, s: 100, p: 4 }, type: 'moon', values: {}, resources: { 901: 0, 902: 0, 903: 0 } },
  ],
};

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
});

describe('lastStatUpdate', () => {
  it('is the latest 0, 6, 12 or 18 o’clock of the time zone', () => {
    const at = (local: string) => localToEpoch(local, 'Europe/Berlin');
    expect(lastStatUpdate(at('2026-11-06 17:59:59'), 'Europe/Berlin')).toBe(at('2026-11-06 12:00:00'));
    expect(lastStatUpdate(at('2026-11-06 18:00:00'), 'Europe/Berlin')).toBe(at('2026-11-06 18:00:00'));
    expect(lastStatUpdate(at('2026-11-07 03:10:00'), 'Europe/Berlin')).toBe(at('2026-11-07 00:00:00'));
    // summer time: still the local hour
    expect(lastStatUpdate(at('2026-07-01 07:00:00'), 'Europe/Berlin')).toBe(at('2026-07-01 06:00:00'));
  });
});

describe('expectedStatUpdate', () => {
  const at = (local: string) => localToEpoch(local, 'Europe/Berlin');
  it('keeps the hours of the synced updates, also when the server ignores daylight saving', () => {
    // the server updates at 22:00 UTC: midnight in summer, 23:00 in winter
    const synced = at('2026-10-25 23:00:00');
    expect(expectedStatUpdate(at('2026-10-26 10:59:00'), synced, 'Europe/Berlin')).toBe(at('2026-10-26 05:00:00'));
    expect(expectedStatUpdate(at('2026-10-26 11:00:00'), synced, 'Europe/Berlin')).toBe(at('2026-10-26 11:00:00'));
    // a page time a few minutes after the grid point
    expect(expectedStatUpdate(at('2026-10-26 18:00:00'), synced + 180, 'Europe/Berlin')).toBe(at('2026-10-26 17:00:00'));
    // without synced updates: the default grid
    expect(expectedStatUpdate(at('2026-10-26 18:00:00'), null, 'Europe/Berlin')).toBe(at('2026-10-26 18:00:00'));
  });
});

describe('sync hints', () => {
  it('asks a new member for the empire and the statistics first', async () => {
    const list = await hints();
    expect(list.slice(0, 2).map((h) => [h.key, h.level])).toEqual([
      ['empire', 'high'],
      ['stats', 'high'],
    ]);
    expect(list.find((h) => h.key === 'stats').types).toEqual([1, 2, 3, 4, 5]);
    // without an empire there are no planets for the galaxy and buildings hints
    expect(await keys()).toEqual(['empire', 'stats', 'overview', 'research', 'messages', 'market']);
  });

  it('follows the synced pages', async () => {
    const t = now();
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, carolId, t - 2 * 86400, JSON.stringify(empire));
    let list = await hints();
    expect(list.find((h) => h.key === 'empire')).toMatchObject({ level: 'medium', time: t - 2 * 86400 });
    // five systems around the planet, none seen; both planet and moon without a buildings page
    expect(list.find((h) => h.key === 'galaxy')).toMatchObject({ level: 'medium', count: 5, total: 5, time: null });
    expect(list.find((h) => h.key === 'buildings')).toMatchObject({ count: 2, total: 2 });

    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, carolId, t - 60, JSON.stringify(empire));
    for (const s of [98, 99, 100]) db.prepare('INSERT INTO galaxy_views (group_id, g, s, seen_at) VALUES (?, 1, ?, ?)').run(group, s, t - 3600);
    db.prepare("INSERT INTO building_snapshots (group_id, user_id, g, s, p, planet_type, page_time, data) VALUES (?, ?, 1, 100, 4, 'planet', ?, '{}')").run(group, carolId, t);
    db.prepare('INSERT INTO overview_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, carolId, t - 13 * 3600, '{}');
    list = await hints();
    expect(list.find((h) => h.key === 'empire')).toBeUndefined();
    expect(list.find((h) => h.key === 'galaxy')).toMatchObject({ level: 'low', count: 2, total: 5 });
    expect(list.find((h) => h.key === 'buildings')).toMatchObject({ count: 1, total: 2 });
    expect(list.find((h) => h.key === 'overview')).toMatchObject({ level: 'low', time: t - 13 * 3600 });
  });

  it('names the missing categories of the latest statistics update', async () => {
    const update = lastStatUpdate(now() - 600, 'Europe/Berlin');
    for (const [type, time] of [[1, update], [2, update - 6 * 3600]]) {
      db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', ?, ?)").run(group, type, time);
    }
    const stats = (await hints()).find((h) => h.key === 'stats');
    expect(stats).toMatchObject({ level: 'low', scope: 'group', update, types: [2, 3, 4, 5], time: update });
  });

  it('keeps the hints of one group to that group', async () => {
    const other = Number(db.prepare("INSERT INTO groups (universe_id, name) SELECT universe_id, 'B' FROM groups WHERE id = ?").run(group).lastInsertRowid);
    db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(other, carolId);
    const res = await app.inject({ method: 'GET', url: '/hub/api/u8/sync-hints', headers: { ...carol, 'x-hub-group': String(other) } });
    expect(res.json().hints.find((h: any) => h.key === 'empire')).toMatchObject({ level: 'high', time: null });
  });
});
