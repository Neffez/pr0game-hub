import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { decay } = await import('../src/repo/freshness.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let carolId = 0;
let carol: Record<string, string>;
let admin: Record<string, string>;
const H = 3600;
const DAY = 24 * H;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const getJson = async (url: string, headers = carol) => {
  const res = await app.inject({ method: 'GET', url: `/hub/api/${url}`, headers });
  expect(res.statusCode).toBe(200);
  return res.json();
};

const empire = {
  kind: 'empire',
  research: {},
  planets: [{ name: 'Home', coords: { g: 1, s: 100, p: 4 }, type: 'planet', values: { 1: 10 }, resources: { 901: 0, 902: 0, 903: 0 } }],
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
  admin = { cookie, 'x-hub-group': String(group) };
});

describe('freshness', () => {
  it('decays linearly between fully fresh and worthless', () => {
    expect(decay(null, H, 3 * H)).toBe(0);
    expect(decay(H, H, 3 * H)).toBe(1);
    expect(decay(2 * H, H, 3 * H)).toBe(0.5);
    expect(decay(5 * H, H, 3 * H)).toBe(0);
  });

  it('weighs the own pages by their age', async () => {
    expect((await getJson('u8/sync-hints')).freshness.score).toBe(0);
    const t = now();
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, carolId, t - H, JSON.stringify(empire));
    db.prepare("INSERT INTO overview_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, '{}')").run(group, carolId, t - 27 * H);
    // two of the five systems around the planet fresh
    for (const s of [99, 100]) db.prepare('INSERT INTO galaxy_views (group_id, g, s, seen_at) VALUES (?, 1, ?, ?)').run(group, s, t - H);
    const f = (await getJson('u8/sync-hints')).freshness;
    const part = (k: string) => f.parts.find((p: any) => p.key === k);
    expect(part('empire')).toMatchObject({ weight: 30, value: 1, time: t - H });
    // overview: fresh until 6 h, worthless at 2 d: 27 h is half way
    expect(part('overview').value).toBeCloseTo(0.5, 2);
    expect(part('galaxy')).toMatchObject({ value: 0.4, time: null });
    expect(part('buildings')).toMatchObject({ value: 0, time: null });
    expect(f.score).toBe(Math.round(30 + 20 * part('overview').value + 20 * 0.4));
  });

  it('shows every member\'s freshness in the alliance health', async () => {
    const health = await getJson('u8/alliance-health', admin);
    expect(health.members.find((m: any) => m.userId === carolId).freshness.score).toBeGreaterThan(0);
  });

  it('gives one member the same freshness as the whole group does', async () => {
    // another member's pages at the same place must not count for carol
    const dave = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('dave', 'x')").run().lastInsertRowid);
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(group, dave);
    db.prepare("INSERT INTO building_snapshots (group_id, user_id, g, s, p, planet_type, page_time, data) VALUES (?, ?, 1, 100, 4, 'planet', ?, '{}')").run(group, dave, now());
    db.prepare("INSERT INTO research_snapshots (group_id, user_id, g, s, p, planet_type, page_time, data) VALUES (?, ?, 1, 100, 4, 'planet', ?, '{}')").run(group, dave, now());
    const own = (await getJson('u8/sync-hints')).freshness;
    const all = (await getJson('u8/alliance-health', admin)).members.find((m: any) => m.userId === carolId).freshness;
    expect(own).toEqual(all);
    expect(own.parts.find((p: any) => p.key === 'buildings').value).toBe(0);
  });
});

describe('alliance goals', () => {
  it('starts with the default goals and their progress', async () => {
    const { goals } = await getJson('u8/goals');
    expect(goals.map((x: any) => [x.key, x.target])).toEqual([['galaxy', 50], ['stats', 90], ['freshness', 75], ['spy', 50]]);
    // two systems of 4 × 400 synced within the week
    expect(goals[0]).toMatchObject({ done: 2, total: 1600, value: 0, days: 7 });
    // no statistics: no interval to expect updates by
    expect(goals[1]).toMatchObject({ value: null, total: null });
    expect(goals[3]).toMatchObject({ done: 0, total: 0, value: null });
  });

  it('counts the complete statistics updates against those the interval expects', async () => {
    const t = now();
    // updates every 6 h over the last two days, the newest two with all five categories
    for (let i = 0; i < 8; i++) {
      const time = t - i * 6 * H - H;
      for (const type of i < 2 ? [1, 2, 3, 4, 5] : [1]) db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', ?, ?)").run(group, type, time);
    }
    const stats = (await getJson('u8/goals')).goals.find((x: any) => x.key === 'stats');
    expect(stats).toMatchObject({ done: 2, total: 28, value: 7 });
  });

  it('counts inactive farm targets outside the alliance of the group with a fresh spy report', async () => {
    const t = now();
    const ally = Number(db.prepare("INSERT INTO alliances (group_id, name, tag) VALUES (?, 'Wir', 'WIR')").run(group).lastInsertRowid);
    const player = (name: string, allianceId: number | null, status: string) =>
      Number(db.prepare('INSERT INTO players (group_id, name, alliance_id, status, first_seen, last_seen) VALUES (?, ?, ?, ?, 0, 0)').run(group, name, allianceId, status).lastInsertRowid);
    // carol's player is in the alliance: an inactive player of it is no target, whoever looks
    player('Carol', ally, '[]');
    const friend = player('Friend', ally, '["inactive"]');
    const fresh = player('Fresh', null, '["inactive"]');
    const old = player('Old', null, '["inactive"]');
    const busy = player('Busy', null, '[]');
    const report = (playerId: number, s: number, time: number) =>
      db.prepare("INSERT INTO spy_reports (group_id, g, s, p, planet_type, report_time, sections, player_id) VALUES (?, 2, ?, 5, 'planet', ?, '{\"900\":{\"901\":1}}', ?)").run(group, s, time, playerId);
    report(friend, 1, t - H);
    report(fresh, 2, t - H);
    report(old, 3, t - 3 * DAY);
    report(busy, 4, t - H);
    const spy = (await getJson('u8/goals')).goals.find((x: any) => x.key === 'spy');
    expect(spy).toMatchObject({ done: 1, total: 2, value: 50 });
  });

  it('lets the alliance admins change the goals, not the members', async () => {
    const url = `/hub/api/admin/groups/${group}/goals`;
    expect((await app.inject({ method: 'GET', url, headers: carol })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url, headers: carol, payload: { stats: { on: false } } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url, headers: admin, payload: { galaxy: { target: 0 } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url, headers: admin, payload: { stats: { days: 3 } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url, headers: admin, payload: { nope: {} } })).statusCode).toBe(400);
    const res = await app.inject({ method: 'PUT', url, headers: admin, payload: { stats: { on: false }, galaxy: { target: 80, days: 14 } } });
    expect(res.json()).toMatchObject({ galaxy: { on: true, target: 80, days: 14 }, stats: { on: false, target: 90 } });
    expect((await app.inject({ method: 'GET', url, headers: admin })).json().galaxy.target).toBe(80);
    const { goals } = await getJson('u8/goals');
    expect(goals.map((x: any) => x.key)).toEqual(['galaxy', 'freshness', 'spy']);
    expect(goals[0]).toMatchObject({ target: 80, days: 14 });
  });
});
