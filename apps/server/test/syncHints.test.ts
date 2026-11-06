import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { statInterval } = await import('../src/repo/syncHints.js');
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

describe('statInterval', () => {
  const H = 3600;
  it('learns the interval from synced updates, whatever their hours', () => {
    // updates at 23, 5, 11 o'clock (a server ignoring daylight saving), one missed: the gap of 12 h is a multiple
    expect(statInterval([0, 6 * H, 12 * H, 24 * H].map((x) => 1_000_000 + x))).toBe(6 * H);
    // a server updating every 4 hours, page times a few minutes off, two pages of the same update
    expect(statInterval([0, 4 * H + 120, 4 * H + 300, 8 * H + 60, 16 * H])).toBe(4 * H + 60);
  });

  it('knows nothing from a single gap or none', () => {
    expect(statInterval([0, 6 * H])).toBeNull();
    expect(statInterval([0, 6 * H, 18 * H])).toBeNull();
    expect(statInterval([])).toBeNull();
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

  it('names the categories missing in the newest synced update, and expects a newer one only after the learned interval', async () => {
    const t = now();
    const snap = (type: number, time: number) => db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', ?, ?)").run(group, type, time);
    // one synced update an hour ago (total points only): the other categories lack it; no interval known yet
    snap(1, t - 3600);
    let stats = (await hints()).find((h) => h.key === 'stats');
    expect(stats).toMatchObject({ level: 'low', update: t - 3600, estimated: false, types: [2, 3, 4, 5] });
    for (const type of [2, 3, 4, 5]) snap(type, t - 3600);
    expect((await hints()).find((h) => h.key === 'stats')).toBeUndefined();
    // two earlier updates 5 h apart each: the interval is 5 h, the next update is not due yet
    snap(1, t - 6 * 3600);
    snap(1, t - 11 * 3600);
    expect((await hints()).find((h) => h.key === 'stats')).toBeUndefined();
    // 5 h (plus the grace) after the newest: a newer one is expected (all categories, estimated)
    db.prepare('UPDATE stat_snapshots SET stat_time = -stat_time WHERE group_id = ?').run(group);
    db.prepare('UPDATE stat_snapshots SET stat_time = -stat_time - 5 * 3600 WHERE group_id = ?').run(group);
    stats = (await hints()).find((h) => h.key === 'stats');
    expect(stats).toMatchObject({ level: 'medium', estimated: true, interval: 5 * 3600, update: t - 3600, types: [1, 2, 3, 4, 5] });
  });

  it('keeps the hints of one group to that group', async () => {
    const other = Number(db.prepare("INSERT INTO groups (universe_id, name) SELECT universe_id, 'B' FROM groups WHERE id = ?").run(group).lastInsertRowid);
    db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(other, carolId);
    const res = await app.inject({ method: 'GET', url: '/hub/api/u8/sync-hints', headers: { ...carol, 'x-hub-group': String(other) } });
    expect(res.json().hints.find((h: any) => h.key === 'empire')).toMatchObject({ level: 'high', time: null });
  });
});
