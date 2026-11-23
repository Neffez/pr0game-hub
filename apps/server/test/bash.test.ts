import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let admin: Record<string, string>;
let carol: Record<string, string>;
let dave: Record<string, string>;
let carolId = 0;
let daveId = 0;
const t = now();
const H = 3600;
const ids: Record<string, number> = {};

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const get = async (url: string, as = carol) => {
  const res = await app.inject({ method: 'GET', url: `/hub/api/u8${url}`, headers: as });
  expect(res.statusCode).toBe(200);
  return res.json();
};

const player = (name: string) => (ids[name] = Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(group, name).lastInsertRowid));
const planet = (g: number, s: number, p: number, playerId: number) =>
  db.prepare('INSERT INTO planets (group_id, g, s, p, player_id, has_moon) VALUES (?, ?, ?, ?, ?, 1)').run(group, g, s, p, playerId);
let n = 0;
/** A battle message synced by `userId`: impact at `time` at the target. */
const battle = (userId: number, time: number, [g, s, p]: number[], type = 'planet', reportId: string | null = null) =>
  db
    .prepare(
      `INSERT INTO battle_reports (group_id, user_id, dedupe_key, report_id, time, g, s, p, planet_type, lost_attacker, lost_defender,
         loot_metal, loot_crystal, loot_deuterium, debris_metal, debris_crystal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)`,
    )
    .run(group, userId, `k${++n}`, reportId, time, g, s, p, type);

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  daveId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', hashPassword('davepass')).lastInsertRowid);
  admin = { cookie: await login('admin', 'adminpass') };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: admin });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: admin })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol'), (?, ?, 'Dave')").run(group, carolId, group, daveId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
  dave = { cookie: await login('dave', 'davepass'), 'x-hub-group': String(group) };

  player('Carol');
  player('Dave');
  player('Target');
  player('Friend');
  planet(1, 100, 8, ids.Carol);
  planet(1, 200, 1, ids.Target);
  planet(1, 200, 2, ids.Target);
  planet(2, 50, 5, ids.Target);
  planet(1, 300, 3, ids.Friend);

  // Carol: three attacks on 1:200:1 (one of them stored twice), one on its moon, one on 2:50:5, one too old
  battle(carolId, t - 23 * H, [1, 200, 1]);
  battle(carolId, t - 2 * H, [1, 200, 1]);
  battle(carolId, t - H, [1, 200, 1]);
  battle(carolId, t - H, [1, 200, 1]);
  battle(carolId, t - 3 * H, [1, 200, 1], 'moon');
  battle(carolId, t - 5 * H, [2, 50, 5]);
  battle(carolId, t - 25 * H, [1, 200, 2]);
  // defending: an attack on her own planet, and holding Friend's planet (defender in the archived report)
  battle(carolId, t - H, [1, 100, 8]);
  battle(carolId, t - H, [1, 300, 3], 'planet', 'abc');
  db.prepare(
    `INSERT INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets, g, s, p, planet_type)
     VALUES (?, 'abc', ?, 'defender', 1, 0, 0, 0, 0, ?, 1, 300, 3, 'planet')`,
  ).run(group, t - H, JSON.stringify([[0, 'Raider', []], [1, 'Friend', []], [1, 'Carol', []]]));
  // Dave has his own limit
  battle(daveId, t - H, [1, 200, 2]);
});

describe('bash limit', () => {
  it('counts the own attacks per planet and player in the player details', async () => {
    const { bash } = await get(`/players/${ids.Target}`);
    expect(bash).toMatchObject({ hours: 24, planetLimit: 3, playerLimit: 10 });
    expect(bash.players).toEqual([{ playerId: ids.Target, resets: [t + H, t + 19 * H, t + 21 * H, t + 22 * H, t + 23 * H] }]);
    const byKey = Object.fromEntries(bash.targets.map((x: any) => [`${x.g}:${x.s}:${x.p}:${x.planet_type}`, x.resets]));
    expect(byKey).toEqual({
      '1:200:1:planet': [t + H, t + 22 * H, t + 23 * H],
      '1:200:1:moon': [t + 21 * H],
      '2:50:5:planet': [t + 19 * H],
    });
  });

  it('leaves out battles at own planets and where the member defended', async () => {
    expect((await get(`/players/${ids.Carol}`)).bash.targets).toEqual([]);
    expect((await get(`/players/${ids.Friend}`)).bash).toMatchObject({ players: [], targets: [] });
  });

  it('is separate for every member', async () => {
    const { bash } = await get(`/players/${ids.Target}`, dave);
    expect(bash.players).toEqual([{ playerId: ids.Target, resets: [t + 23 * H] }]);
    expect(bash.targets).toEqual([{ g: 1, s: 200, p: 2, planet_type: 'planet', playerId: ids.Target, resets: [t + 23 * H] }]);
  });

  it('shows the system’s targets and their owners in the galaxy view', async () => {
    const { bash } = await get('/browse/1/200');
    expect(bash.targets.map((x: any) => `${x.p}:${x.planet_type}`).sort()).toEqual(['1:moon', '1:planet']);
    // the player count includes attacks on their planets in other systems
    expect(bash.players[0].resets).toHaveLength(5);
  });

  it('follows the universe settings', async () => {
    const put = (settings: object) => app.inject({ method: 'PUT', url: '/hub/api/admin/universes/u8', payload: { settings }, headers: admin });
    expect((await put({ bashPlanetLimit: 4, bashPlayerLimit: 0, bashHours: 2.5 })).statusCode).toBe(200);
    const { bash } = await get(`/players/${ids.Target}`);
    expect(bash).toMatchObject({ hours: 2.5, planetLimit: 4, playerLimit: 0 });
    expect(bash.targets.map((x: any) => x.resets)).toEqual([[t + 1.5 * H, t + 0.5 * H].sort((a, b) => a - b)]);
    expect((await put({ bashPlanetLimit: 0, bashPlayerLimit: 0 })).statusCode).toBe(200);
    expect((await get(`/players/${ids.Target}`)).bash).toBeNull();
    expect((await put({ bashPlanetLimit: 1.5 })).statusCode).toBe(400);
  });
});
