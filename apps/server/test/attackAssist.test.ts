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

  it('answers 404 for an unknown attack', async () => {
    expect((await get(`/attack-assist?member=${carolId}&arrival=${t + 99}&from=9:9:9`)).statusCode).toBe(404);
  });
});
