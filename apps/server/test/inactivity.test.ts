import { beforeAll, describe, expect, it } from 'vitest';
import { positionTemp, projectResources } from '@pr0hub/core/production';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { inactivityOf, INACTIVITY } = await import('../src/repo/inactivity.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let carol: Record<string, string>;
const H = 3600;
/** newest statistics update, on the 6 h grid */
const T = Math.floor(Date.now() / 1000 / (6 * H)) * 6 * H;
const ids: Record<string, number> = {};

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const player = (name: string) => (ids[name] = Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(group, name).lastInsertRowid));
function score(playerId: number, type: number, time: number, points: number, rank: number) {
  db.prepare("INSERT OR IGNORE INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', ?, ?)").run(group, type, time);
  const snap = db.prepare("SELECT id FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = ? AND stat_time = ?").pluck().get(group, type, time);
  db.prepare('INSERT INTO player_scores (snapshot_id, player_id, type, stat_time, points, rank) VALUES (?, ?, ?, ?, ?, ?)').run(snap, playerId, type, time, points, rank);
}
const spy = (playerId: number, p: number, time: number, sections: object) =>
  db
    .prepare("INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_id, player_name, report_time, sections) VALUES (?, 2, 50, ?, 'planet', ?, 'x', ?, ?)")
    .run(group, p, playerId, time, JSON.stringify(sections));
const inactivity = async (name: string) => (await app.inject({ method: 'GET', url: `/hub/api/u8/players/${ids[name]}`, headers: carol })).json().inactivity;

const MINES = { 1: 20, 2: 15, 3: 10, 4: 22, 22: 6, 23: 6, 24: 6 };

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  db.prepare("UPDATE universes SET settings = json_set(COALESCE(settings, '{}'), '$.resourceMultiplier', 2500) WHERE slug = 'u8'").run();
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };

  for (const n of ['Busy1', 'Busy2', 'Busy3', 'Queue', 'Farmed', 'Attacker', 'Idle', 'Mover', 'Galaxy']) player(n);
  // 13 updates over three days; the busy players gain 1000 per update
  for (let k = 12; k >= 0; k--) {
    const time = T - k * 6 * H;
    const i = 12 - k;
    ['Busy1', 'Busy2', 'Busy3'].forEach((n, r) => score(ids[n], 1, time, 50_000 + i * 1000, r + 1));
    // a big gain in the first interval, then only builds finishing from the queue (+2)
    score(ids.Queue, 1, time, 40_000 + (i >= 1 ? 1000 : 0) + Math.max(0, i - 1) * 2, 4);
    // the rest: no gain at all
    for (const [r, n] of ['Farmed', 'Attacker', 'Idle', 'Mover', 'Galaxy'].entries()) score(ids[n], 1, time, 30_000, 5 + r);
    // Farmed loses defense half way and does not rebuild it
    score(ids.Farmed, 5, time, k > 6 ? 5000 : 2000, 1);
  }
  // Attacker attacked a member 5 hours ago
  db.prepare(
    "INSERT INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets) VALUES (?, 'r1', ?, 'a', 1, 0, 0, 0, 0, ?)",
  ).run(group, T - 5 * H, JSON.stringify([[0, 'attacker', []], [1, 'Carol', []]]));
  // Galaxy: two activity marks, Farmed none
  for (const [i, time] of [T - 20 * H, T - 10 * H].entries()) {
    db.prepare("INSERT INTO player_activity (group_id, player_id, time, source, dedupe_key) VALUES (?, ?, ?, 'galaxy', ?)").run(group, ids.Galaxy, time, `g${i}`);
  }
  // Idle: two reports 10 hours apart, the later one exactly the projection of the earlier one
  const res = { 901: 100_000, 902: 50_000, 903: 10_000 };
  const proj = projectResources({ resources: res, levels: { ...MINES, 212: 0 }, temp: positionTemp(7), resourceSpeed: 1, hours: 10 }).resources;
  spy(ids.Idle, 7, T - 30 * H, { 900: res, 0: MINES, 200: { 202: 2 } });
  spy(ids.Idle, 7, T - 20 * H, { 900: { 901: Math.round(proj[901]), 902: Math.round(proj[902]), 903: Math.round(proj[903]) }, 0: MINES, 200: { 202: 2 } });
  // Mover: the fleet shrank between two reports without a battle
  spy(ids.Mover, 8, T - 40 * H, { 900: res, 200: { 202: 10, 204: 50 } });
  spy(ids.Mover, 8, T - 4 * H, { 900: res, 200: { 202: 10 } });
});

describe('inactivity score', () => {
  const base = {
    status: [], inactiveSince: null, newest: 100 * H, inStats: true, firstUpdate: 20 * H, lastGain: null, weakGains: 0, proven: null, galaxy: [],
    idleSpy: [], lossesSince: null,
  };
  const at = (o: object) => inactivityOf({ ...base, ...o }, 100 * H);

  it('grows on a curve with the time since the latest sign of activity', () => {
    expect(at({ lastGain: 100 * H })).toMatchObject({ score: 0, level: 'active', since: null });
    expect(at({ lastGain: 76 * H })).toMatchObject({ score: 46, level: 'possible', since: 76 * H });
    expect(at({ lastGain: 52 * H })).toMatchObject({ score: 69, level: 'likely' });
    expect(at({ lastGain: 28 * H }).score).toBe(81);
    // nothing in the whole window: since its start at least
    expect(at({})).toMatchObject({ score: 84, level: 'likely', since: 20 * H, atLeast: true });
    expect(at({}).score).toBeLessThanOrEqual(INACTIVITY.max);
  });

  it('trusts the game flag and proof of activity', () => {
    expect(at({ status: ['inactive'], inactiveSince: 5 })).toMatchObject({ score: 95, level: 'inactive', since: 5, status: 'inactive' });
    expect(at({ lastGain: 28 * H, proven: { time: 99 * H, source: 'attack' } })).toMatchObject({ score: 3, level: 'active', lastActive: 99 * H });
  });

  it('counts galaxy marks only as a weak sign and confirms absence by spy reports and losses', () => {
    const one = at({ lastGain: 52 * H, galaxy: [60 * H] });
    expect(one.score).toBe(Math.round(69.2 * 0.7));
    expect(one.reasons).toContainEqual({ code: 'galaxy', n: 1, time: 60 * H });
    // marks before the last gain don't count
    expect(at({ lastGain: 52 * H, galaxy: [40 * H] }).score).toBe(69);
    expect(at({ lastGain: 52 * H, idleSpy: [70 * H, 90 * H] }).score).toBe(69 + 2 * INACTIVITY.idleSpyBonus);
    expect(at({ lastGain: 52 * H, lossesSince: 60 * H }).score).toBe(69 + INACTIVITY.lossBonus);
    expect(at({ status: [], newest: null, proven: { time: 99 * H, source: 'spy' } })).toMatchObject({ level: 'active' });
    expect(at({ newest: null })).toMatchObject({ level: 'unknown' });
  });
});

describe('inactivity from the hub data', () => {
  it('treats tiny gains among busy neighbours as a queue finishing', async () => {
    const q = await inactivity('Queue');
    expect(q.stall).toBe(T - 66 * H);
    expect(q.reasons).toContainEqual({ code: 'weakGains', n: 11 });
    expect(q).toMatchObject({ score: 79, level: 'likely' });
    expect((await inactivity('Busy2')).level).toBe('active');
  });

  it('uses proof: attacks and fleets that left between two spy reports', async () => {
    expect(await inactivity('Attacker')).toMatchObject({ level: 'active', lastActive: T - 5 * H });
    const mover = await inactivity('Mover');
    expect(mover.reasons).toContainEqual({ code: 'proven', source: 'fleetGone', time: T - 40 * H });
    expect(mover.since).toBe(T - 40 * H);
  });

  it('lowers the score for galaxy marks and raises it for idle spy reports and lost defense', async () => {
    const plain = (await inactivity('Galaxy')).score;
    const farmed = await inactivity('Farmed');
    const idle = await inactivity('Idle');
    expect(farmed.reasons).toContainEqual({ code: 'losses' });
    // no gain in the whole window (72 h: 81) plus the lost defense
    expect(farmed.score).toBe(81 + INACTIVITY.lossBonus);
    expect(idle.reasons).toContainEqual({ code: 'idleSpy', n: 1 });
    expect(plain).toBeLessThan(idle.score);
    expect((await inactivity('Galaxy')).reasons).toContainEqual({ code: 'galaxy', n: 2, time: T - 10 * H });
  });
});
