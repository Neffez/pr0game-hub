import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const t = now();
let group = 0;
let carolId = 0;
let daveId = 0;
let carol: Record<string, string>;
const wasm = existsSync(new URL('../../../packages/battle/wasm/battlerust_bg.wasm', import.meta.url));

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const get = async (url: string) => app.inject({ method: 'GET', url: `/hub/api/u8${url}`, headers: carol });

const hostile = {
  owner: 'hostile', player: 'Raider', mission: 1, missionName: 'Angreifen', phase: 'out', acs: null, ships: { 204: 200, 202: 100 }, resources: null,
  arrival: t + 3 * 3600, from: { coords: { g: 1, s: 150, p: 4 }, type: 'planet', name: null }, to: { coords: { g: 1, s: 100, p: 8 }, type: 'planet', name: 'Home' },
};

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  daveId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', hashPassword('davepass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol'), (?, ?, 'Dave')").run(group, carolId, group, daveId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };

  const raider = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Raider')").run(group).lastInsertRowid);
  db.prepare('INSERT INTO planets (group_id, g, s, p, player_id) VALUES (?, 1, 150, 4, ?)').run(group, raider);
  db.prepare(
    `INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_id, player_name, report_time, sections) VALUES (?, 1, 150, 4, 'planet', ?, 'Raider', ?, ?)`,
  ).run(group, raider, t - 7200, JSON.stringify({ 900: {}, 100: { 109: 8, 110: 8, 111: 8, 115: 10, 117: 6 } }));

  const research = { 109: 6, 110: 6, 111: 6, 115: 8, 117: 5, 118: 2 };
  const carolEmpire = {
    kind: 'empire', research, planets: [
      {
        name: 'Home', coords: { g: 1, s: 100, p: 8 }, type: 'planet', values: { 22: 5, 23: 5, 24: 5, 202: 20, 203: 10, 401: 50, 402: 20 },
        resources: { 901: 200_000, 902: 100_000, 903: 50_000 }, perHour: { 901: 0, 902: 0, 903: 0 },
      },
      { name: 'Home', coords: { g: 1, s: 100, p: 8 }, type: 'moon', values: {} },
      { name: 'Colony', coords: { g: 1, s: 140, p: 6 }, type: 'planet', values: {} },
    ],
  };
  const daveEmpire = {
    kind: 'empire', research: { 115: 10, 117: 8, 118: 6 }, planets: [
      { name: 'Near', coords: { g: 1, s: 102, p: 3 }, type: 'planet', values: { 204: 300, 206: 20 } },
      { name: 'Far', coords: { g: 3, s: 300, p: 3 }, type: 'planet', values: { 204: 10 } },
      { name: 'Empty', coords: { g: 1, s: 101, p: 3 }, type: 'planet', values: { 401: 10 } },
    ],
  };
  const empire = db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)');
  empire.run(group, carolId, t - 600, JSON.stringify(carolEmpire));
  empire.run(group, daveId, t - 600, JSON.stringify(daveEmpire));
  db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, carolId, t - 60, JSON.stringify([hostile]));
});

describe('incoming attack assistant', () => {
  it('finds the attack by member, arrival and origin', async () => {
    const res = await get(`/attack-assist?member=${carolId}&arrival=${hostile.arrival + 2}&from=1:150:4&sim=0`);
    expect(res.statusCode).toBe(200);
    const a = res.json();
    expect(a.member).toEqual({ id: carolId, name: 'Carol' });
    expect(a.attack).toMatchObject({ arrival: hostile.arrival, to: { g: 1, s: 100, p: 8, type: 'planet' }, player: { name: 'Raider' } });
    expect(a.attacker.ships).toEqual({ 202: 100, 204: 200 });
    expect(a.attacker.research.values).toMatchObject({ 109: 8, 110: 8, 111: 8 });
    expect(a.target).toMatchObject({ name: 'Home', values: { 202: 20, 401: 50 }, resources: { metal: 200_000, crystal: 100_000, deuterium: 50_000 } });
    expect(a.bodies.map((b: any) => `${b.s}:${b.type}`)).toEqual(['100:planet', '100:moon', '140:planet']);
    expect(a.research).toMatchObject({ 115: 8 });
    // a third of the cargo for metal first, at most half of each resource
    expect(a.loot.metal).toBeLessThanOrEqual(100_000);
    expect(a.loot.metal + a.loot.crystal + a.loot.deuterium).toBeGreaterThan(0);
    expect(a.sim).toBeNull();
    expect(a.simulated).toBe(true);
    expect(a.holdPlan).toBeNull();
  });

  it('lists the members who can still hold before the impact', async () => {
    const a = (await get(`/attack-assist?key=${encodeURIComponent((await get(`/attack-assist?member=${carolId}&arrival=${hostile.arrival}&from=1:150:4&sim=0`)).json().attack.key)}&sim=0`)).json();
    // the far planet would need longer than the three hours left, the empty one has no ships
    expect(a.helpers.map((h: any) => `${h.member} ${h.from.name}`)).toEqual(['Dave Near']);
    const near = a.helpers[0];
    expect(near.launch + near.duration).toBe(hostile.arrival - 1);
    expect(near.launch).toBeGreaterThan(t);
    expect(near.points).toBeGreaterThan(0);
  });

  it('knows a hold plan made for the attack', async () => {
    const key = (await get(`/attack-assist?member=${carolId}&arrival=${hostile.arrival}&from=1:150:4&sim=0`)).json().attack.key;
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/plans/hold', headers: carol, payload: { key } });
    expect(res.statusCode).toBe(200);
    const a = (await get(`/attack-assist?key=${encodeURIComponent(key)}&sim=0`)).json();
    expect(a.holdPlan).toBe(res.json().id);
  });

  it.skipIf(!wasm)('simulates the battle on the planet', async () => {
    const a = (await get(`/attack-assist?member=${carolId}&arrival=${hostile.arrival}&from=1:150:4`)).json();
    expect(a.sim.error).toBeNull();
    expect(a.sim.runs).toBe(20);
    expect(a.sim.wins.attacker + a.sim.wins.defender + a.sim.wins.draw).toBeCloseTo(1);
  });

  it('counts fleets holding at the planet at the impact and leaves them out of the helpers', async () => {
    const hold = (phase: string, arrival: number, from: [number, number, number], ships: Record<number, number>) => ({
      owner: 'own', player: null, mission: 5, missionName: 'Halten', phase, acs: null, ships, resources: null, arrival,
      from: { coords: { g: from[0], s: from[1], p: from[2] }, type: 'planet', name: null }, to: { coords: { g: 1, s: 100, p: 8 }, type: 'planet', name: 'Home' },
    });
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, daveId, t, JSON.stringify([
      // lands before the impact and holds 8 hours: counts
      hold('out', hostile.arrival - 600, [1, 102, 3], { 204: 300, 206: 20 }),
      hold('hold', hostile.arrival - 600 + 8 * 3600, [1, 102, 3], { 204: 300, 206: 20 }),
      // lands after the impact: too late
      hold('out', hostile.arrival + 60, [3, 300, 3], { 204: 10 }),
    ]));
    const a = (await get(`/attack-assist?member=${carolId}&arrival=${hostile.arrival}&from=1:150:4&sim=0`)).json();
    expect(a.holds).toEqual([
      { member: 'Dave', player: null, from: { g: 1, s: 102, p: 3, type: 'planet' }, ships: { 204: 300, 206: 20 }, research: { 115: 10, 117: 8, 118: 6 }, arrival: hostile.arrival - 600 },
    ]);
    expect(a.helpers.map((h: any) => h.from.name)).not.toContain('Near');
  });

  it('takes off ships sent away after the empire page and estimates unseen attackers from spy reports', async () => {
    const own = (phase: string, arrival: number, ships: Record<number, number>, mission = 3) => ({
      owner: 'own', player: null, mission, missionName: 'Transport', phase, acs: null, ships, resources: null, arrival,
      from: { coords: phase === 'return' ? { g: 1, s: 140, p: 6 } : { g: 1, s: 100, p: 8 }, type: 'planet', name: null },
      to: { coords: phase === 'return' ? { g: 1, s: 100, p: 8 } : { g: 1, s: 140, p: 6 }, type: 'planet', name: null },
    });
    const ghost = { ...hostile, ships: {}, arrival: t + 4 * 3600, from: { coords: { g: 1, s: 160, p: 2 }, type: 'planet', name: null } };
    // a transport already in the fleet list before the empire page (away then: not taken off again)
    const early = own('out', t + 300, { 203: 5 });
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, carolId, t - 900, JSON.stringify([hostile, early]));
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, carolId, t, JSON.stringify([
      hostile, ghost, early, own('return', t + 600, { 203: 5 }),
      // new since the empire page: the small cargos are back only after the impact, the deploy stays away
      own('out', t + 3600, { 202: 15 }), own('return', hostile.arrival + 600, { 202: 15 }),
      own('out', t + 1800, { 203: 2 }, 4),
      // back before the impact: defends again
      own('out', t + 1200, { 202: 5 }), own('return', t + 2400, { 202: 5 }),
    ]));
    const raider = db.prepare("SELECT id FROM players WHERE name = 'Raider'").pluck().get();
    db.prepare(
      `INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_id, player_name, report_time, sections) VALUES (?, 1, 160, 2, 'planet', ?, 'Raider', ?, ?)`,
    ).run(group, raider, t - 3600, JSON.stringify({ 900: {}, 200: { 207: 40, 212: 100, 210: 5 } }));

    const a = (await get(`/attack-assist?member=${carolId}&arrival=${hostile.arrival}&from=1:150:4&sim=0`)).json();
    expect(a.away).toEqual({ ships: { 202: 15, 203: 2 }, fleets: 2, unknown: false });
    // the empire page's numbers stay, `present` is what is left at the planet
    expect(a.target.present[202]).toBe(a.target.values[202] - 15);
    expect(a.target.present[203]).toBe(a.target.values[203] - 2);
    expect(a.target.present[401]).toBe(a.target.values[401]);
    const b = (await get(`/attack-assist?member=${carolId}&arrival=${ghost.arrival}&from=1:160:2&sim=0`)).json();
    // solar satellites cannot fly
    expect(b.attacker.ships).toEqual({ 207: 40, 210: 5 });
    expect(b.attacker.estimated).toEqual({ time: t - 3600 });
    expect(b.simulated).toBe(true);
  });

  it('answers 404 for an unknown attack', async () => {
    expect((await get(`/attack-assist?member=${carolId}&arrival=${t + 99}&from=9:9:9`)).statusCode).toBe(404);
  });
});
