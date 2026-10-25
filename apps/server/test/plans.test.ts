import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { events } = await import('../src/events.js');
const { retimeHome } = await import('../src/repo/plans.js');
const { UNIVERSE_DEFAULTS } = await import('../src/config.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let groupA = 0;
let groupB = 0;
let admin: Record<string, string>;
let carol: Record<string, string>;
let dave: Record<string, string>;
let carolB: Record<string, string>;
let carolId = 0;
let daveId = 0;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api/u8${url}`, headers, payload });
const soon = () => Math.floor(Date.now() / 1000) + 3600;

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  for (const name of ['carol', 'dave']) db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, hashPassword(`${name}pass`));
  const adminCookie = await login('admin', 'adminpass');
  const h = { headers: { cookie: adminCookie } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  groupB = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, ...h })).json().id;
  carolId = db.prepare("SELECT id FROM users WHERE username = 'carol'").pluck().get() as number;
  daveId = db.prepare("SELECT id FROM users WHERE username = 'dave'").pluck().get() as number;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(groupA, carolId);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Dave')").run(groupA, daveId);
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupB, carolId);
  // Carol's empire page: drive research for the flight times
  db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(
    groupA, carolId, 1893456000, JSON.stringify({ kind: 'empire', research: { 115: 10, 117: 8, 118: 6, 108: 9 }, planets: [] }),
  );
  admin = { cookie: adminCookie, 'x-hub-group': String(groupA) };
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(groupA) };
  dave = { cookie: await login('dave', 'davepass'), 'x-hub-group': String(groupA) };
  carolB = { ...carol, 'x-hub-group': String(groupB) };
});

describe('attack plans', () => {
  it('creates a plan, claims the target and lists it for the alliance only', async () => {
    const publish = vi.spyOn(events, 'publish');
    const res = await call('POST', '/plans', carol, { g: 1, s: 41, p: 1, type: 'moon', target_time: soon(), note: ' Konter ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ claimedBy: null });
    expect(publish).toHaveBeenCalledWith(groupA, expect.objectContaining({ type: 'data', tables: ['attack_plans', 'target_claims'] }));
    publish.mockRestore();

    const list = (await call('GET', '/plans', dave)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ g: 1, s: 41, p: 1, planet_type: 'moon', creator: 'Carol', note: 'Konter', status: 'planning', claim_user_id: carolId, fleets: [] });
    const claims = (await call('GET', '/claims', dave)).json();
    expect(claims).toEqual([expect.objectContaining({ g: 1, s: 41, p: 1, planet_type: 'moon', kind: 'attack', member: 'Carol' })]);
    expect(claims[0].expires_at - list[0].target_time).toBe(600);
    expect((await call('GET', '/plans', carolB)).json()).toEqual([]);

    // a target claimed by someone else: the plan comes without claim
    const other = (await call('POST', '/plans', dave, { g: 1, s: 41, p: 1, type: 'moon', target_time: soon() })).json();
    expect(other.claimedBy).toBe('Carol');
    await call('DELETE', `/plans/${other.id}`, dave);
  });

  it('adds fleets with ships and speed, each member their own', async () => {
    const plan = (await call('GET', '/plans', carol)).json()[0];
    const own = await call('POST', `/plans/${plan.id}/fleets`, carol, { g: 1, s: 40, p: 5, type: 'planet', ships: { 207: 1773, 215: 2, 202: 0 }, speed: 90 });
    expect(own.statusCode).toBe(200);
    // Dave has no fleet in the plan yet: Carol's fleet is not his to change
    expect((await call('PUT', `/plans/${plan.id}/fleets/${own.json().id}`, dave, { speed: 50 })).json().code).toBe('plan_fleet_not_yours');
    expect((await call('POST', `/plans/${plan.id}/fleets`, dave, { g: 1, s: 42, p: 7, ships: { 204: 100 } })).statusCode).toBe(200);
    // every member may invite, only members of the group
    expect((await call('POST', `/plans/${plan.id}/fleets`, dave, { user_id: 99999 })).json().code).toBe('member_not_found');
    expect((await call('POST', `/plans/${plan.id}/fleets`, dave, { user_id: carolId })).statusCode).toBe(200);
    expect((await call('POST', `/plans/${plan.id}/fleets`, carol, { user_id: daveId })).statusCode).toBe(200);
    // the invitations ring the invited member's bell, naming who invited
    expect((await call('GET', '/notifications', dave)).json()).toEqual([
      expect.objectContaining({ id: `invite:${plan.id}`, kind: 'invite', userId: carolId, member: 'Carol', time: plan.target_time, plan: expect.objectContaining({ id: plan.id, g: 1, s: 41, p: 1, planet_type: 'moon', mission: 'attack' }) }),
    ]);
    expect((await call('GET', '/notifications', carol)).json()).toEqual([expect.objectContaining({ id: `invite:${plan.id}`, userId: daveId, member: 'Dave' })]);
    const carolInvite = (await call('GET', '/plans', carol)).json()[0].fleets.find((f: any) => f.member === 'Carol' && f.status === 'invited');
    expect((await call('DELETE', `/plans/${plan.id}/fleets/${carolInvite.id}`, carol)).statusCode).toBe(200);

    const fleets = (await call('GET', '/plans', dave)).json()[0].fleets;
    expect(fleets.map((f: any) => [f.member, f.status, f.speed, f.ships])).toEqual([
      ['Carol', 'ready', 90, { 207: 1773, 215: 2 }],
      ['Dave', 'ready', 100, { 204: 100 }],
      ['Dave', 'invited', 100, {}],
    ]);
    expect(fleets[0]).toMatchObject({ g: 1, s: 40, p: 5, planet_type: 'planet', drives: { time: 1893456000, research: { 115: 10, 117: 8, 118: 6, 134: 0 } } });
    expect(fleets[1].drives).toBeNull();

    // Dave changes his own fleet and, as a participant, also Carol's (but cannot remove it); Carol as creator may change Dave's
    expect((await call('PUT', `/plans/${plan.id}/fleets/${fleets[1].id}`, dave, { speed: 50, ships: { 204: 120 } })).statusCode).toBe(200);
    expect((await call('PUT', `/plans/${plan.id}/fleets/${fleets[0].id}`, dave, { speed: 90, ships: { 207: 1773, 215: 2 } })).statusCode).toBe(200);
    expect((await call('DELETE', `/plans/${plan.id}/fleets/${fleets[0].id}`, dave)).json().code).toBe('plan_fleet_not_yours');
    expect((await call('PUT', `/plans/${plan.id}/fleets/${fleets[2].id}`, carol, { status: 'withdrawn' })).statusCode).toBe(200);
    expect((await call('GET', '/notifications', dave)).json()).toEqual([]);
    expect((await call('DELETE', `/plans/${plan.id}/fleets/${fleets[2].id}`, dave)).statusCode).toBe(200);
    const after = (await call('GET', '/plans', carol)).json()[0].fleets;
    expect(after.map((f: any) => [f.member, f.speed, f.ships])).toEqual([['Carol', 90, { 207: 1773, 215: 2 }], ['Dave', 50, { 204: 120 }]]);
  });

  it("takes a member's drives from the spy reports without an empire page, or by hand; the newest counts", async () => {
    const plan = (await call('GET', '/plans', carol)).json()[0];
    const daveFleet = () => (call('GET', '/plans', carol) as Promise<any>).then((r) => r.json()[0].fleets.find((f: any) => f.member === 'Dave'));
    expect((await daveFleet()).drives).toBeNull();
    // a spy report of Dave's player (by name) with research
    const t0 = Math.floor(Date.now() / 1000) - 3600;
    const playerId = db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Dave')").run(groupA).lastInsertRowid;
    const spy = db.prepare('INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_name, player_id, report_time, sections) VALUES (?, 1, 42, 7, ?, ?, ?, ?, ?)');
    spy.run(groupA, 'planet', 'Dave', playerId, t0, JSON.stringify({ 100: { 115: 7, 117: 5, 118: 3, 109: 4 }, 200: { 204: 300 } }));
    expect((await daveFleet()).drives).toEqual({ time: t0, source: 'spy', research: { 115: 7, 117: 5, 118: 3, 134: 0, 109: 4, 110: 0, 111: 0 } });
    // the fleet form gets the planets and ships from the same reports
    const imp = (await call('GET', `/imperium?user=${daveId}`, carol)).json();
    expect(imp.empire).toBeNull();
    expect(imp.spy).toMatchObject({ researchTime: t0, planets: [{ coords: { g: 1, s: 42, p: 7 }, type: 'planet', values: { 204: 300 } }] });

    // by hand: only drives, any participant; the other research stays from the report
    const f = await daveFleet();
    expect((await call('PUT', `/plans/${plan.id}/fleets/${f.id}`, carol, { drives: { 115: 8, 109: 1 } })).json().code).toBe('plan_drives_invalid');
    expect((await call('PUT', `/plans/${plan.id}/fleets/${f.id}`, carol, { drives: { 117: 100 } })).json().code).toBe('plan_drives_invalid');
    expect((await call('PUT', `/plans/${plan.id}/fleets/${f.id}`, carol, { drives: { 115: 8, 117: 6, 118: 4 } })).statusCode).toBe(200);
    expect((await daveFleet()).drives).toMatchObject({ source: 'manual', research: { 115: 8, 117: 6, 118: 4, 109: 4 } });
    // a newer report wins over the levels by hand
    spy.run(groupA, 'moon', 'Dave', playerId, Math.floor(Date.now() / 1000) + 60, JSON.stringify({ 100: { 115: 9, 117: 6, 118: 5 } }));
    expect((await daveFleet()).drives).toMatchObject({ source: 'spy', research: { 115: 9, 117: 6, 118: 5 } });
    // null drops the levels by hand
    expect((await call('PUT', `/plans/${plan.id}/fleets/${f.id}`, dave, { drives: null })).statusCode).toBe(200);
    expect(db.prepare('SELECT drives, drives_time FROM attack_plan_fleets WHERE id = ?').get(f.id)).toEqual({ drives: null, drives_time: null });
    db.prepare('DELETE FROM spy_reports WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  });

  it('validates the input', async () => {
    const plan = (await call('GET', '/plans', carol)).json()[0];
    expect((await call('POST', '/plans', carol, { g: 9, s: 1, p: 1, target_time: soon() })).json().code).toBe('coords_invalid');
    expect((await call('POST', '/plans', carol, { g: 1, s: 1, p: 1, target_time: 'morgen' })).json().code).toBe('plan_time_invalid');
    expect((await call('POST', `/plans/${plan.id}/fleets`, carol, { ships: { 901: 5 } })).json().code).toBe('plan_ships_invalid');
    expect((await call('POST', `/plans/${plan.id}/fleets`, carol, { ships: { 204: -1 } })).json().code).toBe('plan_ships_invalid');
    expect((await call('POST', `/plans/${plan.id}/fleets`, carol, { speed: 55 })).json().code).toBe('plan_speed_invalid');
    expect((await call('PUT', `/plans/${plan.id}`, carol, { status: 'won' })).json().code).toBe('plan_status_invalid');
    expect((await call('GET', '/plans/999', carol)).statusCode).toBe(404);
  });

  it('lets only the creator or an admin change the plan; cancelling releases the claim', async () => {
    const plan = (await call('GET', '/plans', carol)).json()[0];
    expect((await call('PUT', `/plans/${plan.id}`, dave, { note: 'x' })).json().code).toBe('plan_not_yours');
    expect((await call('DELETE', `/plans/${plan.id}`, dave)).json().code).toBe('plan_not_yours');

    const later = soon() + 7200;
    expect((await call('PUT', `/plans/${plan.id}`, carol, { target_time: later, note: '' })).statusCode).toBe(200);
    let claims = (await call('GET', '/claims', carol)).json();
    expect(claims[0].expires_at).toBe(later + 600);
    expect((await call('GET', '/plans', carol)).json()[0]).toMatchObject({ target_time: later, note: null });

    expect((await call('PUT', `/plans/${plan.id}`, admin, { status: 'cancelled' })).statusCode).toBe(200);
    claims = (await call('GET', '/claims', carol)).json();
    expect(claims).toEqual([]);
    expect((await call('POST', `/plans/${plan.id}/fleets`, dave, {})).json().code).toBe('plan_closed');
    expect((await call('GET', '/plans', carol)).json()[0]).toMatchObject({ status: 'cancelled', claim_user_id: null });

    expect((await call('DELETE', `/plans/${plan.id}`, carol)).statusCode).toBe(200);
    expect((await call('GET', '/plans', carol)).json()).toEqual([]);
  });

  it('plans against a player first, claims once the coordinates are known and moves the claim with them', async () => {
    const player = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4711, 'Gegner')").run(groupA).lastInsertRowid);
    expect((await call('POST', '/plans', carol, { target_time: soon() })).json().code).toBe('plan_target_missing');
    expect((await call('POST', '/plans', carol, { player_id: 999999, target_time: soon() })).json().code).toBe('player_not_found');
    expect((await call('POST', '/plans', carol, { player_id: player, target_time: soon(), time_precision: 'week' })).json().code).toBe('plan_time_invalid');

    const day = Math.floor(Date.now() / 1000 / 86400 + 1) * 86400;
    const id = (await call('POST', '/plans', carol, { player_id: player, target_time: day, time_precision: 'day' })).json().id;
    let plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === id);
    expect(plan).toMatchObject({ g: null, s: null, p: null, player_id: player, player_name: 'Gegner', time_precision: 'day', claim_user_id: null });
    expect((await call('GET', '/claims', carol)).json()).toEqual([]);

    // coordinates and the exact impact become known
    const exact = day + 14 * 3600 + 5;
    expect((await call('PUT', `/plans/${id}`, carol, { g: 3, s: 115, p: 8, type: 'moon', target_time: exact, time_precision: 'exact' })).statusCode).toBe(200);
    plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === id);
    expect(plan).toMatchObject({ g: 3, s: 115, p: 8, planet_type: 'moon', time_precision: 'exact', target_time: exact, claim_user_id: carolId });
    expect((await call('GET', '/claims', carol)).json().map((c: any) => [c.g, c.s, c.p, c.planet_type])).toEqual([[3, 115, 8, 'moon']]);

    // other coordinates: the claim moves; removing the player keeps the plan, it has coordinates
    expect((await call('PUT', `/plans/${id}`, carol, { g: 3, s: 115, p: 9, type: 'planet', player_id: null })).statusCode).toBe(200);
    expect((await call('GET', '/claims', carol)).json().map((c: any) => [c.g, c.s, c.p, c.planet_type])).toEqual([[3, 115, 9, 'planet']]);
    // without coordinates and player there is no target
    expect((await call('PUT', `/plans/${id}`, carol, { g: null, s: null, p: null })).json().code).toBe('plan_target_missing');
    await call('DELETE', `/plans/${id}`, carol);
    expect((await call('GET', '/claims', carol)).json()).toEqual([]);
  });

  it('lists hostile attacks and plans a retime on them, with shared enemy inputs and delays from new pastes', async () => {
    const acs = (h: number) => [
      `${h}h 0m 0s Eine Flotten(1 Spionagesonde) vom Mond Mond [1:41:1] erreicht den Planet Ares [1:100:12]. Mission: Angreifen`,
      'Eine Flotten(1773 Schlachtschiff; 2 Schlachtkreuzer) vom Mond Mond [1:41:1] erreicht den Planet Ares [1:100:12]. Mission: Verbandsangriff',
    ].join('\n');
    const owner = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4712, 'Angreifer')").run(groupA).lastInsertRowid);
    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id, has_moon) VALUES (?, 1, 41, 1, 'Basis', ?, 1)").run(groupA, owner);
    expect((await call('POST', '/ingest', carol, { text: acs(3) })).statusCode).toBe(200);
    // the game names no player on attacks: the owner of the start comes from the galaxy data
    const bell = (await call('GET', '/notifications', dave)).json();
    expect(bell[0].fleet.fromPlayer).toEqual({ id: owner, name: 'Angreifer' });
    const attacks = (await call('GET', '/hostile-attacks', dave)).json();
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({
      member: 'Carol', from: { g: 1, s: 41, p: 1, type: 'moon' }, to: { g: 1, s: 100, p: 12, type: 'planet' }, planId: null,
      fleets: [{ mission: 1, ships: { 210: 1 } }, { mission: 2, ships: { 207: 1773, 215: 2 } }],
    });
    expect(attacks[0].arrival - Math.floor(Date.now() / 1000)).toBeGreaterThan(3 * 3600 - 60);

    expect((await call('POST', '/plans/retime', dave, { key: 'nope', target_time: soon() })).json().code).toBe('attack_not_found');
    // hidden by hand for the whole group, and shown again
    expect(attacks[0].hidden).toBeNull();
    expect((await call('POST', '/hostile-attacks/hide', dave, { key: 'nope' })).json().code).toBe('attack_not_found');
    expect((await call('POST', '/hostile-attacks/hide', dave, { key: attacks[0].key })).statusCode).toBe(200);
    expect((await call('GET', '/hostile-attacks', carol)).json()[0].hidden).toMatchObject({ by: 'Dave' });
    expect((await call('GET', '/hostile-attacks', carolB)).json()).toEqual([]);
    // a later attack of the same fleet on the same route (after the hidden one's latest return) is shown again
    db.prepare('UPDATE hidden_attacks SET until = ? WHERE group_id = ?').run(attacks[0].arrival - 1, groupA);
    expect((await call('GET', '/hostile-attacks', carol)).json()[0].hidden).toBeNull();
    db.prepare('UPDATE hidden_attacks SET until = ? WHERE group_id = ?').run(attacks[0].until, groupA);
    expect((await call('POST', '/hostile-attacks/unhide', carol, { key: attacks[0].key })).statusCode).toBe(200);
    expect((await call('GET', '/hostile-attacks', dave)).json()[0].hidden).toBeNull();

    const created = (await call('POST', '/plans/retime', dave, { key: attacks[0].key, follow: 1, target_time: attacks[0].arrival + 7200 })).json();
    expect((await call('GET', '/hostile-attacks', carol)).json()[0].planId).toBe(created.id);
    let plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === created.id);
    expect(plan).toMatchObject({ g: 1, s: 41, p: 1, planet_type: 'moon', time_precision: 'exact', creator: 'Dave', claim_user_id: daveId });
    expect(plan.enemy).toMatchObject({ member: 'Carol', follow: 1, buffer: 1, percent: null, first_seen: attacks[0].arrival, arrival: attacks[0].arrival, recall: null });

    // a participant changes the inputs and the derived target time; someone outside the plan may not
    await call('POST', `/plans/${created.id}/fleets`, carol, { ships: { 204: 5 } });
    const dep = Math.floor(Date.now() / 1000) - 600;
    const body = { drives: { 115: 10, 117: 8, 118: 7 }, departure_from: dep, departure_to: dep + 300, percent: 70, buffer: 3, target_time: attacks[0].arrival + 5000 };
    expect((await call('PUT', `/plans/${created.id}/enemy`, carol, body)).statusCode).toBe(200);
    expect((await call('PUT', `/plans/${created.id}/enemy`, carol, { percent: 75 })).json().code).toBe('plan_speed_invalid');
    expect((await call('PUT', `/plans/${created.id}/enemy`, carol, { departure_from: dep })).json().code).toBe('plan_time_invalid');
    plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === created.id);
    expect(plan.target_time).toBe(attacks[0].arrival + 5000);
    expect(plan.enemy).toMatchObject({ drives: { 115: 10, 117: 8, 118: 7 }, drives_source: 'manual', departure: { from: dep, to: dep + 300 }, percent: 70, buffer: 3, updated_by: 'Carol' });

    // the ACS was delayed: the new paste moves the arrival, the first seen one stays
    await call('POST', '/ingest', carol, { text: acs(4) });
    plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === created.id);
    expect(plan.enemy.arrival - plan.enemy.first_seen).toBeGreaterThan(3500);
    expect(plan.enemy.recall_seen).toBeNull();
    // the return home moves with the impact, and so does the target time (once)
    expect(plan.target_time).toBe(attacks[0].arrival + 5000 + plan.enemy.arrival - plan.enemy.first_seen);
    expect((await call('GET', '/plans', dave)).json().find((p: any) => p.id === created.id).target_time).toBe(plan.target_time);

    // the attack vanished from a newer overview before it arrived: recalled in between
    const later = Math.floor(Date.now() / 1000) + 60;
    db.prepare("INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, '[]')").run(groupA, carolId, later);
    expect((await call('GET', '/hostile-attacks', dave)).json()).toEqual([]);
    plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === created.id);
    expect(plan.enemy.recall_seen.to).toBe(later);
    expect(plan.enemy.recall_seen.from).toBeLessThan(later);
    expect(plan.enemy.recall).toBeNull();
    db.prepare('DELETE FROM fleet_snapshots WHERE page_time = ?').run(later);

    // the universe gets its real fleet speed: the target time moves with the return home (offset by hand kept)
    const row = db.prepare('SELECT * FROM attack_plan_enemy WHERE plan_id = ?').get(created.id) as any;
    const fast = { ...UNIVERSE_DEFAULTS, fleetSpeed: 5000 };
    const shift = retimeHome(fast, row)! - retimeHome(UNIVERSE_DEFAULTS, row)!;
    expect(shift).toBeLessThan(-60);
    const setSpeed = (fleetSpeed: number) =>
      app.inject({ method: 'PUT', url: '/hub/api/admin/universes/u8', headers: admin, payload: { settings: { fleetSpeed } } });
    expect((await setSpeed(5000)).statusCode).toBe(200);
    const moved = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === created.id);
    expect(moved.target_time).toBe(plan.target_time + shift);
    expect((await setSpeed(2500)).statusCode).toBe(200);
    expect((await call('GET', '/plans', dave)).json().find((p: any) => p.id === created.id).target_time).toBe(plan.target_time);

    await call('DELETE', `/plans/${created.id}`, dave);
  });

  it('lets participants, also only invited ones, fill in open coordinates; the claim stays with the creator', async () => {
    const player = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4714, 'Offen')").run(groupA).lastInsertRowid);
    const id = (await call('POST', '/plans', carol, { player_id: player, target_time: soon() })).json().id;
    // not in the plan yet
    expect((await call('PUT', `/plans/${id}`, dave, { g: 3, s: 195, p: 8 })).json().code).toBe('plan_not_yours');
    await call('POST', `/plans/${id}/fleets`, carol, { user_id: daveId });
    // invited: the coordinates, nothing else
    expect((await call('PUT', `/plans/${id}`, dave, { g: 3, s: 195, p: 8, note: 'x' })).json().code).toBe('plan_not_yours');
    expect((await call('PUT', `/plans/${id}`, dave, { target_time: soon() + 60 })).json().code).toBe('plan_not_yours');
    expect((await call('PUT', `/plans/${id}`, dave, { g: 3, s: 195, p: 8, type: 'moon' })).statusCode).toBe(200);
    const plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === id);
    expect(plan).toMatchObject({ g: 3, s: 195, p: 8, planet_type: 'moon', claim_user_id: carolId });
    await call('DELETE', `/plans/${id}`, carol);
  });

  it('carries the newest spy report of the target for the simulators, research from an older report', async () => {
    const owner = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4713, 'Ziel')").run(groupA).lastInsertRowid);
    const spy = db.prepare(
      "INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_name, player_id, report_time, sections) VALUES (?, 4, 4, 4, ?, 'Ziel', ?, ?, ?)",
    );
    spy.run(groupA, 'planet', owner, 1000, JSON.stringify({ 900: { 901: 1 }, 100: { 115: 9 } }));
    spy.run(groupA, 'moon', owner, 2000, JSON.stringify({ 100: { 115: 10, 117: 8 } }));
    spy.run(groupA, 'planet', owner, 3000, JSON.stringify({ 900: { 901: 500 }, 200: { 204: 7 } }));
    const id = (await call('POST', '/plans', carol, { g: 4, s: 4, p: 4, target_time: soon() })).json().id;
    const plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === id);
    expect(plan.spy).toEqual({ time: 3000, values: { 901: 500, 204: 7, 115: 10, 117: 8 }, source: 'spy' });
    await call('DELETE', `/plans/${id}`, carol);
  });

  it("marks a fleet as launched when the member's own overview shows it towards the target", async () => {
    const target = Math.floor(Date.now() / 1000) + 7200;
    const id = (await call('POST', '/plans', carol, { g: 3, s: 115, p: 8, type: 'moon', target_time: target })).json().id;
    await call('POST', `/plans/${id}/fleets`, carol, { g: 1, s: 40, p: 5, type: 'planet', ships: { 204: 5 } });
    await call('POST', `/plans/${id}/fleets`, dave, { g: 1, s: 42, p: 7, type: 'planet', ships: { 207: 3 } });
    const fleet = (from: string, h: number, m: number) =>
      `${h}h ${m}m 0s Eine deiner Flotten (5 Leichter Jäger) vom Planet Heim [${from}] erreicht den Mond Ziel [3:115:8]. Mission: Angreifen`;
    // another start, and one far off the plan's time, do not count
    await call('POST', '/ingest', carol, { text: [fleet('1:40:6', 2, 0), fleet('1:40:5', 5, 0), fleet('1:40:5', 1, 59)].join('\n') });
    const plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === id);
    expect(plan.fleets.map((f: any) => f.status)).toEqual(['launched', 'ready']);
    expect(Math.abs(plan.fleets[0].seen.arrival - (target - 60))).toBeLessThanOrEqual(2);
    expect(plan.fleets[1].seen).toBeNull();

    // in one ACS: Carol's overview shows Dave's fleet as a foreign ACS fleet, Dave has not synced
    const acs = [
      '1h 58m 0s Eine Verbandsflotte (3 Schlachtschiff) vom Planet Basis [1:42:7] erreicht den Mond Ziel [3:115:8]. Mission: Verbandsangriff',
      'Eine deiner Flotten (5 Leichter Jäger) vom Planet Heim [1:40:5] erreicht den Mond Ziel [3:115:8]. Mission: Verbandsangriff',
    ].join('\n');
    await call('POST', '/ingest', carol, { text: acs });
    const both = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === id);
    expect(both.fleets.map((f: any) => f.status)).toEqual(['launched', 'launched']);
    expect(both.fleets[1].seen.arrival).toBe(both.fleets[0].seen.arrival);
    expect(Math.abs(both.fleets[1].seen.arrival - (target - 120))).toBeLessThanOrEqual(2);
    expect(both.fleets[1].seen.ships).toEqual({ 207: 3 });

    // the galaxy data says the start belongs to another player than Dave: not his fleet
    db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4720, 'Dave')").run(groupA);
    const other = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4721, 'Fremder')").run(groupA).lastInsertRowid);
    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 1, 42, 7, 'Basis', ?)").run(groupA, other);
    await call('PUT', `/plans/${id}/fleets/${both.fleets[1].id}`, dave, { status: 'ready' });
    const foreign = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === id);
    expect(foreign.fleets[1]).toMatchObject({ status: 'ready', seen: null });
    db.prepare('DELETE FROM planets WHERE g = 1 AND s = 42 AND p = 7').run();
    db.prepare("DELETE FROM players WHERE ingame_id IN (4720, 4721)").run();
    await call('DELETE', `/plans/${id}`, carol);
  });

  it('lists attacks from a pasted phalanx: on the scanned planet without, the scanned player\'s own with the return', async () => {
    const victim = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4715, 'Opfer')").run(groupA).lastInsertRowid);
    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 5, 50, 5, 'Gescannt', ?)").run(groupA, victim);
    const phalanx = [
      'Scan Position [5:50:5] (Gescannt)',
      'Momentane Flottenbewegungen',
      // an attack on the scanned planet (the game names no player)
      '1h 0m 0s Eine Flotten(40 Schwerer Jäger) vom Mond Mond [1:41:1] erreicht den Planet Gescannt [5:50:5]. Mission: Angreifen',
      // the scanned player attacks someone from this planet; the phalanx also shows the return
      '2h 0m 0s Eine deiner Flotten (12 Kreuzer) vom Planet Gescannt [5:50:5] erreicht den Planet Ziel [5:60:6]. Mission: Angreifen',
      '4h 0m 0s Eine deiner Flotten (12 Kreuzer) kehrt vom Planet Ziel [5:60:6] zurück zum Planet Gescannt [5:50:5]. Mission: Angreifen',
    ].join('\n');
    expect((await call('POST', '/phalanx', dave, { text: 'nichts' })).json().code).toBe('phalanx_not_phalanx');
    expect((await call('POST', '/phalanx', dave, { text: 'Scan Position [5:50:5] (Gescannt)' })).json().code).toBe('phalanx_empty');
    // the own overview is no phalanx: its attacks would show up as hostile ones
    expect((await call('POST', '/phalanx', dave, { text: phalanx.split('\n').slice(2).join('\n') })).json().code).toBe('phalanx_not_phalanx');
    // in the sync a phalanx is not stored as the member's own fleets
    const before = db.prepare('SELECT COUNT(*) FROM fleet_snapshots').pluck().get();
    const synced = (await call('POST', '/ingest', dave, { text: phalanx })).json();
    expect(synced.warnings).toContain('phalanx_use_raid_planner');
    expect(db.prepare('SELECT COUNT(*) FROM fleet_snapshots').pluck().get()).toBe(before);
    expect((await call('POST', '/phalanx', dave, { text: phalanx })).json()).toEqual({ attacks: 2 });
    const list = (await call('GET', '/hostile-attacks', carol)).json().filter((x: any) => x.source === 'phalanx');
    const onScanned = list.find((x: any) => x.to.g === 5 && x.to.s === 50)!;
    expect(onScanned).toMatchObject({ memberId: null, member: 'Opfer', reporter: 'Dave', home: null, fleets: [{ mission: 1, ships: { 205: 40 } }] });
    const own = list.find((x: any) => x.from.g === 5 && x.from.s === 50)!;
    const t0 = Math.floor(Date.now() / 1000);
    expect(Math.abs(own.home - (t0 + 4 * 3600))).toBeLessThanOrEqual(2);

    // a retime on the scanned player's own attack lands its buffer after the return shown
    const r = (await call('POST', '/plans/retime', carol, { key: own.key, target_time: t0 + 99999 })).json();
    const plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === r.id);
    expect(plan.target_time).toBe(own.home + 1);
    expect(plan.enemy).toMatchObject({ member_id: null, phalanx: { home: own.home } });
    await call('DELETE', `/plans/${r.id}/phalanx`, carol);
    expect((await call('GET', '/plans', carol)).json().find((p: any) => p.id === r.id).enemy.phalanx).toBeNull();
    await call('DELETE', `/plans/${r.id}`, carol);
    db.prepare('DELETE FROM phalanx_snapshots').run();
  });

  it('plans a hold on the attacked planet that follows the impact, without claim', async () => {
    const attack = (m: number) => `2h ${m}m 0s Eine Flotten(5 Schlachtschiff) vom Planet Feind [2:2:2] erreicht den Planet Ares [1:100:12]. Mission: Angreifen`;
    await call('POST', '/ingest', carol, { text: attack(0) });
    const a = (await call('GET', '/hostile-attacks', dave)).json().find((x: any) => x.from.g === 2);
    const { id } = (await call('POST', '/plans/hold', dave, { key: a.key })).json();
    expect((await call('GET', '/hostile-attacks', dave)).json().find((x: any) => x.key === a.key)).toMatchObject({ planId: null, holdPlanId: id });
    let plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === id);
    expect(plan).toMatchObject({ mission: 'hold', g: 1, s: 100, p: 12, planet_type: 'planet', target_time: a.arrival - 1, claim_user_id: null, spy: null });
    expect(plan.enemy).toMatchObject({ hold_offset: -1, research: null, research_time: null });

    // simulators: the defended planet from the attacked member's empire page, the attacker's research from a spy report
    // newer than Carol's empire page from the setup
    const empireTime = 1893456000 + 60;
    const planet = { name: 'Ares', coords: { g: 1, s: 100, p: 12 }, type: 'planet', values: { 204: 40, 401: 100 }, resources: { 901: 1000, 902: 500, 903: 200, 911: 5 } };
    const empire = db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(
      groupA, carolId, empireTime, JSON.stringify({ kind: 'empire', research: { 109: 11, 115: 10 }, planets: [planet] }),
    ).lastInsertRowid;
    const enemy = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4716, 'Feind')").run(groupA).lastInsertRowid);
    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 2, 2, 2, 'Feind', ?)").run(groupA, enemy);
    db.prepare("INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_name, player_id, report_time, sections) VALUES (?, 2, 2, 2, 'planet', 'Feind', ?, ?, ?)")
      .run(groupA, enemy, empireTime - 60, JSON.stringify({ 100: { 109: 14, 110: 13, 111: 12 } }));
    plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === id);
    expect(plan.spy).toEqual({ time: empireTime, values: { 204: 40, 401: 100, 901: 1000, 902: 500, 903: 200, 109: 11, 115: 10 } });
    expect(plan.enemy).toMatchObject({ research: { 109: 14, 110: 13, 111: 12 }, research_time: empireTime - 60 });

    // the attacked member (not in the plan yet) sends ships away before the impact; null takes the empire page again
    expect((await call('PUT', `/plans/${id}/enemy`, carol, { planet_ships: { 401: 5 } })).json().code).toBe('plan_ships_invalid');
    expect((await call('PUT', `/plans/${id}/enemy`, carol, { planet_ships: { 204: 10, 202: 0 } })).statusCode).toBe(200);
    plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === id);
    expect(plan.enemy.planet_ships).toEqual({ 204: 10 });
    expect(plan.spy.values[204]).toBe(40);
    await call('PUT', `/plans/${id}/enemy`, carol, { planet_ships: null });
    expect((await call('GET', '/plans', dave)).json().find((p: any) => p.id === id).enemy.planet_ships).toBeNull();
    db.prepare('DELETE FROM empire_snapshots WHERE id = ?').run(empire);

    // the attacked member joins and holds 3 s late (in case the enemy delays)
    await call('POST', `/plans/${id}/fleets`, carol, { g: 1, s: 40, p: 5, type: 'planet', ships: { 204: 5 } });
    expect((await call('PUT', `/plans/${id}/enemy`, carol, { hold_offset: 99999 })).json().code).toBe('plan_enemy_invalid');
    expect((await call('PUT', `/plans/${id}/enemy`, carol, { hold_offset: 3 })).statusCode).toBe(200);
    plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === id);
    expect(plan.target_time).toBe(a.arrival + 3);

    // the enemy delays by 10 minutes: the hold follows; the own hold fleet in the overview counts as launched
    const own = '2h 10m 3s Eine deiner Flotten (5 Leichter Jäger) vom Planet Heim [1:40:5] erreicht den Planet Ares [1:100:12]. Mission: Halten';
    await call('POST', '/ingest', carol, { text: [attack(10), own].join('\n') });
    plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === id);
    expect(plan.enemy.arrival - plan.enemy.first_seen).toBeGreaterThan(590);
    expect(plan.target_time).toBe(plan.enemy.arrival + 3);
    expect(plan.fleets[0]).toMatchObject({ status: 'launched' });
    expect((await call('GET', '/claims', carol)).json()).toEqual([]);
    await call('DELETE', `/plans/${id}`, dave);
  });

  it('keeps an attack plannable for a retime after its impact, but not for a hold', async () => {
    const text = '0h 1m 0s Eine Flotten(7 Schlachtschiff) vom Planet Feind [2:3:3] erreicht den Planet Ares [1:100:12]. Mission: Angreifen';
    await call('POST', '/ingest', carol, { text });
    // that overview was 10 minutes ago, the attack hit 9 minutes ago; a newer overview no longer shows it
    const row = db.prepare('SELECT id, page_time, data FROM fleet_snapshots WHERE user_id = ? ORDER BY page_time DESC, id DESC LIMIT 1').get(carolId) as any;
    const data = JSON.parse(row.data).map((f: any) => ({ ...f, arrival: f.arrival - 600 }));
    db.prepare('UPDATE fleet_snapshots SET page_time = ?, data = ? WHERE id = ?').run(row.page_time - 600, JSON.stringify(data), row.id);
    db.prepare("INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, '[]')").run(groupA, carolId, Math.floor(Date.now() / 1000));
    const a = (await call('GET', '/hostile-attacks', dave)).json().find((x: any) => x.from.s === 3);
    expect(a).toMatchObject({ member: 'Carol', arrival: data[0].arrival, planId: null });
    expect((await call('POST', '/plans/hold', dave, { key: a.key })).json().code).toBe('attack_arrived');
    const { id } = (await call('POST', '/plans/retime', dave, { key: a.key, target_time: a.arrival + 3600 })).json();
    const plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === id);
    // gone because it hit, not recalled
    expect(plan.enemy).toMatchObject({ arrival: a.arrival, recall_seen: null });
    await call('DELETE', `/plans/${id}`, dave);
    db.prepare('DELETE FROM fleet_snapshots WHERE user_id = ? AND page_time >= ?').run(carolId, row.page_time - 600);
  });

  it('lists own attacks in flight for their participants only and plans them with the ships flying', async () => {
    const t0 = Math.floor(Date.now() / 1000);
    const davePlayer = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4730, 'Dave')").run(groupA).lastInsertRowid);
    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 2, 50, 5, 'Daves', ?)").run(groupA, davePlayer);
    const body = (g: number, s: number, p: number, type = 'planet') => ({ coords: { g, s, p }, type, name: null });
    const move = (o: object) => ({
      owner: 'own', player: null, mission: 1, missionName: '', phase: 'out', from: body(1, 40, 5), to: body(4, 200, 7), ships: { 207: 10 },
      resources: null, seconds: 0, clock: null, acs: null, arrival: t0 + 3600, ...o,
    });
    const snap = (userId: number, data: object[]) =>
      db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(groupA, userId, t0, JSON.stringify(data));
    snap(carolId, [
      // solo attack of Carol; a transport and an arrived attack do not count
      move({ to: body(4, 201, 1), ships: { 204: 3 } }),
      move({ mission: 3, to: body(4, 202, 1) }),
      move({ to: body(4, 203, 1), arrival: t0 - 10 }),
      // ACS: Carol leads, Dave and a non-member (galaxy data: 'Angreifer' at 1:41:1) join
      move({ mission: 2, acs: 1, from: body(1, 40, 5, 'moon') }),
      move({ owner: 'foreign', mission: 2, acs: 1, from: body(2, 50, 5), ships: { 215: 4 } }),
      move({ owner: 'foreign', mission: 2, acs: 1, from: body(1, 41, 1), ships: { 213: 2 } }),
    ]);

    const mine = (await call('GET', '/own-attacks', carol)).json();
    expect(mine.map((a: any) => [a.to.s, a.fleets.length])).toEqual([[201, 1], [200, 3]]);
    // Dave only sees the ACS he flies in (from Carol's overview, he has not synced)
    const his = (await call('GET', '/own-attacks', dave)).json();
    expect(his).toHaveLength(1);
    expect(his[0]).toMatchObject({
      arrival: t0 + 3600, to: { g: 4, s: 200, p: 7, type: 'planet' },
      fleets: [
        { memberId: carolId, member: 'Carol', from: { g: 1, s: 40, p: 5, type: 'moon' }, ships: { 207: 10 } },
        { memberId: daveId, member: 'Dave', player: { id: davePlayer, name: 'Dave' }, ships: { 215: 4 } },
        { memberId: null, member: null, player: { name: 'Angreifer' }, ships: { 213: 2 } },
      ],
    });

    expect((await call('POST', '/plans/own', dave, { key: mine[0].key })).json().code).toBe('attack_not_found');
    const created = (await call('POST', '/plans/own', dave, { key: his[0].key })).json();
    expect(created.claimedBy).toBeNull();
    // planned: gone for both, the plan is there for everyone
    expect((await call('GET', '/own-attacks', dave)).json()).toEqual([]);
    expect((await call('GET', '/own-attacks', carol)).json().map((a: any) => a.to.s)).toEqual([201]);
    expect((await call('POST', '/plans/own', dave, { key: his[0].key })).json().code).toBe('attack_not_found');
    const plan = (await call('GET', '/plans', admin)).json().find((p: any) => p.id === created.id);
    expect(plan).toMatchObject({
      g: 4, s: 200, p: 7, planet_type: 'planet', target_time: t0 + 3600, time_precision: 'exact', status: 'launched', creator: 'Dave', claim_user_id: daveId,
      guests: [{ player: { name: 'Angreifer' }, from: { g: 1, s: 41, p: 1, type: 'planet' }, mission: 2, ships: { 213: 2 }, research: null }],
    });
    expect(plan.fleets.map((f: any) => [f.user_id, f.g, f.s, f.p, f.planet_type, f.ships, f.speed, f.status])).toEqual([
      [carolId, 1, 40, 5, 'moon', { 207: 10 }, 100, 'launched'],
      [daveId, 2, 50, 5, 'planet', { 215: 4 }, 100, 'launched'],
    ]);
    expect(plan.fleets[0].seen).toMatchObject({ arrival: t0 + 3600 });

    // a later overview: another fleet of Dave joined the ACS and the arrival moved; the plan follows (Dave's fleet stays)
    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 2, 50, 6, 'Daves 2', ?)").run(groupA, davePlayer);
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(groupA, carolId, t0 + 60, JSON.stringify([
      move({ mission: 2, acs: 1, from: body(1, 40, 5, 'moon'), arrival: t0 + 3720 }),
      move({ owner: 'foreign', mission: 2, acs: 1, from: body(2, 50, 5), ships: { 215: 4 }, arrival: t0 + 3720 }),
      move({ owner: 'foreign', mission: 2, acs: 1, from: body(2, 50, 6), ships: { 214: 1 }, arrival: t0 + 3720 }),
    ]));
    await call('PUT', `/plans/${created.id}/fleets/${plan.fleets[1].id}`, dave, { ships: { 215: 3 } });
    const synced = (await call('GET', '/plans', admin)).json().find((p: any) => p.id === created.id);
    expect(synced).toMatchObject({ target_time: t0 + 3720, guests: [] });
    expect(synced.fleets.map((f: any) => [f.user_id, f.s, f.p, f.ships, f.status])).toEqual([
      [carolId, 40, 5, { 207: 10 }, 'launched'],
      [daveId, 50, 5, { 215: 3 }, 'launched'],
      [daveId, 50, 6, { 214: 1 }, 'launched'],
    ]);
    // nothing new: the same state again
    expect((await call('GET', '/plans', admin)).json().find((p: any) => p.id === created.id).fleets).toHaveLength(3);
    db.prepare("DELETE FROM planets WHERE group_id = ? AND name = 'Daves 2'").run(groupA);

    await call('DELETE', `/plans/${created.id}`, dave);
    db.prepare('DELETE FROM fleet_snapshots WHERE user_id = ? AND page_time IN (?, ?)').run(carolId, t0, t0 + 60);
    db.prepare("DELETE FROM planets WHERE group_id = ? AND name = 'Daves'").run(groupA);
    db.prepare('DELETE FROM players WHERE id = ?').run(davePlayer);
  });

  it('withdraws fleets an overview shows recalled and cancels the plan when none is left', async () => {
    const target = Math.floor(Date.now() / 1000) + 7200;
    const id = (await call('POST', '/plans', carol, { g: 3, s: 116, p: 8, type: 'moon', target_time: target })).json().id;
    await call('POST', `/plans/${id}/fleets`, carol, { g: 1, s: 40, p: 5, type: 'planet', ships: { 204: 5 } });
    await call('POST', `/plans/${id}/fleets`, dave, { g: 1, s: 42, p: 7, type: 'planet', ships: { 207: 3 } });
    const out = (from: string) => `1h 59m 0s Eine deiner Flotten (5 Leichter Jäger) vom Planet Heim [${from}] erreicht den Mond Ziel [3:116:8]. Mission: Angreifen`;
    const back = (from: string) => `0h 1m 0s Eine deiner Flotten (5 Leichter Jäger) kehrt vom Mond Ziel [3:116:8] zurück zum Planet Heim [${from}]. Mission: Angreifen`;
    const plan = async () => (await call('GET', '/plans', carol)).json().find((p: any) => p.id === id);

    await call('POST', '/ingest', carol, { text: out('1:40:5') });
    expect((await plan()).fleets.map((f: any) => f.status)).toEqual(['launched', 'ready']);
    // flying back before it landed: recalled; a return never seen going out (Dave) is no recall
    await call('POST', '/ingest', carol, { text: back('1:40:5') });
    await call('POST', '/ingest', dave, { text: back('1:42:7') });
    let p = await plan();
    expect(p.fleets.map((f: any) => f.status)).toEqual(['withdrawn', 'ready']);
    expect(p.fleets[0].recalled_at).toBeGreaterThan(0);
    expect(p.status).toBe('planning');

    await call('POST', '/ingest', dave, { text: out('1:42:7') });
    await call('POST', '/ingest', dave, { text: back('1:42:7') });
    p = await plan();
    expect(p.fleets.map((f: any) => f.status)).toEqual(['withdrawn', 'withdrawn']);
    expect(p).toMatchObject({ status: 'cancelled', claim_user_id: null });
    // set back by hand, it stays
    await call('PUT', `/plans/${id}/fleets/${p.fleets[0].id}`, carol, { status: 'ready' });
    expect((await plan()).fleets[0].status).toBe('ready');
    await call('DELETE', `/plans/${id}`, carol);
  });

  it('takes a shared battle simulation over: the defender for the simulators, attackers only where recognised', async () => {
    const text = readFileSync(new URL('../../../packages/parser/test/fixtures/combat-sim-de.txt', import.meta.url), 'utf8');
    // an older spy report of the target: resources stay, its ships and defense give way to the simulation
    db.prepare(
      "INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_name, report_time, sections) VALUES (?, 4, 6, 6, 'planet', 'Ziel', 1000, ?)",
    ).run(groupA, JSON.stringify({ 900: { 901: 500 }, 200: { 204: 3 }, 400: { 401: 10 } }));
    const id = (await call('POST', '/plans', carol, { g: 4, s: 6, p: 6, target_time: soon() })).json().id;
    await call('POST', `/plans/${id}/fleets`, carol, { g: 1, s: 40, p: 5, type: 'planet', ships: { 225: 9000 } });
    await call('POST', `/plans/${id}/fleets`, dave, { g: 1, s: 42, p: 7, type: 'planet', ships: { 202: 5 } });
    const guest = { player: null, name: 'Fremd', from: { g: 2, s: 2, p: 2, type: 'planet' }, mission: 2, ships: { 204: 80000 } };
    db.prepare('UPDATE attack_plans SET guests = ? WHERE id = ?').run(JSON.stringify([guest]), id);

    expect((await call('POST', `/plans/${id}/sim`, dave, { text: 'Hallo' })).json().code).toBe('plan_sim_invalid');
    // Nr.1 (heavy cruisers) and Nr.2 match no fleet; Nr.3 (light fighters) is the guest by its ship types
    const res = await call('POST', `/plans/${id}/sim`, dave, { text });
    expect(res.json()).toEqual({ defender: true, attackers: 3, identified: 1, updated: 1 });
    let plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === id);
    expect(plan.sim).toMatchObject({ by: 'Dave', defender: true });
    expect(plan.spy).toMatchObject({ source: 'sim', values: { 901: 500, 202: 884, 204: 1548, 225: 8708, 109: 25, 110: 24, 111: 24 } });
    expect(plan.spy.values[401]).toBeUndefined();
    expect(plan.fleets.map((f: any) => f.ships)).toEqual([{ 225: 9000 }, { 202: 5 }]);
    expect(plan.guests[0]).toMatchObject({ ships: { 204: 82322 }, research: { 109: 25, 110: 23, 111: 24 }, research_source: 'sim' });

    // Nr.1 is Carol's fleet by its ship types once it holds heavy cruisers, Nr.2 Dave's in its slot
    await call('PUT', `/plans/${id}/fleets/${plan.fleets[0].id}`, carol, { ships: { 222: 9000 } });
    await call('PUT', `/plans/${id}/fleets/${plan.fleets[1].id}`, carol, { ships: { 206: 1, 207: 1, 215: 1 } });
    expect((await call('POST', `/plans/${id}/sim`, carol, { text })).json()).toEqual({ defender: true, attackers: 3, identified: 3, updated: 2 });
    plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === id);
    expect(plan.fleets.map((f: any) => f.ships)).toEqual([{ 222: 10156 }, { 206: 152, 207: 579, 215: 4025 }]);

    // dropped again: the spy report counts
    await call('DELETE', `/plans/${id}/sim`, carol);
    plan = (await call('GET', '/plans', carol)).json().find((p: any) => p.id === id);
    expect(plan).toMatchObject({ sim: null, spy: { source: 'spy', values: { 901: 500, 204: 3, 401: 10 } } });
    expect(plan.guests[0].research_source).toBeUndefined();
    await call('DELETE', `/plans/${id}`, carol);
  });

  it('lists plans up to a week after their target time', async () => {
    const id = (await call('POST', '/plans', carol, { g: 2, s: 2, p: 2, target_time: soon() })).json().id;
    db.prepare('UPDATE attack_plans SET target_time = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 6 * 86400, id);
    expect((await call('GET', '/plans', carol)).json()).toHaveLength(1);
    db.prepare('UPDATE attack_plans SET target_time = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 8 * 86400, id);
    expect((await call('GET', '/plans', carol)).json()).toEqual([]);
  });
});
