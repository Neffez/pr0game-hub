import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { fleetActivity, galaxyMark, phalanxActivity } = await import('../src/repo/activity.js');

const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let groupA = 0;
let groupB = 0;
let alpha = 0;
let carolId = 0;
let admin: Record<string, string>;
let carol: Record<string, string>;
let carolB: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api/u8${url}`, headers, payload });
const activity = async (headers = admin) => (await call('GET', `/players/${alpha}/activity`, headers)).json().events as any[];
const sources = (events: any[]) => events.map((e) => e.source).sort();
const stored = (source: string) => db.prepare('SELECT time, spread FROM player_activity WHERE player_id = ? AND source = ?').all(alpha, source) as any[];

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const adminCookie = await login('admin', 'adminpass');
  const h = { headers: { cookie: adminCookie } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  groupB = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(groupA, carolId);
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupB, carolId);
  const carolCookie = await login('carol', 'carolpass');
  admin = { cookie: adminCookie, 'x-hub-group': String(groupA) };
  carol = { cookie: carolCookie, 'x-hub-group': String(groupA) };
  carolB = { cookie: carolCookie, 'x-hub-group': String(groupB) };
});

describe('player activity', () => {
  it('keeps the galaxy activity mark once, the most exact sighting', async () => {
    // Alpha's planet 1:234:5 shows "(*)"
    for (let i = 0; i < 2; i++) expect((await call('POST', '/ingest', admin, { html: fixture('galaxy.html') })).statusCode).toBe(200);
    alpha = db.prepare("SELECT id FROM players WHERE group_id = ? AND name = 'Alpha'").pluck().get(groupA) as number;
    expect(stored('galaxy')).toEqual([{ time: expect.any(Number), spread: 450 }]);
    // "(3 min)" a little later on another planet: the same activity, more exact
    const t = now();
    expect(galaxyMark(db, groupA, alpha, { g: 1, s: 234, p: 6 }, 3, t)).toBe(true);
    expect(stored('galaxy')).toEqual([{ time: t - 180, spread: 60 }]);
    // and the vague one again: known
    expect(galaxyMark(db, groupA, alpha, { g: 1, s: 234, p: 5 }, 0, t)).toBe(false);
  });

  it('leaves out galaxy marks set by a member spying or fighting there', () => {
    const t = now() - 6 * 3600;
    db.prepare(
      "INSERT INTO spy_reports (group_id, g, s, p, planet_type, report_time, sections) VALUES (?, 1, 234, 5, 'planet', ?, '{}')",
    ).run(groupA, t - 20 * 60);
    expect(galaxyMark(db, groupA, alpha, { g: 1, s: 234, p: 5 }, 20, t)).toBe(false);
    expect(galaxyMark(db, groupA, alpha, { g: 1, s: 234, p: 5 }, 40, t)).toBe(true);
  });

  it('collects espionage, battles, messages and point gains', async () => {
    const t = now();
    db.prepare(
      `INSERT INTO hostile_spying (group_id, dedupe_key, time, from_player, from_g, from_s, from_p, from_type, target_g, target_s, target_p, target_type)
       VALUES (?, 'x1', ?, 'ALPHA', 1, 234, 5, 'planet', 2, 2, 2, 'planet')`,
    ).run(groupA, t - 3600);
    const hall = db.prepare('INSERT INTO battle_hall (group_id, report_id, time, attackers, defenders, units) VALUES (?, ?, ?, ?, ?, 1)');
    hall.run(groupA, 'r1', t - 7200, '["Alpha","Bob"]', '["Carl"]');
    // alone in the defense: maybe offline; with help: online
    hall.run(groupA, 'r2', t - 7300, '["Bob"]', '["Alpha"]');
    hall.run(groupA, 'r3', t - 7400, '["Bob"]', '["Alpha","Dora"]');
    // archived report wins over its hall entry
    hall.run(groupA, 'r4', t - 7500, '["Bob"]', '["Alpha","Dora"]');
    db.prepare(
      `INSERT INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets)
       VALUES (?, 'r4', ?, 'attacker', 1, 0, 0, 0, 0, '[[0,"Bob",[]],[1,"Alpha",[]]]')`,
    ).run(groupA, t - 7500);
    // carol's own message from Alpha, not shared
    db.prepare(
      `INSERT INTO player_messages (group_id, user_id, dedupe_key, time, from_name, recipients, subject, body)
       VALUES (?, ?, 'm1', ?, 'Alpha', '[]', 'Hi', 'Hi')`,
    ).run(groupA, carolId, t - 600);
    const snap = db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 1, ?)");
    const score = db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points) VALUES (?, ?, 1, ?)');
    score.run(snap.run(groupA, t - 12 * 3600).lastInsertRowid, alpha, 1000);
    score.run(snap.run(groupA, t - 6 * 3600).lastInsertRowid, alpha, 1500);

    const events = await activity();
    expect(sources(events)).toEqual(['attack', 'defense', 'galaxy', 'galaxy', 'points', 'spy']);
    expect(events.find((e) => e.source === 'points')).toMatchObject({ time: t - 9 * 3600, spread: 3 * 3600 });
    expect(sources(await activity(carol))).toContain('message');
  });

  it('notes launches and recalls of hostile fleets between two fleet lists', () => {
    const fleet = (ships: Record<number, number>, arrival: number) => ({
      owner: 'hostile' as const, player: null, mission: 1, missionName: 'Angreifen', phase: 'out' as const, acs: null,
      from: { coords: { g: 1, s: 234, p: 5 }, type: 'planet' as const, name: null },
      to: { coords: { g: 2, s: 2, p: 2 }, type: 'planet' as const, name: null },
      ships, resources: null, seconds: 0, clock: null, arrival,
    });
    const t = now();
    const a = fleet({ 204: 10 }, t + 3600);
    const b = fleet({ 205: 3 }, t + 3600);
    fleetActivity(db, groupA, carolId, { time: t - 1800, data: [a] }, { time: t, data: [b] });
    expect(stored('fleet')).toEqual([{ time: t - 900, spread: 900 }]);
    expect(stored('recall')).toEqual([{ time: t - 900, spread: 900 }]);
    // lists too far apart tell nothing
    fleetActivity(db, groupA, carolId, { time: t - 8 * 3600, data: [] }, { time: t, data: [a] });
    expect(stored('fleet')).toHaveLength(1);

    // phalanx: the return tells the flight time
    phalanxActivity(db, groupA, [
      { ...a, owner: 'own', arrival: t + 1000 },
      { ...a, owner: 'own', phase: 'return', from: a.to!, to: a.from, arrival: t + 4000 },
    ]);
    expect(stored('fleet')).toContainEqual({ time: t - 2000, spread: 60 });
  });

  it('takes manual reports, each member withdraws their own', async () => {
    const t = now();
    for (let i = 0; i < 2; i++) expect((await call('POST', `/players/${alpha}/activity`, carol, {})).statusCode).toBe(200);
    expect((await call('POST', `/players/${alpha}/activity`, admin, { time: t - 86400 })).statusCode).toBe(200);
    expect((await call('POST', `/players/${alpha}/activity`, admin, { time: t + 3600 })).json().code).toBe('activity_time_invalid');
    expect((await call('POST', `/players/${alpha}/activity`, admin, { time: t - 8 * 86400 })).json().code).toBe('activity_time_invalid');

    const manual = (await activity()).filter((e) => e.source === 'manual');
    expect(manual.map((e) => [e.reporter, e.mine])).toEqual([['admin', true], ['Carol', false]]);
    const carols = manual.find((e) => e.reporter === 'Carol');
    expect((await call('DELETE', `/players/${alpha}/activity/${carols.id}`, admin)).statusCode).toBe(404);
    expect((await call('DELETE', `/players/${alpha}/activity/${carols.id}`, carol)).statusCode).toBe(200);
    expect((await activity()).filter((e) => e.source === 'manual')).toHaveLength(1);
  });

  it('stays within the group', async () => {
    expect((await call('GET', `/players/${alpha}/activity`, carolB)).statusCode).toBe(404);
    expect((await call('POST', `/players/${alpha}/activity`, carolB, {})).statusCode).toBe(404);
  });
});
