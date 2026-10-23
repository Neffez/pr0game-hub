import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { events } = await import('../src/events.js');

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
    expect((await call('POST', `/plans/${plan.id}/fleets`, dave, { g: 1, s: 42, p: 7, ships: { 204: 100 } })).statusCode).toBe(200);
    // Dave cannot invite others, Carol (creator) can
    expect((await call('POST', `/plans/${plan.id}/fleets`, dave, { user_id: carolId })).json().code).toBe('plan_not_yours');
    expect((await call('POST', `/plans/${plan.id}/fleets`, carol, { user_id: daveId })).statusCode).toBe(200);

    const fleets = (await call('GET', '/plans', dave)).json()[0].fleets;
    expect(fleets.map((f: any) => [f.member, f.status, f.speed, f.ships])).toEqual([
      ['Carol', 'ready', 90, { 207: 1773, 215: 2 }],
      ['Dave', 'ready', 100, { 204: 100 }],
      ['Dave', 'invited', 100, {}],
    ]);
    expect(fleets[0]).toMatchObject({ g: 1, s: 40, p: 5, planet_type: 'planet', drives: { time: 1893456000, research: { 115: 10, 117: 8, 118: 6, 134: 0 } } });
    expect(fleets[1].drives).toBeNull();

    // Dave changes his own fleet, not Carol's; Carol as creator may change Dave's
    expect((await call('PUT', `/plans/${plan.id}/fleets/${fleets[1].id}`, dave, { speed: 50, ships: { 204: 120 } })).statusCode).toBe(200);
    expect((await call('PUT', `/plans/${plan.id}/fleets/${fleets[0].id}`, dave, { speed: 50 })).json().code).toBe('plan_fleet_not_yours');
    expect((await call('PUT', `/plans/${plan.id}/fleets/${fleets[2].id}`, carol, { status: 'withdrawn' })).statusCode).toBe(200);
    expect((await call('DELETE', `/plans/${plan.id}/fleets/${fleets[2].id}`, dave)).statusCode).toBe(200);
    const after = (await call('GET', '/plans', carol)).json()[0].fleets;
    expect(after.map((f: any) => [f.member, f.speed, f.ships])).toEqual([['Carol', 90, { 207: 1773, 215: 2 }], ['Dave', 50, { 204: 120 }]]);
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

    // the attack vanished from a newer overview before it arrived: recalled in between
    const later = Math.floor(Date.now() / 1000) + 60;
    db.prepare("INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, '[]')").run(groupA, carolId, later);
    expect((await call('GET', '/hostile-attacks', dave)).json()).toEqual([]);
    plan = (await call('GET', '/plans', dave)).json().find((p: any) => p.id === created.id);
    expect(plan.enemy.recall_seen.to).toBe(later);
    expect(plan.enemy.recall_seen.from).toBeLessThan(later);
    expect(plan.enemy.recall).toBeNull();
    db.prepare('DELETE FROM fleet_snapshots WHERE page_time = ?').run(later);

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
    expect(plan.spy).toEqual({ time: 3000, values: { 901: 500, 204: 7, 115: 10, 117: 8 } });
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
    await call('DELETE', `/plans/${id}`, carol);
  });

  it('lists attacks from a pasted phalanx: on the scanned planet without, the scanned player\'s own with the return', async () => {
    const victim = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4715, 'Opfer')").run(groupA).lastInsertRowid);
    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 5, 50, 5, 'Gescannt', ?)").run(groupA, victim);
    const phalanx = [
      // an attack on the scanned planet (the game names no player)
      '1h 0m 0s Eine Flotten(40 Schwerer Jäger) vom Mond Mond [1:41:1] erreicht den Planet Gescannt [5:50:5]. Mission: Angreifen',
      // the scanned player attacks someone from this planet; the phalanx also shows the return
      '2h 0m 0s Eine deiner Flotten (12 Kreuzer) vom Planet Gescannt [5:50:5] erreicht den Planet Ziel [5:60:6]. Mission: Angreifen',
      '4h 0m 0s Eine deiner Flotten (12 Kreuzer) kehrt vom Planet Ziel [5:60:6] zurück zum Planet Gescannt [5:50:5]. Mission: Angreifen',
    ].join('\n');
    expect((await call('POST', '/phalanx', dave, { text: 'nichts' })).json().code).toBe('phalanx_empty');
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
    expect(plan.enemy.hold_offset).toBe(-1);

    // the attacked member joins and holds 3 s late (in case the enemy delays); others outside the plan may not
    expect((await call('PUT', `/plans/${id}/enemy`, carol, { hold_offset: 3 })).json().code).toBe('plan_not_yours');
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

  it('lists plans up to a week after their target time', async () => {
    const id = (await call('POST', '/plans', carol, { g: 2, s: 2, p: 2, target_time: soon() })).json().id;
    db.prepare('UPDATE attack_plans SET target_time = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 6 * 86400, id);
    expect((await call('GET', '/plans', carol)).json()).toHaveLength(1);
    db.prepare('UPDATE attack_plans SET target_time = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 8 * 86400, id);
    expect((await call('GET', '/plans', carol)).json()).toEqual([]);
  });
});
