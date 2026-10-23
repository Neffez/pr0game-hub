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

  it('lists plans up to a week after their target time', async () => {
    const id = (await call('POST', '/plans', carol, { g: 2, s: 2, p: 2, target_time: soon() })).json().id;
    db.prepare('UPDATE attack_plans SET target_time = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 6 * 86400, id);
    expect((await call('GET', '/plans', carol)).json()).toHaveLength(1);
    db.prepare('UPDATE attack_plans SET target_time = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 8 * 86400, id);
    expect((await call('GET', '/plans', carol)).json()).toEqual([]);
  });
});
