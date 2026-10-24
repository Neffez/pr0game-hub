import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

type Pushed = { endpoint: string; payload: { title: string; body: string; url: string; tag: string } };
const pushed: Pushed[] = [];
const pushSender = vi.fn(async (target: { endpoint: string }, payload: string) => {
  pushed.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
  return 201;
});
const posted: { url: string; message: { embeds: { title: string; description: string }[] } }[] = [];
const discordSender = vi.fn(async (url: string, message: { embeds: { title: string; description: string }[] }) => {
  posted.push({ url, message });
  return { status: 204 };
});

const db = openDb(':memory:');
const app = buildApp(db, { logger: false, push: { contact: 'mailto:hub@example.com', sender: pushSender }, discord: { sender: discordSender } });
const t = Math.floor(Date.now() / 1000);
const HOOK = `https://discord.com/api/webhooks/100000000000000001/${'T'.repeat(68)}`;
let group = 0;
const ids: Record<string, number> = {};
const h: Record<string, Record<string, string>> = {};

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });

/** Recyclers flying home from the debris field of [1:1:5] to [1:1:1], landing in an hour. */
const recyclers = (arrival: number) => ({
  owner: 'own', player: null, mission: 8, missionName: 'Abbauen', phase: 'return', ships: { 209: 120 }, resources: { 901: 50000, 902: 20000, 903: 0 },
  arrival, from: { coords: { g: 1, s: 1, p: 5 }, type: 'debris', name: null }, to: { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: 'Home' }, acs: null,
});
const identity = (f: ReturnType<typeof recyclers>) => ({ mission: f.mission, phase: f.phase, from: f.from, to: f.to, arrival: f.arrival });
const sync = (who: string, pageTime: number, fleets: object[]) =>
  db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, ids[who], pageTime, JSON.stringify(fleets));

beforeAll(async () => {
  await app.ready();
  for (const name of ['admin', 'carol', 'dave']) {
    db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)').run(name, hashPassword(`${name}pass`), name === 'admin' ? 1 : 0);
    ids[name] = db.prepare('SELECT id FROM users WHERE username = ?').pluck().get(name) as number;
  }
  const admin = { cookie: await login('admin') };
  await call('POST', '/admin/universes', admin, { slug: 'u8', name: 'Universum 8' });
  group = (await call('POST', '/admin/groups', admin, { universe: 'u8', name: 'A' })).json().id;
  for (const [name, ingame] of [['carol', 'Carol'], ['dave', 'Dave']]) {
    db.prepare('INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, ?)').run(group, ids[name], ingame);
    h[name] = { cookie: await login(name), 'x-hub-group': String(group) };
  }
  db.prepare('UPDATE users SET discord_webhook = ? WHERE id = ?').run(HOOK, ids.carol);
  await call('POST', '/push/subscriptions', h.carol, { endpoint: 'https://push.example/carol', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
});

beforeEach(() => {
  pushed.length = 0;
  posted.length = 0;
  db.prepare('DELETE FROM fleet_alerts').run();
  db.prepare('DELETE FROM fleet_snapshots').run();
});

describe('fleet alerts', () => {
  it('are set on own fleets in flight only', async () => {
    const fleet = recyclers(t + 3600);
    sync('carol', t - 10, [fleet, { ...recyclers(t + 1800), owner: 'hostile', mission: 1, phase: 'out' }]);
    expect((await call('PUT', '/u8/fleets/alerts', h.carol, { ...identity(fleet), lead: 500 })).statusCode).toBe(400);
    expect((await call('PUT', '/u8/fleets/alerts', h.carol, { ...identity(fleet), from: null })).statusCode).toBe(400);
    // hostile, another arrival, another member's list
    expect((await call('PUT', '/u8/fleets/alerts', h.carol, { ...identity(fleet), mission: 1, phase: 'out', arrival: t + 1800 })).statusCode).toBe(404);
    expect((await call('PUT', '/u8/fleets/alerts', h.carol, { ...identity(fleet), arrival: t + 3000 })).statusCode).toBe(404);
    expect((await call('PUT', '/u8/fleets/alerts', h.dave, identity(fleet))).statusCode).toBe(404);

    // a few seconds off (clock of the copied text) still match; setting it again changes the lead
    const res = await call('PUT', '/u8/fleets/alerts', h.carol, { ...identity(fleet), arrival: t + 3602 });
    expect(res.statusCode).toBe(200);
    expect(res.json().alerts).toMatchObject([{ arrival: t + 3600, lead: 0, fleet: { mission: 8, ships: { 209: 120 } } }]);
    const again = (await call('PUT', '/u8/fleets/alerts', h.carol, { ...identity(fleet), lead: 2 })).json().alerts;
    expect(again).toMatchObject([{ lead: 2 }]);
    expect((await call('GET', '/u8/imperium', h.carol)).json().fleetAlerts).toMatchObject([{ id: again[0].id, lead: 2 }]);
    // only the owner sees them
    expect((await call('GET', `/u8/imperium?user=${ids.carol}`, h.dave)).json().fleetAlerts).toBeNull();

    expect((await call('DELETE', `/u8/fleets/alerts/${again[0].id}`, h.dave)).statusCode).toBe(404);
    expect((await call('DELETE', `/u8/fleets/alerts/${again[0].id}`, h.carol)).json().alerts).toEqual([]);
  });

  it('notifies once at the arrival, or the lead before it', async () => {
    const fleet = recyclers(t + 600);
    sync('carol', t - 10, [fleet]);
    await call('PUT', '/u8/fleets/alerts', h.carol, { ...identity(fleet), lead: 2 });
    // the bell gets it ahead of time (the web app shows it when due)
    expect((await call('GET', '/u8/notifications', h.carol)).json()).toMatchObject([{ kind: 'fleet', time: t + 600, lead: 2 }]);
    await app.push.deliver(group, t);
    expect(pushed).toEqual([]);

    // the ticks look at the group only from the reminder time on
    const deliver = vi.spyOn(app.push, 'deliver');
    await app.push.tick(t + 300);
    expect(deliver).not.toHaveBeenCalled();
    await app.push.tick(t + 480);
    expect(deliver).toHaveBeenCalledTimes(1);
    deliver.mockRestore();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload).toMatchObject({ title: '⏰ Abbau: Ankunft in 2 Min', url: `/hub/u8/imperium?group=${group}` });
    expect(pushed[0].payload.body).toContain('[1:1:5] → Home [1:1:1]');
    expect(pushed[0].payload.body).toContain('120 Recycler');
    await app.discord.tick(t + 480);
    expect(posted.map((p) => p.message.embeds[0].title)).toEqual(['⏰ Abbau: Ankunft in 2 Min']);

    // a newer list a second off keeps it (sent once)
    sync('carol', t + 500, [{ ...fleet, arrival: t + 601 }]);
    await app.push.tick(t + 601);
    expect(pushed).toHaveLength(1);
  });

  it('notify at the arrival by default', async () => {
    const fleet = recyclers(t + 60);
    sync('carol', t - 10, [fleet]);
    await call('PUT', '/u8/fleets/alerts', h.carol, identity(fleet));
    await app.push.deliver(group, t);
    expect(pushed).toEqual([]);
    await app.push.deliver(group, t + 60);
    expect(pushed.map((p) => p.payload.title)).toEqual(['↩ Abbau: Flotte zurück']);

    // the setting turns the push off (the bell still lists it)
    expect((await call('POST', '/auth/push-settings', h.carol, { fleets: false })).json()).toMatchObject({ fleets: false });
    const other = { ...recyclers(t + 90), from: { coords: { g: 1, s: 1, p: 6 }, type: 'debris', name: null } };
    sync('carol', t, [fleet, other]);
    await call('PUT', '/u8/fleets/alerts', h.carol, identity(other));
    await app.push.deliver(group, t + 90);
    expect(pushed).toHaveLength(1);
    await call('POST', '/auth/push-settings', h.carol, { fleets: true });
  });

  it('are listed on the bell until a while after the arrival', async () => {
    const fleet = recyclers(t - 30);
    sync('carol', t - 600, [fleet]);
    db.prepare('INSERT INTO fleet_alerts (group_id, user_id, arrival, lead, data, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(group, ids.carol, t - 30, JSON.stringify(fleet), t - 300);
    expect((await call('GET', '/u8/notifications', h.carol)).json()).toMatchObject([{ kind: 'fleet', time: t - 30, lead: 0, fleet: { mission: 8 } }]);
  });

  it('are dropped when the fleet is recalled or long arrived', async () => {
    const fleet = recyclers(t + 3600);
    sync('carol', t - 10, [fleet]);
    await call('PUT', '/u8/fleets/alerts', h.carol, identity(fleet));
    sync('carol', t + 5, [{ ...fleet, arrival: t + 1200, phase: 'return', from: { coords: { g: 1, s: 1, p: 9 }, type: 'planet', name: null } }]);
    expect((await call('GET', '/u8/imperium', h.carol)).json().fleetAlerts).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) FROM fleet_alerts').pluck().get()).toBe(0);

    db.prepare('INSERT INTO fleet_alerts (group_id, user_id, arrival, lead, data, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(group, ids.carol, t - 3600, JSON.stringify(recyclers(t - 3600)), t - 7200);
    expect((await call('GET', '/u8/imperium', h.carol)).json().fleetAlerts).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) FROM fleet_alerts').pluck().get()).toBe(0);
  });
});
