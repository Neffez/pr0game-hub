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
    expect(body).toMatchObject({ corrected: null, finalized: null, overrides: null, done: [] });
    expect(body.state).toEqual(body.draft.state);
    const { state, sources } = body.draft;
    const { result } = body;
    expect(state.participants.map((p: { id: string; name: string }) => [p.id, p.name])).toEqual([[`u${ids.carol}`, 'Carol'], [`u${ids.dave}`, 'Dave']]);
    expect(state.participants[0].flightDeut).toBeGreaterThan(0);
    expect(state.helpers).toEqual([{ id: `u${ids.erin}`, name: 'Erin', keepPct: 20, recDeut: 0 }]);
    expect(state.battles).toHaveLength(1);
    expect(state.battles[0]).toMatchObject({ key: 'r1', time: target, loot: { m: 400000, k: 200000, d: 50000 } });
    expect(state.battles[0].fleets).toEqual([
      { participant: `u${ids.carol}`, start: { 203: 10, 207: 70 }, end: { 203: 10, 207: 60 } },
      { participant: `u${ids.dave}`, start: { 207: 30 }, end: { 207: 30 } },
    ]);
    expect(state.recycling).toHaveLength(2);
    expect(sources.battles).toEqual([{ key: 'r1', reportId: 'r1', time: target, fleets: 'report' }]);
    // Carol lost 10 battleships
    expect(result.people[0].costs).toMatchObject({ m: 450000, k: 150000 });
    expect(result.warnings).toEqual([]);
    expect(body.me).toBe(`u${ids.dave}`);
    // what the members still have to sync: their fleet return messages
    expect(body.checks).toEqual({ battle: 'report', returns: { [`u${ids.carol}`]: 'missing', [`u${ids.dave}`]: 'missing' }, recycling: 'n/a', missing: 2 });
    expect(body).toMatchObject({ can_edit: true, plan: { id: planId, g: 2, s: 100, p: 8, target_time: target } });
    expect((await call('GET', `/plans/${planId}/settlement`, as.erin)).json().can_edit).toBe(false);
  });

  it('saves corrections for participants only, keeps it within the group and marks deliveries once finalized', async () => {
    const draft = (await call('GET', `/plans/${planId}/settlement`, as.carol)).json().draft.state;
    expect((await call('PUT', `/plans/${planId}/settlement`, as.erin, { state: draft })).statusCode).toBe(403);
    const saved = await call('PUT', `/plans/${planId}/settlement`, as.dave, { state: { ...draft, settings: { ...draft.settings, mode: 'investment' }, junk: 1 } });
    expect(saved.statusCode).toBe(200);
    // only the correction is stored
    expect(saved.json()).toMatchObject({ corrected: { updated_by: 'Dave' }, overrides: { settings: { mode: 'investment' } }, finalized: null, state: { settings: { mode: 'investment' } } });
    expect('junk' in saved.json().state).toBe(false);
    expect((await call('GET', `/plans/${planId}/settlement`, as.carolB)).statusCode).toBe(404);

    // deliveries are marked on the finalized settlement only
    const key = `u${ids.erin}>u${ids.carol}`;
    expect((await call('PUT', `/plans/${planId}/settlement/done`, as.erin, { key })).statusCode).toBe(404);
    expect((await call('POST', `/plans/${planId}/settlement/finalize`, as.erin, {})).statusCode).toBe(403);
    const final = (await call('POST', `/plans/${planId}/settlement/finalize`, as.carol, {})).json();
    expect(final.finalized).toMatchObject({ by: 'Carol', changes: { people: 0, battles: 0, recycling: 0, settings: 0 } });
    expect((await call('PUT', `/plans/${planId}/settlement`, as.dave, { state: draft })).json().code).toBe('settlement_finalized');
    // a helper may mark their own delivery, not others'
    expect((await call('PUT', `/plans/${planId}/settlement/done`, as.erin, { key })).json()).toEqual({ done: [key] });
    expect((await call('PUT', `/plans/${planId}/settlement/done`, as.erin, { key: `u${ids.dave}>u${ids.carol}` })).statusCode).toBe(403);
    expect((await call('PUT', `/plans/${planId}/settlement/done`, as.carol, { key, done: false })).json()).toEqual({ done: [] });

    const body = (await call('GET', `/plans/${planId}/settlement`, as.erin)).json();
    expect(body.result.people.find((p: { id: string }) => p.id === `u${ids.carol}`).share).toBeCloseTo(4_320_000 / 6_120_000); // 70 battleships + 10 heavy cargo vs. 30 battleships
    expect((await call('DELETE', `/plans/${planId}/settlement`, as.carol)).statusCode).toBe(200);
    expect((await call('GET', `/plans/${planId}/settlement`, as.carol)).json()).toMatchObject({ corrected: null, finalized: null });
  });

  it('follows data synced later, keeps corrections and freezes once finalized', async () => {
    const url = `/plans/${planId}/settlement`;
    const state = (await call('GET', url, as.carol)).json().state;
    state.participants[1].missiles = 4;
    state.battles[0].loot.d = 1;
    await call('PUT', url, as.carol, { state });
    // a recycling report synced after the correction flows in, the corrections stay
    const rec = db.prepare("INSERT INTO recycle_reports (group_id, user_id, dedupe_key, time, g, s, p, metal, crystal, total_metal, total_crystal) VALUES (?, ?, 'x4', ?, 2, 100, 8, 1000, 500, 0, 0)");
    rec.run(groupA, ids.dave, target + 800);
    let body = (await call('GET', url, as.carol)).json();
    expect(body.state.recycling.map((r: { m: number }) => r.m)).toEqual([300000, 200000, 1000]);
    expect(body.state.participants[1].missiles).toBe(4);
    expect(body.state.battles[0].loot).toEqual({ m: 400000, k: 200000, d: 1 });

    // finalized: frozen; data synced since shows as changes
    await call('POST', `${url}/finalize`, as.dave, {});
    db.prepare("DELETE FROM recycle_reports WHERE dedupe_key = 'x4'").run();
    body = (await call('GET', url, as.carol)).json();
    expect(body.state.recycling).toHaveLength(3);
    expect(body.finalized.changes).toEqual({ people: 0, battles: 0, recycling: 1, settings: 0 });
    // reopened: follows the data again
    body = (await call('DELETE', `${url}/finalize`, as.carol)).json();
    expect(body.finalized).toBeNull();
    expect(body.state.recycling).toHaveLength(2);
    expect(body.state.participants[1].missiles).toBe(4);
    await call('DELETE', url, as.carol);
  });

  it('turns a settlement saved before corrections existed into corrections when reopened', async () => {
    const url = `/plans/${planId}/settlement`;
    const old = (await call('GET', url, as.carol)).json().draft.state;
    for (const b of old.battles) delete b.key;
    for (const r of old.recycling) delete r.key;
    old.battles[0].loot.m = 5;
    // as the migration leaves it: the whole state, finalized
    db.prepare('INSERT INTO raid_settlements (plan_id, group_id, data, updated_by, updated_at, finalized_at, finalized_by) VALUES (?, ?, ?, ?, 100, 100, ?)')
      .run(planId, groupA, JSON.stringify(old), ids.carol, ids.carol);
    let body = (await call('GET', url, as.carol)).json();
    expect(body.finalized).toMatchObject({ at: 100, by: 'Carol' });
    expect(body.state.battles[0].loot.m).toBe(5);
    body = (await call('DELETE', `${url}/finalize`, as.carol)).json();
    expect(body.overrides).toEqual({ battles: { r1: { at: target, loot: { m: 5, k: 200000, d: 50000 } } } });
    expect(body.state.battles[0].key).toBe('r1');
    await call('DELETE', url, as.carol);
  });

  it('takes missiles, recycler and flight deuterium from synced messages and ticks off deliveries by transport messages', async () => {
    const url = `/plans/${planId}/settlement`;
    // the messages are stored like any sync
    const text = [
      'Transportbericht', '24. Okt 2026, 14:00:00',
      'Eine deiner Flotten von Heim [2:90:4] erreicht den Planet Dave [2:95:4] und liefert 1.000 Metall, 0 Kristall und 0 Deuterium.',
      'Raketeneinschlag', '24. Okt 2026, 12:50:00', 'Interplanetarraketen (3) von Heim [2:90:4] sind auf dem Planeten Ziel [2:100:8] eingeschlagen',
      'Flottenrückkehr', '24. Okt 2026, 13:30:00', 'Eine deiner Recycler-Flotten kehrt nach Heim [2:90:4] mit 1 Metall, 2 Kristall und 0 Deuterium zurück.',
    ].join('\n');
    const counts = (await call('POST', '/ingest', as.carol, { text })).json().counts;
    expect(counts).toMatchObject({ transports: { new: 1 }, missile_impacts: { new: 1 }, recycle_returns: { new: 1 } });
    expect((await call('POST', '/ingest', as.carol, { text })).json().counts).toMatchObject({ transports: { new: 0, duplicate: 1 } });
    for (const t of ['transports', 'missile_impacts', 'recycle_returns']) db.prepare(`DELETE FROM ${t}`).run();

    const planned = (await call('GET', url, as.carol)).json();
    expect(planned.draft.sources.flightDeutFrom).toEqual({ [`u${ids.carol}`]: 'plan', [`u${ids.dave}`]: 'plan' });
    // Carol fired 12 missiles before the battle (two messages), Dave's recyclers... none; her recyclers came home after 50 minutes
    const impact = db.prepare("INSERT INTO missile_impacts (group_id, user_id, dedupe_key, time, count, from_g, from_s, from_p, g, s, p) VALUES (?, ?, ?, ?, ?, 2, 90, 4, 2, 100, 8)");
    impact.run(groupA, ids.carol, 'i1', target - 600, 10);
    impact.run(groupA, ids.carol, 'i2', target - 500, 2);
    impact.run(groupA, ids.carol, 'i3', target - 3 * 86400, 99); // an older attack
    db.prepare("INSERT INTO recycle_returns (group_id, user_id, dedupe_key, time, home_g, home_s, home_p, metal, crystal, deuterium) VALUES (?, ?, 'c1', ?, 2, 90, 4, 300000, 100000, 0)")
      .run(groupA, ids.carol, target + 600 + 3000);
    // Dave's fleet flew home in 40 minutes (the plan said 100 %)
    const back = {
      owner: 'own', player: null, mission: 2, missionName: 'Verbandsangriff', phase: 'return', seconds: 0, clock: null, arrival: target + 2400,
      from: { coords: { g: 2, s: 100, p: 8 }, type: 'planet', name: 'Ziel' }, to: { coords: { g: 2, s: 95, p: 4 }, type: 'planet', name: 'Heim' },
      ships: { 207: 30 }, resources: { 901: 0, 902: 0, 903: 0 },
    };
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(groupA, ids.dave, target + 60, JSON.stringify([back]));
    let body = (await call('GET', url, as.carol)).json();
    const { sources, state } = body.draft;
    expect(sources.missiles).toEqual({ [`u${ids.carol}`]: 12 });
    expect(state.participants[0].missiles).toBe(12);
    expect(sources.recDeut[`u${ids.carol}`]).toBeGreaterThan(0);
    expect(state.participants[0].recDeut).toBe(sources.recDeut[`u${ids.carol}`]);
    expect(sources.flightDeutFrom).toEqual({ [`u${ids.carol}`]: 'plan', [`u${ids.dave}`]: 'fleet' });
    expect(state.participants[1].flightDeut).not.toBe(planned.draft.state.participants[1].flightDeut);
    expect(state.participants[0].flightDeut).toBe(planned.draft.state.participants[0].flightDeut);

    // finalized: the transport messages tick off the deliveries
    body = (await call('POST', `${url}/finalize`, as.carol, {})).json();
    const x = body.result.transfers.find((t: { res: { m: number; k: number; d: number } }) => t.res.m + t.res.k + t.res.d > 0);
    expect(body.auto_done).toEqual([]);
    const homes: Record<string, [number, number, number]> = { [`u${ids.carol}`]: [2, 90, 4], [`u${ids.dave}`]: [2, 95, 4], [`u${ids.erin}`]: [2, 80, 1] };
    const transport = db.prepare(
      `INSERT INTO transports (group_id, user_id, dedupe_key, time, side, from_g, from_s, from_p, to_g, to_s, to_p, metal, crystal, deuterium)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const sender = Number(x.from.slice(1));
    const receiver = Number(x.to.slice(1));
    // half of it first, synced by both (one transport), then the rest by the receiver only
    const half = { m: Math.floor(x.res.m / 2), k: Math.floor(x.res.k / 2), d: Math.floor(x.res.d / 2) };
    transport.run(groupA, sender, 't1', target + 4000, 'own', ...homes[x.from], ...homes[x.to], half.m, half.k, half.d);
    transport.run(groupA, receiver, 't1', target + 4000, 'foreign', ...homes[x.from], ...homes[x.to], half.m, half.k, half.d);
    body = (await call('GET', url, as.carol)).json();
    expect(body.delivered[`${x.from}>${x.to}`]).toEqual(half);
    expect(body.auto_done).toEqual([]);
    transport.run(groupA, receiver, 't2', target + 5000, 'foreign', ...homes[x.from], ...homes[x.to], x.res.m - half.m, x.res.k - half.k, x.res.d - half.d);
    body = (await call('GET', url, as.carol)).json();
    expect(body.auto_done).toEqual([`${x.from}>${x.to}`]);
    // a transport the other way does not count
    expect(body.delivered[`${x.to}>${x.from}`]).toBeUndefined();

    for (const t of ['transports', 'missile_impacts', 'recycle_returns']) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare('DELETE FROM fleet_snapshots WHERE user_id = ?').run(ids.dave);
    await call('DELETE', url, as.carol);
  });

  it('stores the loot of archived battle reports', async () => {
    const { storeCombatReport } = await import('../src/store.js');
    storeCombatReport(db, groupA, {
      kind: 'combatReport', reportId: 'r2', time: null, winner: 'attacker', rounds: 1, lost: { attacker: 0, defender: 0 },
      debris: { metal: 0, crystal: 0 }, loot: { metal: 1, crystal: 2, deuterium: 3 }, fleets: [],
    }, target);
    expect((await call('GET', '/combat-reports/r2', as.carol)).json()).toMatchObject({ loot_metal: 1, loot_crystal: 2, loot_deuterium: 3 });
  });

  it('completes a report archived from its public page with the pasted text (target, loot)', async () => {
    const { storeCombatReport } = await import('../src/store.js');
    const text = readFileSync(new URL('../../../packages/parser/test/fixtures/combat-report-de.txt', import.meta.url), 'utf8');
    const time = Date.UTC(2026, 9, 24, 11, 4, 3) / 1000;
    // archived from the link: coordinates hidden, loot not read yet
    storeCombatReport(db, groupB, {
      kind: 'combatReport', reportId: 'pub1', time: null, winner: 'attacker', rounds: 3, lost: { attacker: 11114000, defender: 411433000 },
      debris: { metal: 142823000, crystal: 68450500 }, loot: { metal: 0, crystal: 0, deuterium: 0 }, target: null, fleets: [],
    }, time + 1);
    expect((await call('POST', '/ingest', as.carolB, { text })).json().counts.combat_reports).toEqual({ new: 1, duplicate: 0 });
    expect(db.prepare('SELECT report_id, g, s, p, planet_type, loot_metal, loot_crystal, loot_deuterium FROM combat_reports WHERE group_id = ?').all(groupB)).toEqual([
      { report_id: 'pub1', g: 3, s: 195, p: 5, planet_type: 'moon', loot_metal: 0, loot_crystal: 1343846, loot_deuterium: 690373 },
    ]);
    // nothing left to add
    expect((await call('POST', '/ingest', as.carolB, { text })).json().counts.combat_reports).toEqual({ new: 0, duplicate: 1 });
    db.prepare('DELETE FROM combat_reports WHERE group_id = ?').run(groupB);
  });

  it('moves a report pasted as text to its game id when archived from the link later', async () => {
    const { storeCombatReport } = await import('../src/store.js');
    const text = readFileSync(new URL('../../../packages/parser/test/fixtures/combat-report-de.txt', import.meta.url), 'utf8');
    const time = Date.UTC(2026, 9, 24, 11, 4, 3) / 1000;
    expect((await call('POST', '/ingest', as.carolB, { text })).json().counts.combat_reports).toEqual({ new: 1, duplicate: 0 });
    const report = (loot: number) => ({
      kind: 'combatReport' as const, reportId: 'pub2', time: null, winner: 'attacker' as const, rounds: 3,
      lost: { attacker: 11114000, defender: 411433000 }, debris: { metal: 142823000, crystal: 68450500 },
      loot: { metal: 0, crystal: loot, deuterium: 0 }, target: null, fleets: [],
    });
    expect(storeCombatReport(db, groupB, report(1343846), time + 1)).toBe(true);
    // one report under the game id, keeping target and loot of the text
    expect(db.prepare('SELECT report_id, g, s, p, loot_crystal, loot_deuterium FROM combat_reports WHERE group_id = ?').all(groupB)).toEqual([
      { report_id: 'pub2', g: 3, s: 195, p: 5, loot_crystal: 1343846, loot_deuterium: 690373 },
    ]);
    expect(storeCombatReport(db, groupB, report(1343846), time + 1)).toBe(false);
    // a different battle at the same time stays apart
    expect(storeCombatReport(db, groupB, { ...report(5), reportId: 'pub3', lost: { attacker: 1, defender: 2 } }, time)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) FROM combat_reports WHERE group_id = ?').pluck().get(groupB)).toBe(2);
    db.prepare('DELETE FROM combat_reports WHERE group_id = ?').run(groupB);
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
    expect(draft.sources.battles).toEqual([{ key: `text-${time}-3-195-5`, reportId: `text-${time}-3-195-5`, time, fleets: 'report' }]);
    expect(draft.state.battles[0].loot).toEqual({ m: 0, k: 1343846, d: 690373 });
    expect(draft.state.battles[0].debris).toEqual({ m: 142823000, k: 68450500 });
    // a recycling report keeps the field it collected from
    db.prepare(
      `INSERT INTO recycle_reports (group_id, user_id, dedupe_key, time, g, s, p, metal, crystal, total_metal, total_crystal)
       VALUES (?, ?, 'x9', ?, 3, 195, 5, 40219074, 19280927, 142823000, 68469000)`,
    ).run(groupA, ids.dave, time + 9);
    expect((await call('GET', `/plans/${id}/settlement`, as.dave)).json().draft.state.recycling).toEqual([
      { key: expect.stringMatching(/^r\d+$/), by: `u${ids.dave}`, m: 40219074, k: 19280927, time: time + 9, field: { m: 142823000, k: 68469000 } },
    ]);
    db.prepare("DELETE FROM recycle_reports WHERE dedupe_key = 'x9'").run();

    // Rudolf's fleet return messages: his two fleets of this battle, then a later raid on the target
    const returned = (at: string, k: string, d: string) =>
      `Flottenrückkehr\n${at}\nEine deiner Flotten kehrt vom Angriff beim Planeten Rees [3:195:5] zurück zu Ra [3:200:1]. Sie haben 0 Metall, ${k} Kristall und ${d} Deuterium erbeutet\n`;
    const messages = [
      returned('24. Okt 2026, 13:48:06', '408.133', '209.670'), returned('24. Okt 2026, 13:42:23', '195.136', '100.247'),
      returned('24. Okt 2026, 18:00:00', '300.000', '100.000'),
    ].join('\n');
    expect((await call('POST', '/ingest', as.dave, { text: messages })).json().counts.fleet_returns).toEqual({ new: 3, duplicate: 0 });
    draft = (await call('GET', `/plans/${id}/settlement`, as.dave)).json().draft;
    expect(draft.sources.returnLoot).toEqual({ [`u${ids.dave}`]: { 0: { m: 0, k: 603269, d: 309917 } } });
    expect(draft.state.battles[0].fleets.find((f: any) => f.participant === `u${ids.dave}`).loot).toEqual({ m: 0, k: 603269, d: 309917 });
    // pasted again: nothing new
    expect((await call('POST', '/ingest', as.carol, { text: messages, forUser: ids.dave })).json().counts.fleet_returns).toEqual({ new: 0, duplicate: 3 });
    // CVXII synced no fleet return messages: his flights home in the overview, the same one in two fleet lists a second
    // apart and a later raid with the same ships
    const back = (arrival: number, ships: Record<number, number>, k: number, d: number) => ({
      owner: 'own', player: null, mission: 2, missionName: 'Verbandsangriff', phase: 'return', seconds: 0, clock: null, arrival,
      from: { coords: { g: 3, s: 195, p: 5 }, type: 'moon', name: 'Rees' }, to: { coords: { g: 3, s: 160, p: 5 }, type: 'moon', name: 'Mond' },
      ships, resources: { 901: 0, 902: k, 903: d },
    });
    const heavy = { 222: 3521 };
    const mixed = { 206: 323, 207: 11794, 215: 4406 };
    const snap = db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)');
    snap.run(groupA, ids.carol, time + 60, JSON.stringify([back(time + 3000, heavy, 100000, 50000), back(time + 3600, mixed, 600000, 300000)]));
    snap.run(groupA, ids.carol, time + 120, JSON.stringify([
      back(time + 3001, heavy, 100000, 50000), back(time + 3601, mixed, 600000, 300000), back(time + 20000, mixed, 90000, 9000),
    ]));
    draft = (await call('GET', `/plans/${id}/settlement`, as.dave)).json().draft;
    expect(draft.sources.returnSource).toEqual({ [`u${ids.dave}`]: 'message', [`u${ids.carol}`]: 'overview' });
    expect(draft.sources.returnLoot[`u${ids.carol}`]).toEqual({ 0: { m: 0, k: 700000, d: 350000 } });
    db.prepare('DELETE FROM fleet_snapshots WHERE user_id = ?').run(ids.carol);

    // more than the battle's loot on the way home (cargo from the way out): the shares by cargo space count
    db.prepare("UPDATE fleet_returns SET crystal = 2000000 WHERE crystal = 408133").run();
    draft = (await call('GET', `/plans/${id}/settlement`, as.dave)).json().draft;
    expect(draft.sources.returnLoot).toEqual({});
    expect(draft.sources.returnSource).toEqual({});
    db.prepare('DELETE FROM fleet_returns').run();
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
    expect(draft.sources.battles).toEqual([{ key: `text-${time}-3-195-5`, reportId: `text-${time}-3-195-5`, time: time + 1, fleets: 'report' }]);

    // pasted after the message: archived under the message's report id
    db.prepare('DELETE FROM combat_reports WHERE group_id = ? AND g = 3').run(groupA);
    res = await call('POST', '/ingest', as.dave, { text });
    expect(res.json().counts.combat_reports).toEqual({ new: 1, duplicate: 0 });
    expect(db.prepare('SELECT report_id FROM combat_reports WHERE group_id = ? AND g = 3').pluck().get(groupA)).toBe('abc123');
    expect((await call('POST', '/ingest', as.dave, { text })).json().counts.combat_reports).toEqual({ new: 0, duplicate: 1 });
    expect((await call('GET', `/plans/${id}/settlement`, as.dave)).json().draft.sources.battles).toEqual([{ key: 'abc123', reportId: 'abc123', time: time + 1, fleets: 'report' }]);
  });

  it('settles a hold like an ACS: the defenders share the debris, no loot', async () => {
    const time = Date.UTC(2026, 9, 24, 11, 4, 3) / 1000;
    db.prepare("UPDATE group_members SET ingame_name = 'Hustensaftdealer' WHERE user_id = ?").run(ids.erin);
    const id = Number(
      db.prepare("INSERT INTO attack_plans (group_id, user_id, g, s, p, planet_type, target_time, mission, status) VALUES (?, ?, 3, 195, 5, 'moon', ?, 'hold', 'launched')")
        .run(groupA, ids.dave, time - 1).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO attack_plan_enemy (plan_id, member_id, from_g, from_s, from_p, from_type, to_g, to_s, to_p, to_type, fleets, arrival, first_seen)
       VALUES (?, ?, 3, 26, 12, 'moon', 3, 195, 5, 'moon', '[]', ?, ?)`,
    ).run(id, ids.erin, time, time);
    await call('POST', `/plans/${id}/fleets`, as.dave, { g: 3, s: 200, p: 1, type: 'moon', ships: { 207: 10 }, speed: 100 });
    const draft = (await call('GET', `/plans/${id}/settlement`, as.erin)).json();
    expect(draft.plan).toMatchObject({ id, mission: 'hold' });
    const { state } = draft.draft;
    expect(state.participants.map((p: { id: string }) => p.id)).toEqual([`u${ids.dave}`, `u${ids.erin}`]);
    expect(state.battles).toHaveLength(1);
    expect(state.battles[0].loot).toEqual({ m: 0, k: 0, d: 0 });
    // the attacked member's ships from the report (defence left out), the hold fleet was not in this battle
    expect(state.battles[0].fleets).toEqual([
      {
        participant: `u${ids.erin}`,
        start: { 202: 136, 203: 1393, 204: 11101, 205: 55, 206: 7057, 207: 1061, 209: 400, 210: 316, 215: 1007, 222: 122, 225: 57, 227: 303 },
        end: {}, // all destroyed
      },
    ]);
    // the attacked member may save it (participant of the hold)
    expect((await call('PUT', `/plans/${id}/settlement`, as.erin, { state })).statusCode).toBe(200);
  });

  it('lists the attacks and holds to settle with their state', async () => {
    db.prepare("UPDATE attack_plans SET status = 'launched' WHERE id = ?").run(planId);
    const list = (await call('GET', '/settlements', as.carol)).json();
    const attack = list.find((x: { id: number }) => x.id === planId);
    expect(attack).toMatchObject({ mission: 'attack', g: 2, s: 100, p: 8, status: 'launched', battle: true, saved: null, stage: 'waiting', missing: 2, mine: [] });
    expect(attack.deadline).toBe(target + 86400);
    expect(attack.members.sort()).toEqual(['CVXII', 'Rudolf']);
    await call('PUT', `/plans/${planId}/settlement`, as.carol, { state: (await call('GET', `/plans/${planId}/settlement`, as.carol)).json().draft.state });
    const entry = async () => (await call('GET', '/settlements', as.carol)).json().find((x: { id: number }) => x.id === planId).saved;
    // open: its deliveries still follow the data
    expect(await entry()).toMatchObject({ updated_by: 'CVXII', finalized_at: null, deliveries: 0, done: 0 });
    await call('POST', `/plans/${planId}/settlement/finalize`, as.carol, {});
    const saved = await entry();
    expect(saved).toMatchObject({ finalized_at: expect.any(Number), done: 0 });
    expect(saved.deliveries).toBeGreaterThan(0);
    const finalized = (await call('GET', '/settlements', as.carol)).json().find((x: { id: number }) => x.id === planId);
    expect(finalized).toMatchObject({ stage: 'delivering', missing: null });
    // the caller's open deliveries, by name
    expect(finalized.mine.length).toBeGreaterThan(0);
    expect(finalized.mine.every((x: { from: string; to: string }) => x.from === 'CVXII' || x.to === 'CVXII')).toBe(true);
    // the bell (and push) tells the members what they send and get
    const bell = (await call('GET', '/notifications', as.carol)).json().filter((n: { kind: string }) => n.kind === 'settlement');
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({ member: 'CVXII', plan: { id: planId, g: 2, s: 100, p: 8 } });
    expect(bell[0].sends.length + bell[0].gets.length).toBe(finalized.mine.length);
    const { payloadOf } = await import('../src/push.js');
    const push = payloadOf(bell[0], 'de', 'u8', 'Europe/Berlin', groupA);
    expect(push.title).toBe('💰 Beuteabrechnung [2:100:8] festgeschrieben');
    expect(push.url).toContain(`/raid-planner/${planId}/loot`);
    // Erin (recycling helper) gets hers only: as many as her open deliveries in the list
    const erinMine = (await call('GET', '/settlements', as.erin)).json().find((x: { id: number }) => x.id === planId).mine;
    const erinBell = (await call('GET', '/notifications', as.erin)).json().filter((n: { kind: string }) => n.kind === 'settlement');
    expect(erinBell.flatMap((n: { sends: unknown[]; gets: unknown[] }) => [...n.sends, ...n.gets])).toHaveLength(erinMine.length);
    expect((await call('GET', '/settlements', as.carolB)).json()).toEqual([]);
  });

  it('makes a done plan from a pasted battle report, or takes the plan there', async () => {
    // [name, coords, ships before, ships after] per fleet; the first defender is the target
    type F = [string, string, string, number, number];
    // the battle of yesterday: plans are listed for a week after their time
    const day = new Date(Date.now() - 86400_000);
    const when = `${day.getUTCDate()}. ${['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][day.getUTCMonth()]} ${day.getUTCFullYear()}, 10:00:00`;
    const report = (attackers: F[], defenders: F[]) => {
      const block = (side: string, f: F, after: boolean) => [`${side} ${f[0]} (${f[1]})`, 'Typ', f[2], 'Anzahl', String(after ? f[4] : f[3])];
      const round = (after: boolean) => [...attackers.flatMap((f) => block('Angreifer', f, after)), ...defenders.flatMap((f) => block('Verteidiger', f, after))];
      return ['Folgende Flotten stehen sich gegenüber am ' + when, ...round(false), ...round(true),
        'Der Angreifer hat die Schlacht gewonnen!', 'Er erbeutet 1.000 Metall, 2.000 Kristall und 3.000 Deuterium'].join('\n');
    };
    const attack = report([['CVXII', '[5:10:3]', 'Schlachtschiff', 100, 99], ['Gast', '[5:20:1] (M)', 'Schlachtschiff', 50, 50]], [['Opfer', '[5:100:8]', 'Kl. Transporter', 10, 0]]);
    const res = await call('POST', '/settlements/from-report', as.erin, { text: attack });
    expect(res.json()).toMatchObject({ existing: false, mission: 'attack' });
    const id = res.json().id;
    const plan = (await call('GET', '/plans', as.erin)).json().find((p: { id: number }) => p.id === id);
    expect(plan).toMatchObject({ g: 5, s: 100, p: 8, planet_type: 'planet', status: 'done', mission: 'attack', time_precision: 'exact' });
    expect(plan.fleets.map((f: any) => [f.user_id, f.g, f.s, f.p, f.status, f.ships])).toEqual([[ids.carol, 5, 10, 3, 'launched', { 207: 100 }]]);
    expect(plan.guests).toMatchObject([{ player: null, name: 'Gast', from: { g: 5, s: 20, p: 1, type: 'moon' }, ships: { 207: 50 } }]);
    const { state } = (await call('GET', `/plans/${id}/settlement`, as.carol)).json().draft;
    expect(state.participants.map((p: { id: string; name: string }) => [p.id, p.name])).toEqual([[`u${ids.carol}`, 'CVXII'], ['g1', 'Gast']]);
    expect(state.participants[0].flightDeut).toBeGreaterThan(0);
    expect(state.battles).toEqual([{
      key: expect.any(String), time: expect.any(Number), loot: { m: 1000, k: 2000, d: 3000 },
      fleets: [{ participant: `u${ids.carol}`, start: { 207: 100 }, end: { 207: 99 } }, { participant: 'g1', start: { 207: 50 }, end: { 207: 50 } }],
    }]);
    // pasted again: the same plan
    expect((await call('POST', '/settlements/from-report', as.dave, { text: attack })).json()).toEqual({ id, existing: true, mission: 'attack' });

    // members defended: a hold, the first defender is the attacked member
    const hold = report([['Feind', '[6:1:1]', 'Schlachtschiff', 10, 10]], [['Hustensaftdealer', '[6:50:5]', 'Kl. Transporter', 5, 0], ['Rudolf', '[6:60:1]', 'Schlachtschiff', 3, 1]]);
    expect((await call('POST', '/settlements/from-report', as.carol, { text: hold, mission: 'attack' })).json().code).toBe('report_no_member');
    const h = (await call('POST', '/settlements/from-report', as.carol, { text: hold })).json();
    expect(h).toMatchObject({ existing: false, mission: 'hold' });
    expect(db.prepare('SELECT member_id, from_g, from_s, from_p FROM attack_plan_enemy WHERE plan_id = ?').get(h.id)).toEqual({ member_id: ids.erin, from_g: 6, from_s: 1, from_p: 1 });
    const holdState = (await call('GET', `/plans/${h.id}/settlement`, as.erin)).json().draft.state;
    expect(holdState.participants.map((p: { id: string }) => p.id)).toEqual([`u${ids.dave}`, `u${ids.erin}`]);
    expect(holdState.battles[0]).toMatchObject({ loot: { m: 0, k: 0, d: 0 } });

    expect((await call('POST', '/settlements/from-report', as.carol, { text: report([['A', '[7:1:1]', 'Schlachtschiff', 1, 1]], [['B', '[7:2:2]', 'Kl. Transporter', 1, 0]]) })).json().code).toBe('report_no_member');
    expect((await call('POST', '/settlements/from-report', as.carol, { text: 'nothing' })).json().code).toBe('report_invalid');
    // archived like a sync
    expect(db.prepare('SELECT COUNT(*) FROM combat_reports WHERE group_id = ? AND g IN (5, 6)').pluck().get(groupA)).toBe(2);
  });
});
