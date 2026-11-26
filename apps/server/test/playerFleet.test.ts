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
const ids: Record<string, number> = {};

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const fleetOf = async (name: string) => app.inject({ method: 'GET', url: `/hub/api/u9/players/${ids[name]}/fleet`, headers: carol });

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u9', name: 'Universum 9' }, ...h });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u9', name: 'A' }, ...h })).json().id;
  const daveId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', hashPassword('davepass')).lastInsertRowid);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol'), (?, ?, 'Dave')").run(group, carolId, group, daveId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };

  const player = (name: string, ...bodies: [number, number, number][]) => {
    const id = Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(group, name).lastInsertRowid);
    for (const c of bodies) db.prepare('INSERT INTO planets (group_id, g, s, p, player_id) VALUES (?, ?, ?, ?, ?)').run(group, ...c, id);
    ids[name] = id;
    return id;
  };
  const spy = db.prepare(
    `INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_id, player_name, report_time, sections) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const fleetPoints = (id: number, time: number, points: number) => {
    const snap = db.prepare("INSERT OR IGNORE INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 2, ?)").run(group, time);
    const snapId = snap.changes ? snap.lastInsertRowid : db.prepare("SELECT id FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = 2 AND stat_time = ?").pluck().get(group, time);
    db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points) VALUES (?, ?, 1, ?)').run(snapId, id, points);
  };

  // Spread: ships on two planets spied on within an hour; the sum fits the statistics (small cargo 4 points, light fighter 4)
  const spread = player('Spread', [1, 10, 1], [1, 20, 1]);
  spy.run(group, 1, 10, 1, 'planet', spread, 'Spread', t - 3 * 86400, JSON.stringify({ 200: { 202: 999 } }));
  spy.run(group, 1, 10, 1, 'planet', spread, 'Spread', t - 3600, JSON.stringify({ 200: { 202: 100, 210: 10, 212: 5 } }));
  spy.run(group, 1, 20, 1, 'planet', spread, 'Spread', t - 1800, JSON.stringify({ 200: { 204: 50 } }));
  // a report without a fleet section doesn't count
  spy.run(group, 1, 20, 1, 'planet', spread, 'Spread', t - 600, JSON.stringify({ 900: { 901: 1000 } }));
  fleetPoints(spread, t - 7200, 600);
  fleetPoints(spread, t - 30 * 86400, 100);

  // Mover: the same fleet seen on both planets (moved between the reports): the sum exceeds the statistics
  const mover = player('Mover', [2, 10, 1], [2, 20, 1]);
  spy.run(group, 2, 10, 1, 'planet', mover, 'Mover', t - 3600, JSON.stringify({ 200: { 207: 100 } }));
  spy.run(group, 2, 20, 1, 'planet', mover, 'Mover', t - 1800, JSON.stringify({ 200: { 207: 100 } }));
  fleetPoints(mover, t - 2000, 6000);

  // Brawler (formerly Rowdy): battle reports only, the newest ones listed and the most of each type over them
  const brawler = player('Brawler', [3, 10, 1]);
  db.prepare('INSERT INTO player_aliases (player_id, name, seen_until) VALUES (?, ?, ?)').run(brawler, 'Rowdy', t - 5 * 86400);
  const battle = db.prepare(
    `INSERT INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets, g, s, p, planet_type)
     VALUES (?, ?, ?, 'attacker', 1, 0, 0, 0, 0, ?, ?, ?, ?, ?)`,
  );
  battle.run(group, 'b1', t - 86400, JSON.stringify([[0, 'Brawler', [[204, 30, 28], [210, 2, 2]]], [1, 'Someone', [[401, 3, 0]]]]), 1, 50, 5, 'planet');
  battle.run(group, 'b2', t - 6 * 86400, JSON.stringify([[0, 'Rowdy', [[204, 10, 10], [202, 40, 40]]], [1, 'Other', [[401, 1, 0]]]]), null, null, null, null);
  battle.run(group, 'b3', t - 60 * 86400, JSON.stringify([[0, 'Brawler', [[207, 99, 99]]], [1, 'Other', [[401, 1, 0]]]]), null, null, null, null);

  // Loser: a big fleet spied on, then most of it destroyed in a battle elsewhere (heavy fighters 10 points, cruisers 29)
  const loser = player('Loser', [7, 10, 1]);
  spy.run(group, 7, 10, 1, 'planet', loser, 'Loser', t - 2 * 86400, JSON.stringify({ 200: { 205: 100, 206: 10 } }));
  battle.run(group, 'l1', t - 3 * 86400, JSON.stringify([[0, 'Loser', [[205, 50, 0]]], [1, 'Other', [[401, 1, 0]]]]), null, null, null, null);
  battle.run(group, 'l2', t - 86400, JSON.stringify([[0, 'Loser', [[205, 100, 20], [206, 10, 10]]], [1, 'Other', [[401, 1, 0]]]]), 7, 99, 1, 'planet');
  // Wiped: the whole fleet spied on lost in a battle afterwards; the statistics confirm it
  const wiped = player('Wiped', [8, 10, 1]);
  spy.run(group, 8, 10, 1, 'planet', wiped, 'Wiped', t - 2 * 86400, JSON.stringify({ 200: { 207: 100 } }));
  battle.run(group, 'w1', t - 86400, JSON.stringify([[1, 'Wiped', [[207, 100, 0], [401, 10, 0]]], [0, 'Other', [[204, 9, 9]]]]), 8, 10, 1, 'planet');
  // Vanished: spied on with a fleet, no battle known, but the statistics show it gone
  const vanished = player('Vanished', [9, 10, 1]);
  spy.run(group, 9, 10, 1, 'planet', vanished, 'Vanished', t - 2 * 86400, JSON.stringify({ 200: { 207: 100 } }));
  fleetPoints(vanished, t - 3 * 86400, 6000);
  fleetPoints(vanished, t - 3600, 300);

  player('Nobody', [4, 10, 1]);

  // members: Carol's empire page with a fleet list synced just after it; Dave's empire page without a fleet list
  const carolPlayer = player('Carol', [5, 10, 1]);
  spy.run(group, 5, 10, 1, 'planet', carolPlayer, 'Carol', t - 5 * 86400, JSON.stringify({ 200: { 202: 9999 } }));
  const empire = (userId: number, time: number, planets: unknown[]) =>
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, userId, time, JSON.stringify({ kind: 'empire', research: {}, planets }));
  empire(carolId, t - 3600, [
    { name: 'Home', coords: { g: 5, s: 10, p: 1 }, type: 'planet', values: { 1: 20, 202: 10, 204: 20, 401: 50 } },
    { name: 'Moon', coords: { g: 5, s: 10, p: 1 }, type: 'moon', values: { 214: 1 } },
  ]);
  const body = (s: number) => ({ coords: { g: 5, s, p: 1 }, type: 'planet', name: null });
  const line = (phase: string, mission: number, arrival: number, ships: Record<number, number>, from: number, to: number) => ({
    owner: 'own', player: null, mission, missionName: '', phase, from: body(from), to: body(to), ships, resources: null, seconds: 0, clock: null, acs: null, arrival,
  });
  db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, carolId, t - 3300, JSON.stringify([
    // an attack away at the empire page: outward and return line, counted once
    line('out', 1, t - 3000, { 207: 5 }, 10, 20),
    line('return', 1, t - 1000, { 207: 5 }, 20, 10),
    // a transport back only after the empire page: away there too
    line('return', 3, t - 3500, { 203: 7 }, 30, 10),
    // an expedition back before the empire page (an old line still listed): its ships stand on the planet there
    line('return', 15, t - 3700, { 209: 4 }, 40, 10),
  ]));
  const davePlayer = player('Dave', [6, 10, 1]);
  empire(daveId, t - 7200, [{ name: 'Dave', coords: { g: 6, s: 10, p: 1 }, type: 'planet', values: { 205: 3 } }]);
  ids.Carol = carolPlayer;
  ids.Dave = davePlayer;
});

describe('player fleet', () => {
  it('shows the spy reports per body and their sum checked against the statistics', async () => {
    const res = await fleetOf('Spread');
    expect(res.statusCode).toBe(200);
    const f = res.json();
    // per body the newest report with a fleet section, all ships (probes and satellites too)
    const spy = f.sightings.filter((x: any) => x.source === 'spy');
    expect(spy.map((x: any) => [x.body, x.units])).toEqual([
      [{ g: 1, s: 20, p: 1, type: 'planet' }, { 204: 50 }],
      [{ g: 1, s: 10, p: 1, type: 'planet' }, { 202: 100, 210: 10, 212: 5 }],
    ]);
    expect(f.sum).toMatchObject({ source: 'spySum', count: 2, units: { 202: 100, 204: 50, 210: 10, 212: 5 }, stat: { points: 600, time: t - 7200 }, check: 'match' });
    // the sum is the strongest sighting
    expect(f.fleet).toMatchObject({ source: 'spySum', time: t - 1800 });
    expect(f.fleetPoints).toEqual({ points: 600, time: t - 7200 });
  });

  it('does not take a sum above the statistics as the fleet', async () => {
    const f = (await fleetOf('Mover')).json();
    expect(f.sum).toMatchObject({ points: 12000, check: 'over' });
    expect(f.fleet).toMatchObject({ source: 'spy', points: 6000 });
  });

  it('rebuilds the fleet from battle reports under the current and earlier names', async () => {
    const f = (await fleetOf('Brawler')).json();
    const battles = f.sightings.filter((x: any) => x.source === 'battle');
    expect(battles.map((x: any) => x.reportId)).toEqual(['b1', 'b2', 'b3']);
    expect(battles[0]).toMatchObject({ units: { 204: 30, 210: 2 }, body: { g: 1, s: 50, p: 5, type: 'planet' } });
    expect(battles[1].body).toBeNull();
    // the most of each type over the battles of 14 days up to the newest one (the old one left out)
    expect(f.sightings.find((x: any) => x.source === 'battles')).toMatchObject({ units: { 204: 30, 210: 2, 202: 40 }, count: 2, time: t - 86400 });
    expect(f.fleet.source).toBe('battles');
    expect(f.sum).toBeNull();
  });

  it('takes the ships destroyed in battles after a sighting off it', async () => {
    const f = (await fleetOf('Loser')).json();
    const spy = f.sightings.find((x: any) => x.source === 'spy');
    // the battle before the report is not taken off, the one after it is (wherever it took place)
    expect(spy).toMatchObject({ units: { 205: 100, 206: 10 }, lost: { 205: 80 }, lostBattles: 1 });
    expect(spy.lostPoints).toBe(spy.points - (f.fleet.points - f.fleet.lostPoints));
    // a battle: what it lost in it too
    expect(f.sightings.find((x: any) => x.reportId === 'l2')).toMatchObject({ units: { 205: 100, 206: 10 }, lost: { 205: 80 }, lostBattles: 1 });
    expect(f.sightings.find((x: any) => x.reportId === 'l1')).toMatchObject({ lost: { 205: 50 }, lostBattles: 2 });
    expect(f.shrunk).toBe(false);
  });

  it('shows a fleet lost entirely, by battle reports or the statistics', async () => {
    const w = (await fleetOf('Wiped')).json();
    expect(w.fleet).toMatchObject({ units: { 207: 100 }, lost: { 207: 100 }, lostBattles: 1 });
    expect(w.fleet.lostPoints).toBe(w.fleet.points);
    const v = (await fleetOf('Vanished')).json();
    expect(v.fleet).toMatchObject({ source: 'spy', lostPoints: 0 });
    expect(v.shrunk).toBe(true);
    expect((await fleetOf('Spread')).json().shrunk).toBe(false);
  });

  it("takes a member's empire page with the fleets in flight then", async () => {
    const f = (await fleetOf('Carol')).json();
    const e = f.sightings.find((x: any) => x.source === 'empire');
    expect(e).toMatchObject({ time: t - 3600, units: { 202: 10, 204: 20, 214: 1, 207: 5, 203: 7 }, count: 2, body: null });
    expect(e.units[209]).toBeUndefined();
    // exact: an older spy report with more ships doesn't count any more
    expect(f.fleet.source).toBe('empire');
    // without a fleet list close to the empire page the fleets in flight are unknown
    const d = (await fleetOf('Dave')).json();
    expect(d.fleet).toMatchObject({ source: 'empire', units: { 205: 3 }, count: null });
  });

  it('answers without sightings and only for players of the group', async () => {
    expect((await fleetOf('Nobody')).json()).toEqual({ fleet: null, sum: null, sightings: [], fleetPoints: null, shrunk: false });
    const res = await app.inject({ method: 'GET', url: '/hub/api/u9/players/99999/fleet', headers: carol });
    expect(res.statusCode).toBe(404);
  });
});
