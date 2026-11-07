import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const t = now();
let group = 0;
let carol: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = async (q = '') => (await app.inject({ method: 'GET', url: `/hub/api/u8/colonize${q}`, headers: carol })).json();

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const daveId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', hashPassword('davepass')).lastInsertRowid);
  const cookie = await login('admin', 'adminpass');
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: { cookie } });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: { cookie } })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol'), (?, ?, 'Dave')").run(group, carolId, group, daveId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
  const empire = (userId: number, planets: [number, number, number][]) =>
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(
      group, userId, t, JSON.stringify({ kind: 'empire', research: {}, planets: planets.map(([g, s, p]) => ({ name: 'P', coords: { g, s, p }, type: 'planet', values: {} })) }),
    );
  empire(carolId, [[1, 100, 8]]);
  empire(daveId, [[2, 50, 8]]);
  const foe = Number(db.prepare("INSERT INTO players (group_id, name, status) VALUES (?, 'Foe', '[\"inactive\"]')").run(group).lastInsertRowid);
  const big = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Big')").run(group).lastInsertRowid);
  const view = db.prepare('INSERT INTO galaxy_views (group_id, g, s, seen_at) VALUES (?, ?, ?, ?)');
  const planet = db.prepare('INSERT INTO planets (group_id, g, s, p, player_id, destroyed) VALUES (?, ?, ?, ?, ?, ?)');
  view.run(group, 1, 100, t);
  for (let p = 1; p <= 15; p++) planet.run(group, 1, 100, p, p === 8 ? null : foe, 0); // full but position 8 (Carol's, unknown owner here)
  view.run(group, 1, 110, t);
  planet.run(group, 1, 110, 4, foe, 0);
  planet.run(group, 1, 110, 5, null, 1); // destroyed
  view.run(group, 3, 200, t);
  planet.run(group, 3, 200, 9, big, 0);
  view.run(group, 2, 52, t);
  db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 1, ?)").run(group, t);
  const snap = db.prepare('SELECT id FROM stat_snapshots WHERE group_id = ?').pluck().get(group);
  db.prepare('INSERT INTO player_scores (snapshot_id, player_id, type, stat_time, points, rank) VALUES (?, ?, 1, ?, ?, 1), (?, ?, 1, ?, ?, 2)').run(snap, foe, t, 500, snap, big, t, 90000);
});

describe('colonization planner (C-5)', () => {
  it('lists systems with free positions and what a colony there adds', async () => {
    const res = await call();
    expect(res).toMatchObject({ own: 1, seenSystems: 4, range: 25 });
    const by = Object.fromEntries(res.systems.map((x: any) => [`${x.g}:${x.s}`, x]));
    expect(by['1:100'].free).toEqual([8]);
    expect(by['1:110'].free).toEqual([1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(by['1:110']).toMatchObject({ targets: 15, inactive: 15, targetPoints: 500, systemPoints: 500, members: 0 });
    // near Dave in galaxy 2: competition
    expect(by['2:52']).toMatchObject({ members: 1, targets: 0 });
    // a far galaxy covers more than the own system's neighbour
    expect(by['3:200'].coverage).toBeGreaterThan(by['1:110'].coverage);
    expect(by['3:200']).toMatchObject({ systemPoints: 90000 });
    expect(by['1:110'].nearest).toBeLessThan(by['3:200'].nearest);
  });

  it('counts within the chosen range only', async () => {
    const res = await call('?range=5');
    const by = Object.fromEntries(res.systems.map((x: any) => [`${x.g}:${x.s}`, x]));
    expect(by['1:110']).toMatchObject({ targets: 1, targetPoints: 500 });
  });
});
