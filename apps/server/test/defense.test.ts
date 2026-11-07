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
let carol: Record<string, string>;
const wasm = existsSync(new URL('../../../packages/battle/wasm/battlerust_bg.wasm', import.meta.url));

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const get = async (url: string) => app.inject({ method: 'GET', url: `/hub/api/u8${url}`, headers: carol });
const HOME = '1:100:8:planet';

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const daveId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', hashPassword('davepass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol'), (?, ?, 'Dave')").run(group, carolId, group, daveId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };

  const player = (name: string, coords: [number, number, number]) => {
    const id = Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(group, name).lastInsertRowid);
    db.prepare('INSERT INTO planets (group_id, g, s, p, player_id) VALUES (?, ?, ?, ?, ?)').run(group, ...coords, id);
    return id;
  };
  const spy = db.prepare(
    `INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_id, player_name, report_time, sections) VALUES (?, ?, ?, ?, 'planet', ?, ?, ?, ?)`,
  );
  // Raider spied on Carol, its fleet is in a spy report, research too
  const raider = player('Raider', [1, 150, 4]);
  spy.run(group, 1, 150, 4, raider, 'Raider', t - 7200, JSON.stringify({ 900: {}, 200: { 203: 300, 205: 100, 210: 5 }, 100: { 109: 8, 110: 8, 111: 8, 115: 10, 117: 6 } }));
  db.prepare(
    `INSERT INTO hostile_spying (group_id, user_id, dedupe_key, time, from_player, from_g, from_s, from_p, from_type, target_g, target_s, target_p, target_type)
     VALUES (?, ?, ?, ?, 'Raider', 1, 150, 4, 'planet', 1, 100, 8, 'planet')`,
  ).run(group, carolId, 'spy-1', t - 3600);
  // Basher attacked Carol's planet (battle report), no spy report
  player('Basher', [1, 120, 2]);
  db.prepare(
    `INSERT INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets, g, s, p, planet_type)
     VALUES (?, 'r1', ?, 'attacker', 2, 0, 0, 0, 0, ?, 1, 100, 8, 'planet')`,
  ).run(group, t - 86400, JSON.stringify([[0, 'Basher', [[204, 500, 480], [202, 50, 50]]], [1, 'Carol', [[401, 10, 0]]]]));
  // Farmer is nearby with a fleet; Far in another galaxy; Dave is a member (no threat); an old report doesn't count
  const farmer = player('Farmer', [1, 90, 5]);
  spy.run(group, 1, 90, 5, farmer, 'Farmer', t - 600, JSON.stringify({ 200: { 207: 50, 203: 100 } }));
  const far = player('Far', [2, 90, 5]);
  spy.run(group, 2, 90, 5, far, 'Far', t - 600, JSON.stringify({ 200: { 207: 500 } }));
  const dave = player('Dave', [1, 95, 5]);
  spy.run(group, 1, 95, 5, dave, 'Dave', t - 600, JSON.stringify({ 200: { 207: 500 } }));
  const old = player('Old', [1, 80, 5]);
  spy.run(group, 1, 80, 5, old, 'Old', t - 30 * 86400, JSON.stringify({ 200: { 207: 500 } }));

  const research = { 109: 6, 110: 6, 111: 6, 113: 8, 115: 8, 117: 5, 118: 2, 120: 10, 121: 6, 122: 8 };
  const empire = {
    kind: 'empire', research, planets: [
      {
        name: 'Home', coords: { g: 1, s: 100, p: 8 }, type: 'planet', values: { 1: 20, 2: 18, 3: 15, 21: 8, 22: 8, 23: 8, 24: 8, 202: 20, 401: 20, 408: 1 },
        resources: { 901: 2_000_000, 902: 1_000_000, 903: 500_000 }, perHour: { 901: 0, 902: 0, 903: 0 },
      },
      { name: 'Colony', coords: { g: 1, s: 140, p: 6 }, type: 'planet', values: {} },
    ],
  };
  db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, carolId, t - 600, JSON.stringify(empire));
});

describe('defense advisor', () => {
  it('lists the attackers of the planet with their fleets', async () => {
    const res = await get(`/defense-advice?planet=${HOME}&sim=0`);
    expect(res.statusCode).toBe(200);
    const a = res.json();
    expect(a.planet).toMatchObject({ key: HOME, name: 'Home', units: { 202: 20, 401: 20, 408: 1 }, research: { 109: 6, 110: 6, 111: 6 } });
    expect(a.planet.resources).toEqual({ metal: 2_000_000, crystal: 1_000_000, deuterium: 500_000 });
    expect(a.rate.source).toBe('default');
    // the threats by reason (attacked, spied, nearby); members, other galaxies and old reports are left out
    expect(a.threats.map((x: any) => x.player.name)).toEqual(['Basher', 'Raider', 'Farmer']);
    const [basher, raider, farmer] = a.threats;
    expect(basher.reasons).toEqual([{ kind: 'attacked', count: 1, last: t - 86400 }]);
    expect(basher.fleet).toMatchObject({ units: { 202: 50, 204: 500 }, source: 'combat' });
    // without a spy report showing research, the viewer's levels stand in
    expect(basher.research).toMatchObject({ known: false, values: { 109: 6, 115: 8 } });
    // from the owner's planet nearest to the target
    expect(basher.flight.from).toEqual({ g: 1, s: 120, p: 2 });
    expect(raider.reasons[0]).toMatchObject({ kind: 'spied', count: 1 });
    // spy probes don't join the attack
    expect(raider.fleet).toMatchObject({ units: { 203: 300, 205: 100 }, source: 'spy', from: { g: 1, s: 150, p: 4 } });
    expect(raider.research).toMatchObject({ known: true, values: { 109: 8 } });
    expect(raider.flight.fuel).toBeGreaterThan(0);
    expect(farmer.reasons[0].kind).toBe('nearby');
    // the heavy ships alone as a second way to attack (a fleet without others has none)
    expect(farmer.heavy).toMatchObject({ units: { 207: 50 } });
    expect(farmer.heavy.flight.fuel).toBeLessThan(farmer.flight.fuel);
    expect(raider.heavy).toBeNull();
    // buildable defense: requirements met, the large shield dome is built already
    expect(a.candidates).toEqual(expect.arrayContaining([401, 402, 403, 404, 405, 406, 407]));
    expect(a.candidates).not.toContain(408);
    expect(a.advice).toBeNull();
  });

  it('leaves out the ships when they are saved and can count full storages', async () => {
    const a = (await get(`/defense-advice?planet=${HOME}&ships=0&loot=full&sim=0`)).json();
    expect(a.planet.units).toEqual({ 401: 20, 408: 1 });
    expect(a.planet.resources.metal).toBeGreaterThanOrEqual(2_000_000);
  });

  it('refuses planets that are not the viewer’s', async () => {
    expect((await get('/defense-advice?planet=1:150:4:planet&sim=0')).statusCode).toBe(404);
    expect((await get('/defense-advice?planet=x&sim=0')).statusCode).toBe(400);
  });

  it.skipIf(!wasm)('finds the defense that makes the chosen attacks unprofitable', async () => {
    const a = (await get(`/defense-advice?planet=${HOME}&sim=0`)).json();
    const raiderKey = a.threats.find((x: any) => x.player.name === 'Raider').key;
    const b = (await get(`/defense-advice?planet=${HOME}&threats=${raiderKey}`)).json();
    expect(b.simulated).toEqual([raiderKey]);
    const farmerKey = a.threats.find((x: any) => x.player.name === 'Farmer').key;
    const f = (await get(`/defense-advice?planet=${HOME}&threats=${farmerKey}&sim=0`)).json();
    expect(f.simulated).toEqual([farmerKey, `${farmerKey}:heavy`]);
    expect(b.advice.error).toBeNull();
    expect(b.advice.before).toHaveLength(1);
    expect(b.advice.before[0].profit).toBeGreaterThan(0);
    expect(b.advice.status).toBe('found');
    expect(b.advice.after[0].profit).toBeLessThanOrEqual(0);
    expect(b.advice.costValue).toBeGreaterThan(0);
  });

  it.skipIf(!wasm)('scores the raid risk of every body and caches it while nothing changes', async () => {
    const res = await get('/defense-risk');
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.error).toBeNull();
    expect(r.cached).toBe(false);
    expect(r.planets.map((p: any) => p.key)).toEqual([HOME, '1:140:6:planet']);
    const home = r.planets[0];
    expect(home.threats).toBe(3);
    // 2 million metal and more lying around: someone profits
    expect(home.worst.profit).toBeGreaterThan(0);
    expect(['Basher', 'Raider', 'Farmer']).toContain(home.worst.player.name);
    expect(r.battles).toBeGreaterThan(0);
    const again = (await get('/defense-risk')).json();
    expect(again.cached).toBe(true);
    expect(again.planets[0].worst.profit).toBe(home.worst.profit);
  });
});
