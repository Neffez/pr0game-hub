import { beforeAll, describe, expect, it } from 'vitest';
import { positionTemp, productionOf } from '@pr0hub/core/production';
import { storageCapacity } from '@pr0hub/core/tech';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let carol: Record<string, string>;
const t = now();
const ids: Record<string, number> = {};

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const farm = async (query = '') => (await app.inject({ method: 'GET', url: `/hub/api/u8/farm${query}`, headers: carol })).json();

const player = (name: string, allianceId: number | null = null, status: string[] = []) =>
  (ids[name] = Number(db.prepare('INSERT INTO players (group_id, name, alliance_id, status) VALUES (?, ?, ?, ?)').run(group, name, allianceId, JSON.stringify(status)).lastInsertRowid));
const planet = (g: number, s: number, p: number, playerId: number, moon = false) =>
  db.prepare('INSERT INTO planets (group_id, g, s, p, player_id, has_moon) VALUES (?, ?, ?, ?, ?, ?)').run(group, g, s, p, playerId, moon ? 1 : 0);
const spy = (g: number, s: number, p: number, playerId: number, time: number, sections: Record<number, Record<number, number>>, type = 'planet') =>
  db
    .prepare('INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_id, player_name, report_time, sections) VALUES (?, ?, ?, ?, ?, ?, (SELECT name FROM players WHERE id = ?), ?, ?)')
    .run(group, g, s, p, type, playerId, playerId, time, JSON.stringify(sections));
const score = (playerId: number, time: number, points: number) => {
  db.prepare("INSERT OR IGNORE INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 1, ?)").run(group, time);
  const snap = db.prepare("SELECT id FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = 1 AND stat_time = ?").pluck().get(group, time);
  db.prepare('INSERT INTO player_scores (snapshot_id, player_id, type, stat_time, points, rank) VALUES (?, ?, 1, ?, ?, 1)').run(snap, playerId, time, points);
};

const MINES = { 1: 20, 2: 15, 3: 10, 4: 22, 22: 3, 23: 3, 24: 3 };

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  // resource multiplier 2x (5000)
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8', settings: { resourceMultiplier: 5000 } }, ...h });
  db.prepare("UPDATE universes SET settings = json_set(COALESCE(settings, '{}'), '$.resourceMultiplier', 5000) WHERE slug = 'u8'").run();
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };

  const ally = Number(db.prepare("INSERT INTO alliances (group_id, name, tag) VALUES (?, 'Wir', 'WIR')").run(group).lastInsertRowid);
  player('Carol', ally);
  player('Friend', ally);
  player('Farm');
  player('Sleepy', null, ['inactive']);
  player('Moved');
  planet(1, 100, 8, ids.Farm, true);
  planet(1, 101, 4, ids.Sleepy);
  planet(1, 102, 5, ids.Friend);
  planet(1, 103, 6, ids.Farm); // now Farm's, the old report was Moved's
  // two hours old resources, buildings from an older report, research of the player elsewhere
  spy(1, 100, 8, ids.Farm, t - 7200, { 900: { 901: 10_000, 902: 5_000, 903: 1_000 }, 200: { 212: 0, 202: 3 }, 400: {} });
  spy(1, 100, 8, ids.Farm, t - 86400, { 0: MINES, 100: { 113: 0 } });
  spy(1, 100, 8, ids.Farm, t - 3600, { 900: { 901: 40_000, 902: 0, 903: 0 } }, 'moon');
  spy(1, 101, 4, ids.Sleepy, t - 600, { 900: { 901: storageCapacity(3) + 1, 902: 0, 903: 0 }, 0: MINES, 400: { 401: 10, 502: 5 } });
  spy(1, 102, 5, ids.Friend, t - 600, { 900: { 901: 1, 902: 1, 903: 1 } });
  spy(1, 103, 6, ids.Moved, t - 600, { 900: { 901: 1, 902: 1, 903: 1 } });
  spy(2, 1, 1, ids.Farm, t - 20 * 86400, { 900: { 901: 1, 902: 1, 903: 1 } });
  // statistics: Farm stopped gaining points two updates ago, Sleepy is flagged by the game
  for (const [i, time] of [t - 18 * 3600, t - 12 * 3600, t - 6 * 3600, t].entries()) {
    score(ids.Farm, time, i < 2 ? 1000 + i : 1001);
    score(ids.Sleepy, time, 50);
    score(ids.Carol, time, 100 + i);
  }
});

describe('farm finder', () => {
  it('lists spied targets outside the own alliance with the resources expected now', async () => {
    const res = await farm();
    expect(res).toMatchObject({ resourceSpeed: 2, speedSource: 'settings', storageFactor: 1, days: 7 });
    const keys = res.targets.map((x: any) => `${x.g}:${x.s}:${x.p}:${x.type}`).sort();
    // not the ally, not the position that changed owner, not the report older than 7 days
    expect(keys).toEqual(['1:100:8:moon', '1:100:8:planet', '1:101:4:planet']);

    const target = res.targets.find((x: any) => x.s === 100 && x.type === 'planet');
    const perHour = productionOf({ levels: { ...MINES, 212: 0 }, research: { 113: 0 }, temp: positionTemp(8), resourceSpeed: 2 });
    expect(target.perHour[901]).toBe(Math.round(perHour[901]));
    expect(target.projected[901]).toBeCloseTo(10_000 + 2 * perHour[901], -1);
    expect(target.loot[902]).toBe(Math.floor(target.projected[902] / 2));
    expect(target.levels.time).toBe(t - 86400);
    expect(target.fleet).toMatchObject({ units: 3, time: t - 7200 });
    expect(target.defense).toMatchObject({ units: 0, points: 0 });
    expect(target.player).toMatchObject({ name: 'Farm', points: 1001 });
    // no gain in the last two updates (12 hours): possibly inactive
    expect(target.inactivity).toMatchObject({ score: 27, level: 'possible', stall: t - 12 * 3600, since: t - 12 * 3600 });
  });

  it('keeps the moon as seen and caps a full storage', async () => {
    const res = await farm();
    const moon = res.targets.find((x: any) => x.type === 'moon');
    expect(moon).toMatchObject({ projected: { 901: 40_000, 902: 0, 903: 0 }, perHour: { 901: 0 }, levels: null });
    const sleepy = res.targets.find((x: any) => x.s === 101);
    expect(sleepy.full[901]).toBe(true);
    expect(sleepy.projected[901]).toBe(storageCapacity(3) + 1);
    expect(sleepy.defense).toMatchObject({ units: 10 });
    expect(sleepy.inactivity).toMatchObject({ level: 'inactive', score: 95, status: 'inactive' });
  });

  it('looks further back on request', async () => {
    expect((await farm('?days=30')).targets).toHaveLength(4);
  });
});
