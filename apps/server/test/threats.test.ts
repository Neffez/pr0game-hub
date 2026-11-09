import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { peakOf } = await import('../src/repo/threats.js');

/** Who threatens me (A-5): ranking of the players who spied on or attacked the viewer. */
const db = openDb(':memory:');
const app = buildApp(db, { logger: false, push: { contact: '' } });
let group = 0;
let other = 0;
const ids: Record<string, number> = {};
const h: Record<string, Record<string, string>> = {};
const t = Math.floor(Date.now() / 1000);
const DAY = 86400;

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url: `/hub/api${url}`, headers });
const player = (g: number, name: string) => Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(g, name).lastInsertRowid);
const planet = (g: number, playerId: number, c: [number, number, number]) =>
  db.prepare("INSERT INTO planets (group_id, player_id, g, s, p, name) VALUES (?, ?, ?, ?, ?, 'x')").run(g, playerId, ...c);
let spyId = 0;
const spy = (g: number, user: string, from: string, time: number, target: [number, number, number]) =>
  db.prepare(
    `INSERT INTO hostile_spying (group_id, user_id, dedupe_key, time, from_player, from_g, from_s, from_p, from_type, target_g, target_s, target_p, target_type)
     VALUES (?, ?, ?, ?, ?, 9, 9, 9, 'planet', ?, ?, ?, 'planet')`,
  ).run(g, ids[user], `k${++spyId}`, time, from, ...target);
const battle = (g: number, time: number, at: [number, number, number], attackers: string[]) =>
  db.prepare(
    `INSERT INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets, g, s, p)
     VALUES (?, ?, ?, 'attacker', 1, 0, 0, 0, 0, ?, ?, ?, ?)`,
  ).run(g, `r${++spyId}`, time, JSON.stringify([...attackers.map((n) => [0, n, [[204, 10, 10]]]), [1, 'Carol', [[401, 5, 0]]]]), ...at);
const score = (g: number, playerId: number, time: number, points: number) => {
  db.prepare("INSERT OR IGNORE INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 2, ?)").run(g, time);
  const snap = db.prepare("SELECT id FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = 2 AND stat_time = ?").pluck().get(g, time);
  db.prepare('INSERT INTO player_scores (snapshot_id, player_id, points, rank) VALUES (?, ?, ?, 1)').run(snap, playerId, points);
};

beforeAll(async () => {
  await app.ready();
  for (const name of ['admin', 'carol', 'dave', 'erin']) {
    db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)').run(name, hashPassword(`${name}pass`), name === 'admin' ? 1 : 0);
    ids[name] = db.prepare('SELECT id FROM users WHERE username = ?').pluck().get(name) as number;
  }
  const admin = { cookie: await login('admin') };
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url: `/hub/api${url}`, headers: admin, payload });
  await post('/admin/universes', { slug: 'u8', name: 'Universum 8' });
  group = (await post('/admin/groups', { universe: 'u8', name: 'A' })).json().id;
  other = (await post('/admin/groups', { universe: 'u8', name: 'B' })).json().id;
  const carol = player(group, 'Carol');
  player(group, 'Dave');
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, ids.carol);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Dave')").run(group, ids.dave);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Erin')").run(other, ids.erin);
  h.carol = { cookie: await login('carol'), 'x-hub-group': String(group) };
  h.dave = { cookie: await login('dave'), 'x-hub-group': String(group) };
  h.erin = { cookie: await login('erin'), 'x-hub-group': String(other) };
  planet(group, carol, [1, 100, 5]);
  planet(group, carol, [2, 50, 8]);

  const raider = player(group, 'Raider');
  planet(group, raider, [1, 110, 4]);
  planet(group, raider, [4, 1, 1]);
  score(group, raider, t - 40 * DAY, 1000);
  score(group, raider, t - 3600, 5000);
  const snoop = player(group, 'Snoop');
  score(group, snoop, t - 2 * DAY, 800);

  // Raider: one battle at Carol's planet two days ago and two probes; Snoop: six probes, always around the same hour
  battle(group, t - 2 * DAY, [1, 100, 5], ['Raider', 'Dave']);
  spy(group, 'carol', 'Raider', t - DAY, [1, 100, 5]);
  spy(group, 'carol', 'raider', t - 3 * DAY, [2, 50, 8]);
  for (let i = 1; i <= 6; i++) spy(group, 'carol', 'Snoop', t - i * DAY, [2, 50, 8]);
  // outside the period, on another member, in another alliance: none of Carol's business
  spy(group, 'carol', 'Old', t - 60 * DAY, [1, 100, 5]);
  spy(group, 'dave', 'Other', t - DAY, [3, 3, 3]);
  spy(other, 'erin', 'Raider', t - DAY, [1, 100, 5]);
  battle(group, t - DAY, [3, 3, 3], ['Elsewhere']);
});

describe('who threatens me', () => {
  it('ranks attackers above spies and leaves out allies, other members and other alliances', async () => {
    const res = (await call('/u8/threats', h.carol)).json();
    expect(res).toMatchObject({ days: 30, ownPlanets: 2 });
    expect(res.threats.map((x: any) => x.player.name)).toEqual(['Raider', 'Snoop']);
    const [raider, snoop] = res.threats;
    expect(raider).toMatchObject({ spied: { count: 2, last: t - DAY }, attacked: { count: 1, last: t - 2 * DAY }, incoming: { count: 0, next: null }, planets: 2 });
    expect(raider.targets).toEqual([{ g: 1, s: 100, p: 5, count: 2 }, { g: 2, s: 50, p: 8, count: 1 }]);
    expect(snoop).toMatchObject({ spied: { count: 6 }, attacked: { count: 0, last: null }, reach: null, planets: 0 });
    expect(raider.score).toBeGreaterThan(snoop.score);
    // Dave fought on the attackers' side of the report: an ally is no threat
    expect(res.threats.some((x: any) => x.player.name === 'Dave')).toBe(false);
    expect((await call('/u8/threats', h.dave)).json().threats.map((x: any) => x.player.name)).toEqual(['Other']);
    expect((await call('/u8/threats', h.erin)).json().threats.map((x: any) => x.player.name)).toEqual(['Raider']);
  });

  it('shows the fleet points trend, the nearest planet with its flight time and the usual hours', async () => {
    const [raider, snoop] = (await call('/u8/threats?days=30', h.carol)).json().threats;
    expect(raider.fleetPoints).toEqual({ points: 5000, time: t - 3600, before: { points: 1000, time: t - 40 * DAY } });
    // no update before the period and only one within it: no trend
    expect(snoop.fleetPoints).toEqual({ points: 800, time: t - 2 * DAY, before: null });
    expect(raider.reach).toMatchObject({ from: { g: 1, s: 110, p: 4 }, to: { g: 1, s: 100, p: 5 }, ship: 207, shipKnown: false, researchKnown: false });
    expect(raider.reach.duration).toBeGreaterThan(0);
    expect(raider.peak).toBeNull();
    expect(snoop.hours.reduce((a: number, b: number) => a + b, 0)).toBe(6);
    expect(snoop.peak.share).toBe(1);
  });

  it('counts an attack on its way and validates the period', async () => {
    const fleet = {
      owner: 'hostile', player: 'Raider', mission: 1, missionName: 'Angreifen', phase: 'out', ships: { 207: 50 }, resources: null, arrival: t + 3600,
      from: { coords: { g: 1, s: 110, p: 4 }, type: 'planet', name: null }, to: { coords: { g: 1, s: 100, p: 5 }, type: 'planet', name: null },
    };
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, ids.carol, t, JSON.stringify([fleet]));
    const res = (await call('/u8/threats?days=7', h.carol)).json();
    expect(res.threats[0]).toMatchObject({ player: { name: 'Raider' }, incoming: { count: 1, next: t + 3600 } });
    expect((await call('/u8/threats?days=0', h.carol)).statusCode).toBe(400);
    expect((await call('/u8/threats?days=x', h.carol)).statusCode).toBe(400);
  });

  it('finds the densest hours of the day, also over midnight', () => {
    const hours = new Array<number>(24).fill(0);
    hours[23] = 3;
    hours[0] = 2;
    hours[12] = 1;
    expect(peakOf(hours)).toEqual({ from: 21, to: 1, share: 5 / 6 });
    expect(peakOf(new Array<number>(24).fill(0))).toBeNull();
  });
});
