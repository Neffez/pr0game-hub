import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flightEnds, flightsOf, slotLimits, slotsAt } from '../src/repo/slots.js';
import type { StoredFleet } from '../src/repo/fleets.js';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { clearEmpireCache } = await import('../src/repo/empire.js');

type Pushed = { endpoint: string; payload: { title: string; body: string; url: string; tag: string } };
const pushed: Pushed[] = [];
const pushSender = vi.fn(async (target: { endpoint: string }, payload: string) => {
  pushed.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
  return 201;
});

const db = openDb(':memory:');
const app = buildApp(db, { logger: false, push: { contact: 'mailto:hub@example.com', sender: pushSender } });
const t = Math.floor(Date.now() / 1000);
let group = 0;
const ids: Record<string, number> = {};
const h: Record<string, Record<string, string>> = {};

const HOME = { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: 'Home' } as const;
const POS = { coords: { g: 1, s: 1, p: 16 }, type: null, name: null } as const;
const line = (phase: StoredFleet['phase'], arrival: number, mission = 15, ships: Record<number, number> = { 202: 10 }): StoredFleet =>
  ({
    owner: 'own', player: null, mission, missionName: mission === 15 ? 'Expedition' : 'Transport', phase, ships, resources: null, seconds: 0, clock: null, acs: null,
    arrival, from: phase === 'return' ? POS : HOME, to: phase === 'return' ? HOME : POS,
  }) as StoredFleet;
/** An expedition: out at `out`, an hour's stay, as long back as out. */
const expedition = (out: number, way = 1800, ships?: Record<number, number>) => [line('out', out, 15, ships), line('hold', out + 3600, 15, ships), line('return', out + 3600 + way, 15, ships)];

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });
const sync = (who: string, pageTime: number, fleets: object[]) =>
  db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, ids[who], pageTime, JSON.stringify(fleets));
const report = (who: string, time: number, event: string, factor: number | null = null) =>
  db
    .prepare("INSERT INTO expeditions (group_id, user_id, dedupe_key, time, g, s, p, event, size, factor) VALUES (?, ?, ?, ?, 1, 1, 16, ?, 'None', ?)")
    .run(group, ids[who], `k${time}${event}`, time, event, factor);

describe('slots of a fleet list', () => {
  it('follows the game: 1 + computer technology, √astrophysics', () => {
    expect(slotLimits({ 108: 8, 124: 10 })).toEqual({ fleets: 9, expeditions: 3 });
    expect(slotLimits({ 124: 0 })).toEqual({ fleets: null, expeditions: 0 });
  });

  it('counts each flight once, until it is home; missile attacks take no slot', () => {
    const list = [...expedition(t + 100), ...expedition(t + 200), line('out', t + 50, 3), line('return', t + 400, 3), line('out', t + 60, 10)];
    const flights = flightsOf(list);
    expect(flights.map((f) => f.length).sort()).toEqual([1, 2, 3, 3]);
    const slots = slotsAt({ time: t, flights: flightEnds(list, []) }, { 108: 4, 124: 4 }, t);
    expect(slots.fleets).toMatchObject({ used: 3, max: 5, next: t + 400 });
    expect(slots.expeditions).toMatchObject({ used: 2, max: 2, next: t + 5500, ends: [t + 5500, t + 5600] });
    // after the first return
    expect(slotsAt({ time: t, flights: flightEnds(list, []) }, { 124: 4 }, t + 5550).expeditions).toMatchObject({ used: 1, next: t + 5600 });
  });

  it('pairs the lines of two expeditions to the same place by their ships', () => {
    const a = expedition(t + 100, 1800, { 202: 10 });
    const b = expedition(t + 200, 1800, { 203: 5 });
    const flights = flightsOf([a[0], b[0], a[1], b[1], a[2], b[2]]);
    expect(flights.map((f) => f.map((l) => l.arrival))).toEqual([a.map((l) => l.arrival), b.map((l) => l.arrival)]);
  });

  it('takes black holes, fast and slow expeditions from the reports', () => {
    const list = expedition(t + 100, 2000);
    const hold = t + 3700;
    const end = (event: string, factor: number | null) => flightEnds(list, [{ time: hold + 3, g: 1, s: 1, p: 16, event, factor }])[0];
    expect(end('BlackHole', null)).toMatchObject({ end: hold, lost: true });
    expect(end('Fast', 5).end).toBe(hold + 1000);
    expect(end('Slow', 2).end).toBe(hold + 2000 + 7200);
    expect(end('Nothing', null)).toMatchObject({ end: hold + 2000, lost: false });
    // a report of another stay changes nothing
    expect(flightEnds(list, [{ time: hold + 600, g: 1, s: 1, p: 16, event: 'BlackHole', factor: null }])[0].end).toBe(hold + 2000);
  });
});

describe('expedition slots in the hub', () => {
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
    const empire = { kind: 'empire', research: { 108: 6, 124: 9 }, planets: [{ name: 'Home', coords: HOME.coords, type: 'planet', values: {} }] };
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, ids.carol, t - 7200, JSON.stringify(empire));
    clearEmpireCache();
    await call('POST', '/push/subscriptions', h.carol, { endpoint: 'https://fcm.googleapis.com/fcm/send/carol', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
  });

  beforeEach(() => {
    pushed.length = 0;
    db.prepare('DELETE FROM fleet_snapshots').run();
    db.prepare('DELETE FROM expeditions').run();
    db.prepare('DELETE FROM push_sent').run();
  });

  it('shows the slots taken in the imperium and for the expeditions page', async () => {
    expect((await call('GET', '/u8/fleets/slots', h.carol)).json()).toEqual({ slots: null });
    sync('carol', t - 60, [...expedition(t - 50), line('out', t + 600, 3), line('return', t + 1200, 3)]);
    const slots = (await call('GET', '/u8/fleets/slots', h.carol)).json().slots;
    expect(slots).toMatchObject({ time: t - 60, own: true, fleets: { used: 2, max: 7 }, expeditions: { used: 1, max: 3, next: t + 5350 } });
    const imperium = (await call('GET', '/u8/imperium', h.carol)).json();
    expect(imperium.slots).toMatchObject({ own: true, expeditions: { used: 1, max: 3 } });
    // another member sees the slots by the shared fleets
    expect((await call('GET', `/u8/imperium?user=${ids.carol}`, h.dave)).json().slots).toMatchObject({ own: false, fleets: { used: 2 } });
  });

  it('notifies when an expedition is back or lost, when wanted', async () => {
    // back 10 minutes ago, one more out
    sync('carol', t - 9000, [...expedition(t - 6000), ...expedition(t - 1000)]);
    const list = (await call('GET', '/u8/notifications', h.carol)).json();
    expect(list.filter((n: { kind: string }) => n.kind === 'expedition')).toMatchObject([{ time: t - 600, lost: false, slots: { used: 1, max: 3 }, fleet: { phase: 'return' } }]);

    // pushed only with the setting on (default off)
    await app.push.deliver(group, t);
    expect(pushed.filter((p) => p.payload.tag.startsWith('expedition:'))).toEqual([]);
    expect((await call('POST', '/auth/push-settings', h.carol, { expeditions: true })).json().expeditions).toBe(true);
    db.prepare('DELETE FROM push_sent').run();
    await app.push.deliver(group, t);
    expect(pushed.map((p) => p.payload.title)).toEqual(['🧭 Expeditionsslot frei']);
    expect(pushed[0].payload.body).toContain('1/3 Expeditionen unterwegs');

    // a black hole at the end of the stay of the second one frees its slot then
    pushed.length = 0;
    db.prepare('DELETE FROM fleet_snapshots').run();
    sync('carol', t - 3000, expedition(t - 4000));
    report('carol', t - 400, 'BlackHole');
    await app.push.deliver(group, t);
    expect(pushed.map((p) => p.payload.title)).toEqual(['🕳 Expedition verloren, Slot frei']);
    expect((await call('GET', '/u8/fleets/slots', h.carol)).json().slots.expeditions).toMatchObject({ used: 0 });
  });
});
