import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { decodeShare } = await import('@pr0hub/battle');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });

let admin: { cookie: string };
let bearer: Record<string, string>;
let groupA: number;
let groupB: number;

const url = '/hub/api/u8/battle/simulate';
const post = (payload: unknown, headers = bearer, group = groupA) =>
  app.inject({ method: 'POST', url, headers: { ...headers, 'x-hub-group': String(group) }, payload: payload as object });

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const login = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'admin', password: 'adminpass' } });
  admin = { cookie: `hub_session=${login.cookies.find((c) => c.name === 'hub_session')!.value}` };
  const h = { headers: admin };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', settings: { fleetDebrisPercent: 50, defenseDebrisPercent: 10 } }, ...h });
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  groupB = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, ...h })).json().id;
  const token = (await app.inject({ method: 'POST', url: '/hub/api/auth/tokens', ...h, payload: { name: 'agent' } })).json().token;
  bearer = { authorization: `Bearer ${token}` };
  const spy = db.prepare(
    "INSERT INTO spy_reports (group_id, user_id, g, s, p, planet_type, player_name, report_time, sections) VALUES (?, 1, 1, 110, 8, 'planet', 'Alpha', ?, ?)",
  );
  spy.run(groupA, 1000, JSON.stringify({ 900: { 901: 400000, 902: 200000, 903: 100000 }, 400: { 401: 50 }, 100: { 111: 5 } }));
});

describe('battle simulator API', () => {
  it('simulates with a read-only token and the newest spy report of the group', async () => {
    const res = await post({
      attackers: [{ units: { 207: 200, 203: 50 }, research: { 109: 12, 110: 12, 111: 12, 118: 8 }, from: '1:100:5', speed: 100 }],
      target: '1:110:8',
      runs: 5,
    });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.runs).toBe(5);
    expect(r.wins.attacker).toBe(1);
    expect(r.spyReport).toMatchObject({ time: 1000 });
    // universe settings of the hub: 50 % of the fleet, 10 % of the destroyed defense not rebuilt
    expect(r.settings).toMatchObject({ fleetDebris: 50, defenseDebris: 10, bigShields: false });
    expect(r.loot.metal).toBeGreaterThan(0);
    expect(r.flights).toHaveLength(1);
    expect(r.flights[0]).toMatchObject({ slot: 0, distance: 2700 + 95 * 10 });
    expect(r.typical.engine).toBeUndefined();
    const link = decodeShare(r.link.split('#')[1]);
    expect(link.defenders[0].units).toEqual({ 401: 50 });
    expect(link.uni).toMatchObject({ fd: 50, dd: 10 });
  });

  it('takes a planet from the request and returns the rounds on request', async () => {
    const res = await post({
      attackers: [{ units: { 204: 10 } }],
      defenders: [{ units: { 405: 20 } }],
      runs: 1,
      report: true,
      settings: { bigShields: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().typical.engine.rounds.length).toBeGreaterThan(1);
    expect(res.json().spyReport).toBeNull();
  });

  it('keeps spy reports within the group', async () => {
    const res = await post({ attackers: [{ units: { 204: 1 } }], target: '1:110:8' }, bearer, groupB);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('spy_report_not_found');
  });

  it('refuses invalid and too large battles and needs a login', async () => {
    for (const body of [{}, { attackers: [] }, { attackers: [{ units: { 999: 1 } }], target: '1:1:1' }, { attackers: [{ units: { 204: 1 } }] },
      { attackers: [{ units: { 204: 1 }, speed: 55 }], target: '1:1:1' }, { attackers: [{ units: { 204: 1 } }], defenders: [{ units: {} }], runs: 101 }]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('battle_invalid');
    }
    const big = await post({ attackers: [{ units: { 204: 3_000_000 } }], defenders: [{ units: { 401: 3_000_000 } }], runs: 1 });
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe('battle_too_large');
    const anon = await app.inject({ method: 'POST', url, payload: { attackers: [{ units: { 204: 1 } }], defenders: [{ units: {} }] } });
    expect(anon.statusCode).toBe(401);
  });

  it('is documented in the OpenAPI spec', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/hub/api/openapi.json' })).json();
    expect(doc.paths['/api/{uni}/battle/simulate'].post.operationId).toBe('simulateBattle');
  });

  it('still refuses writes with a read-only token elsewhere', async () => {
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: { ...bearer, 'x-hub-group': String(groupA) }, payload: { text: 'x' } });
    expect(res.json().code).toBe('read_only_token');
  });
});
