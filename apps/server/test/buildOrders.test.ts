import { buildingCost } from '@pr0hub/core/buildings';
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

const db = openDb(':memory:');
const app = buildApp(db, { logger: false, push: { contact: 'mailto:hub@example.com', sender: pushSender } });
const t = Math.floor(Date.now() / 1000);
let group = 0;
const ids: Record<string, number> = {};
const h: Record<string, Record<string, string>> = {};
const HOME = '1:1:1:planet';

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });

/** Metal mine 10, crystal mine 5 on [1:1:1] synced two hours ago: 3600 metal and 360 crystal per hour from nothing. */
const T0 = t - 7200;
const empire = {
  kind: 'empire', research: {},
  planets: [
    {
      name: 'Home', coords: { g: 1, s: 1, p: 1 }, type: 'planet', values: { 1: 10, 2: 5, 4: 12, 22: 5, 23: 5, 24: 5 }, fields: { used: 30, max: 163 },
      resources: { 901: 0, 902: 0, 903: 0 }, perHour: { 901: 3600, 902: 360, 903: 0 }, building: null, temp: 40,
    },
  ],
};
/** metal mine 11 next (base 10), then crystal mine 6 */
const order = {
  base: { planets: { [HOME]: { 1: 10, 2: 5 } }, research: {} },
  planets: { [HOME]: [{ id: 'a', kind: 'building', element: 1 }, { id: 'b', kind: 'building', element: 2 }] },
};

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
  db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, ids.carol, T0, JSON.stringify(empire));
  await call('POST', '/push/subscriptions', h.carol, { endpoint: 'https://push.example/carol', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
});

beforeEach(() => {
  pushed.length = 0;
});

describe('build order', () => {
  it('imports, validates and keeps it per member', async () => {
    expect((await call('GET', '/u8/build-order', h.carol)).json()).toEqual({ buildOrder: null });
    const bad = await call('PUT', '/u8/build-order', h.carol, { order: { ...order, planets: { [HOME]: [{ id: 'x', kind: 'building', element: 999 }] } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('build_order_invalid');
    const res = await call('PUT', '/u8/build-order', h.carol, { order, meta: { source: 'pr0plan', skipped: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().buildOrder).toMatchObject({ order, meta: { source: 'pr0plan' } });
    expect((await call('GET', '/u8/build-order', h.dave)).json()).toEqual({ buildOrder: null });
    expect((await call('PATCH', '/u8/build-order', h.dave, { planets: {} })).statusCode).toBe(404);
  });

  it('notifies when the next step can start, once', async () => {
    // metal mine 11 waits for crystal: 720 there, the rest at 360 per hour
    const cost = buildingCost(1, 11);
    const ready = t + Math.ceil(((cost[902] - 720) / 360) * 3600);
    expect(ready).toBeGreaterThan(t + 600);
    await app.push.deliver(group, t);
    expect(pushed).toEqual([]);
    expect((await call('GET', '/u8/notifications', h.carol)).json().filter((n: { kind: string }) => n.kind === 'buildorder')).toEqual([]);
    const deliver = vi.spyOn(app.push, 'deliver');
    await app.push.tick(t + 300);
    expect(deliver).not.toHaveBeenCalled();
    await app.push.tick(ready + 1);
    expect(deliver).toHaveBeenCalledTimes(1);
    deliver.mockRestore();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload).toMatchObject({
      title: '📋 Metallmine 11 jetzt bauen', body: 'Nächster Schritt der Bauliste auf Home [1:1:1]', url: `/hub/u8/build?tab=order&c=1%3A1%3A1&type=planet&group=${group}`,
    });
    await app.push.tick(ready + 61);
    expect(pushed).toHaveLength(1);
  });

  it('changes the steps: order, done, removed; the next step follows', async () => {
    const swapped = { [HOME]: [order.planets[HOME][1], { ...order.planets[HOME][0], done: true }] };
    const res = (await call('PATCH', '/u8/build-order', h.carol, { planets: swapped })).json();
    expect(res.buildOrder.order).toEqual({ base: order.base, planets: swapped });
    expect((await call('PATCH', '/u8/build-order', h.carol, { planets: { [HOME]: [{ id: 'z', kind: 'nope' }] } })).statusCode).toBe(400);
    // crystal mine 6 is next now and affordable
    const bell = (await call('GET', '/u8/notifications', h.carol)).json().filter((n: { kind: string }) => n.kind === 'buildorder');
    expect(bell).toMatchObject([{ id: 'buildorder:1:1:1:planet:b', planet: { g: 1, s: 1, p: 1, name: 'Home' }, step: { id: 'b', kind: 'building', element: 2, target: 6 } }]);
  });

  it('respects the setting and deletes', async () => {
    expect((await call('POST', '/auth/push-settings', h.carol, { buildOrder: false })).json()).toMatchObject({ buildOrder: false });
    await call('PATCH', '/u8/build-order', h.carol, { planets: { [HOME]: [{ id: 'c', kind: 'building', element: 22 }] } });
    // metal storage 6 (base: none, so level 1 is the target: already built) -> done; nothing open
    await app.push.deliver(group, t + 100000);
    expect(pushed).toEqual([]);
    expect((await call('DELETE', '/u8/build-order', h.carol)).json()).toEqual({ buildOrder: null });
    expect(db.prepare('SELECT COUNT(*) FROM build_orders').pluck().get()).toBe(0);
  });
});
