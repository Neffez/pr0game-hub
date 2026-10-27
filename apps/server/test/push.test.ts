import { distance, flightDuration, slowestShip, drivesFromResearch } from '@pr0hub/flight';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { events } = await import('../src/events.js');
const { UNIVERSE_DEFAULTS } = await import('../src/config.js');

type Sent = { endpoint: string; payload: { title: string; body: string; url: string; tag: string } };
const sent: Sent[] = [];
const sender = vi.fn(async (target: { endpoint: string }, payload: string) => {
  if (target.endpoint.includes('gone')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
  sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
  return 201;
});

const db = openDb(':memory:');
const app = buildApp(db, { logger: false, push: { contact: 'mailto:hub@example.com', sender } });
let groupA = 0;
let groupB = 0;
let playerA = 0;
const ids: Record<string, number> = {};
const h: Record<string, Record<string, string>> = {};
const t = Math.floor(Date.now() / 1000);

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });
const subscribe = (who: string, endpoint: string) =>
  call('POST', '/push/subscriptions', h[who], { endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
const to = (endpoint: string) => sent.filter((s) => s.endpoint === endpoint);

beforeAll(async () => {
  await app.ready();
  for (const name of ['admin', 'carol', 'dave', 'erin']) {
    db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)').run(name, hashPassword(`${name}pass`), name === 'admin' ? 1 : 0);
    ids[name] = db.prepare('SELECT id FROM users WHERE username = ?').pluck().get(name) as number;
  }
  const admin = { cookie: await login('admin') };
  await call('POST', '/admin/universes', admin, { slug: 'u8', name: 'Universum 8' });
  groupA = (await call('POST', '/admin/groups', admin, { universe: 'u8', name: 'A' })).json().id;
  groupB = (await call('POST', '/admin/groups', admin, { universe: 'u8', name: 'B' })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(groupA, ids.carol);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Dave')").run(groupA, ids.dave);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Erin')").run(groupB, ids.erin);
  playerA = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Victim')").run(groupA).lastInsertRowid);
  h.carol = { cookie: await login('carol'), 'x-hub-group': String(groupA) };
  h.dave = { cookie: await login('dave'), 'x-hub-group': String(groupA) };
  h.erin = { cookie: await login('erin'), 'x-hub-group': String(groupB) };
});

beforeEach(() => {
  sent.length = 0;
});

describe('push subscriptions and settings', () => {
  it('hands out the key, registers browsers and moves a browser to the user logged in now', async () => {
    const key = (await call('GET', '/push/key', h.carol)).json();
    expect(key.enabled).toBe(true);
    expect(key.publicKey).toMatch(/^[\w-]{80,}$/);
    // the key pair stays the same
    expect(db.prepare('SELECT COUNT(*) FROM push_vapid').pluck().get()).toBe(1);

    expect((await call('POST', '/push/subscriptions', h.carol, { endpoint: 'http://insecure', keys: {} })).statusCode).toBe(400);
    expect((await subscribe('carol', 'https://push.example/carol')).statusCode).toBe(200);
    expect((await subscribe('dave', 'https://push.example/shared')).statusCode).toBe(200);
    expect((await subscribe('erin', 'https://push.example/shared')).statusCode).toBe(200);
    expect(db.prepare("SELECT user_id FROM push_subscriptions WHERE endpoint = 'https://push.example/shared'").pluck().get()).toBe(ids.erin);
    // only own browsers can be removed
    expect((await call('DELETE', '/push/subscriptions', h.dave, { endpoint: 'https://push.example/shared' })).json().removed).toBe(0);
    expect((await call('DELETE', '/push/subscriptions', h.erin, { endpoint: 'https://push.example/shared' })).json().removed).toBe(1);
    await subscribe('dave', 'https://push.example/dave');
    await subscribe('erin', 'https://push.example/erin');
  });

  it('keeps the settings per user with defaults and validates the lead time', async () => {
    expect((await call('GET', '/auth/push-settings', h.dave)).json()).toEqual({
      attackSelf: true, attackOthers: false, invites: true, comments: true, launch: true, buildings: true, fleets: true, storage: true, accessRequests: true, leadMinutes: 5,
    });
    expect((await call('POST', '/auth/push-settings', h.dave, { leadMinutes: 7 })).statusCode).toBe(400);
    expect((await call('POST', '/auth/push-settings', h.dave, { leadMinutes: 10, invites: false })).json()).toMatchObject({ leadMinutes: 10, invites: false, comments: true });
    await call('POST', '/auth/push-settings', h.dave, { leadMinutes: 5, invites: true });
  });

  it('sends a test to all devices of the user', async () => {
    expect((await call('POST', '/push/test', h.carol)).json()).toEqual({ devices: 1 });
    expect(to('https://push.example/carol')[0].payload.title).toBe('pr0game Hub');
  });

  it('is off without a contact', async () => {
    const off = buildApp(db, { logger: false, push: { contact: '', sender } });
    await off.ready();
    const res = await off.inject({ method: 'GET', url: '/hub/api/push/key', headers: h.carol });
    expect(res.json()).toEqual({ enabled: false, publicKey: null });
    expect((await off.inject({ method: 'POST', url: '/hub/api/push/test', headers: h.carol })).statusCode).toBe(409);
    await off.close();
  });
});

describe('push delivery', () => {
  it('pushes a hostile attack once to the attacked member, to the others only when they want it', async () => {
    const fleet = {
      owner: 'hostile', player: 'Raider', mission: 1, missionName: 'Angreifen', phase: 'out', ships: { 204: 50 }, resources: null, arrival: t + 3600,
      from: { coords: { g: 2, s: 100, p: 4 }, type: 'planet', name: null }, to: { coords: { g: 1, s: 1, p: 1 }, type: 'moon', name: null },
    };
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(groupA, ids.carol, t, JSON.stringify([fleet]));

    await app.push.deliver(groupA, t);
    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe('https://push.example/carol');
    expect(sent[0].payload).toMatchObject({ title: '⚔ Angriff auf Carol', url: `/hub/u8/fleet?group=${groupA}` });
    expect(sent[0].payload.body).toContain('☾ [1:1:1]');
    expect(sent[0].payload.body).toContain('von Raider [2:100:4]');

    // sent once; another member who wants the others' attacks gets it too
    await app.push.deliver(groupA, t);
    expect(sent).toHaveLength(1);
    await call('POST', '/auth/push-settings', h.dave, { attackOthers: true });
    await app.push.deliver(groupA, t);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/carol', 'https://push.example/dave']);
    // nothing for the other alliance
    await app.push.deliver(groupB, t);
    expect(to('https://push.example/erin')).toEqual([]);
  });

  it('lists new comments on the bell of the thread participants and pushes them, not while their hub is in front', async () => {
    await call('POST', '/u8/comments', h.carol, { player: playerA, body: 'Saved fleet at 3 am' });
    await call('POST', '/u8/comments', h.dave, { player: playerA, body: 'Has a phalanx on the moon' });
    const bell = (await call('GET', '/u8/notifications', h.carol)).json().filter((n: any) => n.kind === 'comment');
    expect(bell).toMatchObject([{ member: 'Dave', excerpt: 'Has a phalanx on the moon', count: 1, thread: { player: playerA, name: 'Victim' } }]);
    // the author and members outside the thread get nothing
    expect((await call('GET', '/u8/notifications', h.dave)).json().filter((n: any) => n.kind === 'comment')).toEqual([]);

    await app.push.deliver(groupA, t);
    expect(sent).toMatchObject([
      { endpoint: 'https://push.example/carol', payload: { title: '💬 Dave zu Victim', url: `/hub/u8/player/${playerA}?group=${groupA}` } },
    ]);

    // answered: gone from the bell
    await call('POST', '/u8/comments', h.carol, { player: playerA, body: 'Thanks' });
    expect((await call('GET', '/u8/notifications', h.carol)).json().filter((n: any) => n.kind === 'comment')).toEqual([]);

    // Carol has the hub open in front: she sees the bell, no push (and none later)
    const off = events.subscribe(groupA, { userId: ids.carol, isAdmin: false, send: () => {} });
    events.setWhereabouts(groupA, ids.carol, { page: 'overview', active: true });
    await call('POST', '/u8/comments', h.dave, { player: playerA, body: 'Still there?' });
    sent.length = 0;
    await app.push.deliver(groupA, t);
    expect(to('https://push.example/carol')).toEqual([]);
    off();
    await app.push.deliver(groupA, t);
    expect(to('https://push.example/carol')).toEqual([]);
  });

  it('delivers by itself after a data event of the group', { timeout: 10_000 }, async () => {
    await call('POST', '/u8/comments', h.carol, { c: '1:50:7', type: 'planet', body: 'Farm' });
    await call('POST', '/u8/comments', h.dave, { c: '1:50:7', type: 'planet', body: 'Mine now' });
    await vi.waitFor(() => expect(to('https://push.example/carol').length).toBeGreaterThan(0), { timeout: 5000, interval: 100 });
    expect(to('https://push.example/carol')[0].payload.url).toBe(`/hub/u8/spy?c=1%3A50%3A7&type=planet&group=${groupA}`);
  });

  it('reminds of the own launch from the chosen lead time on, on the bell an hour ahead', async () => {
    const ships = { 202: 3 };
    const duration = flightDuration(UNIVERSE_DEFAULTS, distance(UNIVERSE_DEFAULTS, [1, 10, 3], [1, 20, 8]), slowestShip(ships, drivesFromResearch({}))!.speed, 100);
    const launch = t + 1800;
    const target = launch + Math.floor(duration);
    const plan = Number(
      db.prepare("INSERT INTO attack_plans (group_id, user_id, g, s, p, planet_type, target_time, time_precision) VALUES (?, ?, 1, 20, 8, 'planet', ?, 'exact')")
        .run(groupA, ids.dave, target).lastInsertRowid,
    );
    const fleet = Number(
      db.prepare("INSERT INTO attack_plan_fleets (plan_id, user_id, g, s, p, planet_type, ships, speed, status) VALUES (?, ?, 1, 10, 3, 'planet', ?, 100, 'invited')")
        .run(plan, ids.carol, JSON.stringify(ships)).lastInsertRowid,
    );
    const bell = (await call('GET', '/u8/notifications', h.carol)).json().filter((n: any) => n.kind === 'launch');
    expect(bell).toMatchObject([{ id: `launch:${fleet}:${launch}`, time: launch, plan: { id: plan, g: 1, s: 20, p: 8 }, from: { g: 1, s: 10, p: 3 } }]);
    expect((await call('GET', '/u8/notifications', h.dave)).json().filter((n: any) => n.kind === 'launch')).toEqual([]);

    // the invitation goes out at once, the reminder 5 minutes before the launch
    await app.push.deliver(groupA, t);
    expect(sent.map((s) => s.payload.title)).toEqual(['✉ Einladung von Dave']);
    sent.length = 0;
    await app.push.tick(launch - 301);
    expect(sent).toEqual([]);
    await app.push.tick(launch - 300);
    expect(sent).toMatchObject([{ endpoint: 'https://push.example/carol', payload: { title: '🚀 Start in 5 Min', url: `/hub/u8/raid-planner?plan=${plan}&group=${groupA}` } }]);
    expect(sent[0].payload.body).toContain('[1:10:3] → [1:20:8]');

    // no reminder for a withdrawn fleet or a plan without an exact time
    db.prepare("UPDATE attack_plan_fleets SET status = 'withdrawn' WHERE id = ?").run(fleet);
    expect((await call('GET', '/u8/notifications', h.carol)).json().filter((n: any) => n.kind === 'launch')).toEqual([]);
    db.prepare("UPDATE attack_plan_fleets SET status = 'ready' WHERE id = ?").run(fleet);
    db.prepare("UPDATE attack_plans SET time_precision = 'hour' WHERE id = ?").run(plan);
    expect((await call('GET', '/u8/notifications', h.carol)).json().filter((n: any) => n.kind === 'launch')).toEqual([]);
  });

  it('drops subscriptions the push service no longer knows', async () => {
    await subscribe('carol', 'https://push.example/gone');
    expect((await call('POST', '/push/test', h.carol)).json()).toEqual({ devices: 1 });
    expect(db.prepare("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint LIKE '%gone'").pluck().get()).toBe(0);
  });
});
