import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let groupA = 0;
let groupB = 0;
const ids: Record<string, number> = {};
const as: Record<string, Record<string, string>> = {};
let planId = 0;
let target = 0;

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api/u8${url}`, headers, payload });

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  for (const name of ['carol', 'dave', 'erin']) db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, hashPassword(`${name}pass`));
  const h = { headers: { cookie: await login('admin') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  groupB = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, ...h })).json().id;
  for (const name of ['carol', 'dave', 'erin']) {
    ids[name] = db.prepare('SELECT id FROM users WHERE username = ?').pluck().get(name) as number;
    db.prepare('INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, ?)').run(groupA, ids[name], name[0].toUpperCase() + name.slice(1));
    as[name] = { cookie: await login(name), 'x-hub-group': String(groupA) };
  }
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupB, ids.carol);
  as.carolB = { ...as.carol, 'x-hub-group': String(groupB) };

  target = Math.floor(Date.now() / 1000) + 3600;
  planId = (await call('POST', '/plans', as.carol, { g: 2, s: 100, p: 8, type: 'planet', target_time: target })).json().id;
  await call('POST', `/plans/${planId}/fleets`, as.carol, { g: 2, s: 90, p: 4, type: 'planet', ships: { 207: 70, 203: 10 }, speed: 100 });
  await call('POST', `/plans/${planId}/fleets`, as.dave, { g: 2, s: 95, p: 4, type: 'planet', ships: { 207: 30 }, speed: 100 });

  // one ACS battle synced by both participants, with its archived report
  const battle = db.prepare(
    `INSERT INTO battle_reports (group_id, user_id, dedupe_key, report_id, time, g, s, p, planet_type, outcome, lost_attacker, lost_defender,
       loot_metal, loot_crystal, loot_deuterium, debris_metal, debris_crystal) VALUES (?, ?, ?, ?, ?, 2, 100, 8, 'planet', 'win', 600000, 9000000, ?, ?, ?, 0, 0)`,
  );
  battle.run(groupA, ids.carol, 'r1', 'r1', target, 400000, 200000, 50000);
  battle.run(groupA, ids.dave, 'r1', 'r1', target, 400000, 200000, 50000);
  db.prepare(
    `INSERT INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets,
       loot_metal, loot_crystal, loot_deuterium) VALUES (?, 'r1', ?, 'attacker', 3, 600000, 9000000, 0, 0, ?, 400000, 200000, 50000)`,
  ).run(groupA, target, JSON.stringify([[0, 'Carol', [[207, 70, 60], [203, 10, 10]]], [0, 'Dave', [[207, 30, 30]]], [1, 'Victim', [[401, 100, 0]]]]));
  // recycling: Carol herself and Erin, a member outside the plan (helper)
  const rec = db.prepare('INSERT INTO recycle_reports (group_id, user_id, dedupe_key, time, g, s, p, metal, crystal, total_metal, total_crystal) VALUES (?, ?, ?, ?, 2, 100, 8, ?, ?, 0, 0)');
  rec.run(groupA, ids.carol, 'x1', target + 600, 300000, 100000);
  rec.run(groupA, ids.erin, 'x2', target + 700, 200000, 100000);
  rec.run(groupA, ids.erin, 'x3', target + 3 * 86400, 999999, 0); // too late
});

describe('raid settlements', () => {
  it('prefills a draft from the plan, the battle report and the recycling reports', async () => {
    const res = await call('GET', `/plans/${planId}/settlement`, as.dave);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.saved).toBeNull();
    const { state, sources, result } = body.draft;
    expect(state.participants.map((p: { id: string; name: string }) => [p.id, p.name])).toEqual([[`u${ids.carol}`, 'Carol'], [`u${ids.dave}`, 'Dave']]);
    expect(state.participants[0].flightDeut).toBeGreaterThan(0);
    expect(state.helpers).toEqual([{ id: `u${ids.erin}`, name: 'Erin', keepPct: 20, recDeut: 0 }]);
    expect(state.battles).toHaveLength(1);
    expect(state.battles[0]).toMatchObject({ time: target, loot: { m: 400000, k: 200000, d: 50000 } });
    expect(state.battles[0].fleets).toEqual([
      { participant: `u${ids.carol}`, start: { 203: 10, 207: 70 }, end: { 203: 10, 207: 60 } },
      { participant: `u${ids.dave}`, start: { 207: 30 }, end: { 207: 30 } },
    ]);
    expect(state.recycling).toHaveLength(2);
    expect(sources.battles).toEqual([{ reportId: 'r1', time: target, fleets: 'report' }]);
    // Carol lost 10 battleships
    expect(result.people[0].costs).toMatchObject({ m: 450000, k: 150000 });
    expect(result.warnings).toEqual([]);
    expect(body.me).toBe(`u${ids.dave}`);
    expect(body).toMatchObject({ can_edit: true, plan: { id: planId, g: 2, s: 100, p: 8, target_time: target } });
    expect((await call('GET', `/plans/${planId}/settlement`, as.erin)).json().can_edit).toBe(false);
  });

  it('saves for participants only, keeps it within the group and marks deliveries', async () => {
    const draft = (await call('GET', `/plans/${planId}/settlement`, as.carol)).json().draft.state;
    expect((await call('PUT', `/plans/${planId}/settlement`, as.erin, { state: draft })).statusCode).toBe(403);
    const saved = await call('PUT', `/plans/${planId}/settlement`, as.dave, { state: { ...draft, settings: { ...draft.settings, mode: 'investment' }, junk: 1 } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ updated_by: 'Dave', done: [], state: { settings: { mode: 'investment' } } });
    expect('junk' in saved.json().state).toBe(false);
    expect((await call('GET', `/plans/${planId}/settlement`, as.carolB)).statusCode).toBe(404);

    // a helper may mark their own delivery, not others'
    const key = `u${ids.erin}>u${ids.carol}`;
    expect((await call('PUT', `/plans/${planId}/settlement/done`, as.erin, { key })).json()).toEqual({ done: [key] });
    expect((await call('PUT', `/plans/${planId}/settlement/done`, as.erin, { key: `u${ids.dave}>u${ids.carol}` })).statusCode).toBe(403);
    expect((await call('PUT', `/plans/${planId}/settlement/done`, as.carol, { key, done: false })).json()).toEqual({ done: [] });

    const body = (await call('GET', `/plans/${planId}/settlement`, as.erin)).json();
    expect(body.saved.result.people.find((p: { id: string }) => p.id === `u${ids.carol}`).share).toBeCloseTo(4_320_000 / 6_120_000); // 70 battleships + 10 heavy cargo vs. 30 battleships
    expect((await call('DELETE', `/plans/${planId}/settlement`, as.carol)).statusCode).toBe(200);
    expect((await call('GET', `/plans/${planId}/settlement`, as.carol)).json().saved).toBeNull();
  });

  it('stores the loot of archived battle reports', async () => {
    const { storeCombatReport } = await import('../src/store.js');
    storeCombatReport(db, groupA, {
      kind: 'combatReport', reportId: 'r2', time: null, winner: 'attacker', rounds: 1, lost: { attacker: 0, defender: 0 },
      debris: { metal: 0, crystal: 0 }, loot: { metal: 1, crystal: 2, deuterium: 3 }, fleets: [],
    }, target);
    expect((await call('GET', '/combat-reports/r2', as.carol)).json()).toMatchObject({ loot_metal: 1, loot_crystal: 2, loot_deuterium: 3 });
  });

  it('takes battle reports pasted as text: by the battle message, else under a local id', async () => {
    const text = readFileSync(new URL('../../../packages/parser/test/fixtures/combat-report-de.txt', import.meta.url), 'utf8');
    const time = Date.UTC(2026, 9, 24, 11, 4, 3) / 1000; // 13:04:03 in Europe/Berlin (summer time)
    db.prepare("UPDATE group_members SET ingame_name = 'CVXII' WHERE user_id = ?").run(ids.carol);
    db.prepare("UPDATE group_members SET ingame_name = 'Rudolf' WHERE user_id = ?").run(ids.dave);
    const id = (await call('POST', '/plans', as.carol, { g: 3, s: 195, p: 5, type: 'moon', target_time: time })).json().id;
    await call('POST', `/plans/${id}/fleets`, as.carol, { g: 3, s: 26, p: 12, type: 'moon', ships: { 222: 3544 }, speed: 100 });
    await call('POST', `/plans/${id}/fleets`, as.dave, { g: 3, s: 200, p: 1, type: 'moon', ships: { 225: 4821 }, speed: 100 });

    // no battle message yet: archived under a local id, the draft takes its fleets
    let res = await call('POST', '/ingest', as.carol, { text });
    expect(res.json().counts.combat_reports).toEqual({ new: 1, duplicate: 0 });
    expect(db.prepare('SELECT report_id, g, s, p, planet_type, loot_crystal FROM combat_reports WHERE group_id = ? AND g = 3').get(groupA)).toEqual({
      report_id: `text-${time}-3-195-5`, g: 3, s: 195, p: 5, planet_type: 'moon', loot_crystal: 1343846,
    });
    let draft = (await call('GET', `/plans/${id}/settlement`, as.dave)).json().draft;
    expect(draft.sources.battles).toEqual([{ reportId: `text-${time}-3-195-5`, time, fleets: 'report' }]);
    expect(draft.state.battles[0].loot).toEqual({ m: 0, k: 1343846, d: 690373 });
    expect(draft.state.battles[0].fleets).toEqual([
      { participant: `u${ids.carol}`, start: { 206: 347, 207: 11799, 215: 4406, 222: 3544 }, end: { 206: 323, 207: 11794, 215: 4406, 222: 3521 } },
      { participant: `u${ids.dave}`, start: { 207: 2178, 215: 4348, 225: 4821 }, end: { 207: 2178, 215: 4348, 225: 3901 } },
    ]);

    // the battle message synced later: one battle, joined by target and time
    db.prepare(
      `INSERT INTO battle_reports (group_id, user_id, dedupe_key, report_id, time, g, s, p, planet_type, outcome, lost_attacker, lost_defender,
         loot_metal, loot_crystal, loot_deuterium, debris_metal, debris_crystal) VALUES (?, ?, 'r9', 'abc123', ?, 3, 195, 5, 'moon', 'win', 0, 0, 0, 1343846, 690373, 0, 0)`,
    ).run(groupA, ids.dave, time + 1);
    draft = (await call('GET', `/plans/${id}/settlement`, as.dave)).json().draft;
    expect(draft.sources.battles).toEqual([{ reportId: `text-${time}-3-195-5`, time: time + 1, fleets: 'report' }]);

    // pasted after the message: archived under the message's report id
    db.prepare('DELETE FROM combat_reports WHERE group_id = ? AND g = 3').run(groupA);
    res = await call('POST', '/ingest', as.dave, { text });
    expect(res.json().counts.combat_reports).toEqual({ new: 1, duplicate: 0 });
    expect(db.prepare('SELECT report_id FROM combat_reports WHERE group_id = ? AND g = 3').pluck().get(groupA)).toBe('abc123');
    expect((await call('POST', '/ingest', as.dave, { text })).json().counts.combat_reports).toEqual({ new: 0, duplicate: 1 });
    expect((await call('GET', `/plans/${id}/settlement`, as.dave)).json().draft.sources.battles).toEqual([{ reportId: 'abc123', time: time + 1, fleets: 'report' }]);
  });
});
