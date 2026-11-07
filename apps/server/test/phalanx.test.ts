import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { payloadOf } = await import('../src/push.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let carol: Record<string, string>;
let carolId = 0;
let daveId = 0;
const t = now();
const ids: Record<string, number> = {};

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const get = async (url: string) => (await app.inject({ method: 'GET', url: `/hub/api/u8${url}`, headers: carol })).json();

const player = (name: string, allianceId: number | null = null, status: string[] = []) =>
  (ids[name] = Number(db.prepare('INSERT INTO players (group_id, name, alliance_id, status) VALUES (?, ?, ?, ?)').run(group, name, allianceId, JSON.stringify(status)).lastInsertRowid));
const planet = (g: number, s: number, p: number, playerId: number, moon = true) =>
  db.prepare('INSERT INTO planets (group_id, g, s, p, player_id, has_moon) VALUES (?, ?, ?, ?, ?, ?)').run(group, g, s, p, playerId, moon ? 1 : 0);
/** A moon spy report with the sensor phalanx at `level` (`created`: when it reached the hub). */
const moon = (g: number, s: number, p: number, playerId: number, time: number, level: number, created = t) =>
  db
    .prepare(
      `INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_id, player_name, report_time, sections, created_at)
       VALUES (?, ?, ?, ?, 'moon', ?, (SELECT name FROM players WHERE id = ?), ?, ?, ?)`,
    )
    .run(group, g, s, p, playerId, playerId, time, JSON.stringify({ 900: {}, 0: { 41: 1, 42: level } }), created);

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  daveId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', hashPassword('davepass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol'), (?, ?, 'Dave')").run(group, carolId, group, daveId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };

  const ally = Number(db.prepare("INSERT INTO alliances (group_id, name, tag) VALUES (?, 'Wir', 'WIR')").run(group).lastInsertRowid);
  const enemies = Number(db.prepare("INSERT INTO alliances (group_id, name, tag) VALUES (?, 'Feinde', 'FEI')").run(group).lastInsertRowid);
  player('Carol', ally);
  player('Friend', ally);
  player('Dave');
  player('Enemy', enemies);
  player('Sleeper', null, ['vacation']);
  player('Gone');

  // Carol's empire: two planets and a moon (moons are no phalanx targets)
  const empire = {
    kind: 'empire', research: {}, planets: [
      { name: 'Home', coords: { g: 1, s: 100, p: 8 }, type: 'planet', values: {} },
      { name: 'Home', coords: { g: 1, s: 100, p: 8 }, type: 'moon', values: { 41: 1, 42: 2 } },
      { name: 'Edge', coords: { g: 1, s: 3, p: 1 }, type: 'planet', values: {} },
    ],
  };
  db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, carolId, t - 600, JSON.stringify(empire));
  planet(1, 100, 8, ids.Carol);

  // Enemy: level 1 two days ago (reaches only its own system), level 3 (8 systems) since yesterday
  planet(1, 104, 3, ids.Enemy);
  moon(1, 104, 3, ids.Enemy, t - 2 * 86400, 1, t - 2 * 86400);
  moon(1, 104, 3, ids.Enemy, t - 86400, 3, t - 86400 + 60);
  moon(1, 104, 3, ids.Enemy, t - 3600, 3);
  // a friend's moon in reach: own alliance, no threat
  planet(1, 101, 2, ids.Friend);
  moon(1, 101, 2, ids.Friend, t - 3600, 5);
  // too far away: level 2 reaches 3 systems
  planet(1, 120, 1, ids.Enemy);
  moon(1, 120, 1, ids.Enemy, t - 3600, 2);
  // destroyed since the report (the galaxy shows no moon any more)
  planet(1, 99, 9, ids.Gone, false);
  moon(1, 99, 9, ids.Gone, t - 3600, 6);
  // known for days (reached the hub three days ago): in the empire view, no new notification
  planet(1, 95, 4, ids.Sleeper);
  moon(1, 95, 4, ids.Sleeper, t - 3 * 86400, 4, t - 3 * 86400);
  // across the end of the circular galaxy (400 systems): 398 → 3 is 5 systems
  moon(1, 398, 7, ids.Enemy, t - 7200, 3);
  // another galaxy: never in reach
  moon(2, 100, 8, ids.Enemy, t - 3600, 10);
});

describe('hostile phalanx exposure', () => {
  it('lists the moons outside the own alliance whose phalanx reaches the member planets', async () => {
    const res = await get(`/imperium?user=${carolId}`);
    const byPlanet = Object.fromEntries(res.phalanx.map((e: any) => [`${e.planet.g}:${e.planet.s}:${e.planet.p}`, e]));
    expect(Object.keys(byPlanet).sort()).toEqual(['1:100:8', '1:3:1']);
    const home = byPlanet['1:100:8'];
    expect(home.planet).toEqual({ g: 1, s: 100, p: 8, name: 'Home' });
    expect(home.threats.map((x: any) => `${x.moon.s}:${x.moon.p}`)).toEqual(['104:3', '95:4']);
    expect(home.threats[0]).toMatchObject({
      level: 3, range: 8, distance: 4, time: t - 3600, since: t - 86400, known: t - 86400 + 60,
      player: { id: ids.Enemy, name: 'Enemy', ally: 'FEI', vacation: false },
    });
    expect(home.threats[1]).toMatchObject({ level: 4, range: 15, distance: 5, player: { name: 'Sleeper', vacation: true } });
    expect(byPlanet['1:3:1'].threats).toEqual([expect.objectContaining({ moon: { g: 1, s: 398, p: 7 }, distance: 5, range: 8 })]);
  });

  it('is empty for a member without planets', async () => {
    expect((await get(`/imperium?user=${daveId}`)).phalanx).toEqual([]);
  });

  it('notifies about phalanxes newly known to reach the viewer', async () => {
    const list = (await get('/notifications')).filter((n: any) => n.kind === 'phalanx');
    expect(list.map((n: any) => `${n.moon.s}:${n.moon.p}`).sort()).toEqual(['104:3', '398:7']);
    const enemy = list.find((n: any) => n.moon.s === 104);
    expect(enemy).toMatchObject({
      id: `phalanx:1:104:3:${t - 86400 + 60}`, userId: carolId, member: 'Carol', time: t - 86400 + 60, level: 3, range: 8, since: t - 86400,
      planets: [{ g: 1, s: 100, p: 8, name: 'Home' }],
    });
    const push = payloadOf(enemy, 'en', 'u8', 'Europe/Berlin', group, t);
    expect(push.title).toBe('🔭 Phalanx of Enemy [FEI] reaches you');
    expect(push.body).toBe('Moon [1:104:3], level 3 · sees fleets from and to Home [1:100:8]');
    expect(push.url).toContain('/u8/imperium?');
  });

  it('keeps the galaxy browser coverage on the shared moon list', async () => {
    const res = await get('/browse/1/100');
    expect(res.phalanx.map((m: any) => `${m.s}:${m.p}`).sort()).toEqual(['100:8', '101:2', '104:3', '95:4']);
  });
});
