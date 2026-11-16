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
  await call('POST', '/push/subscriptions', h.carol, { endpoint: 'https://fcm.googleapis.com/fcm/send/carol', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
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
    // an added step can bring its start level along; a bad base is refused and changes nothing
    expect((await call('PATCH', '/u8/build-order', h.carol, { planets: swapped, base: { planets: { [HOME]: { 1: -1 } }, research: {} } })).statusCode).toBe(400);
    const added = { [HOME]: [...swapped[HOME], { id: 'd', kind: 'building', element: 4 }] };
    const base = { planets: { [HOME]: { ...order.base.planets[HOME], 4: 12 } }, research: {} };
    expect((await call('PATCH', '/u8/build-order', h.carol, { planets: added, base })).json().buildOrder.order).toEqual({ base, planets: added });
    expect((await call('PATCH', '/u8/build-order', h.carol, { planets: swapped })).json().buildOrder.order.base).toEqual(base);
    // crystal mine 6 is next now and affordable
    const bell = (await call('GET', '/u8/notifications', h.carol)).json().filter((n: { kind: string }) => n.kind === 'buildorder');
    expect(bell).toMatchObject([{ id: 'buildorder:1:1:1:planet:b', planet: { g: 1, s: 1, p: 1, name: 'Home' }, step: { id: 'b', kind: 'building', element: 2, target: 6 } }]);
  });

  it('checks off a transport the synced fleets show, and keeps it', async () => {
    const step = { id: 't', kind: 'transport', transport: { target: '1:1:9:planet', resources: { 901: 1000 }, flight: 600 } };
    await call('PATCH', '/u8/build-order', h.carol, { planets: { [HOME]: [step] } });
    expect((await call('GET', '/u8/build-order', h.carol)).json().buildOrder.order.planets[HOME][0].done).toBeUndefined();
    const fleet = {
      owner: 'own', player: null, mission: 3, missionName: 'Transport', phase: 'out', ships: { 203: 1 }, resources: { 901: 1000, 902: 0, 903: 0 },
      arrival: t + 600, from: { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: null }, to: { coords: { g: 1, s: 1, p: 9 }, type: 'planet', name: null },
    };
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, ids.carol, t, JSON.stringify([fleet]));
    expect((await call('GET', '/u8/build-order', h.carol)).json().buildOrder.order.planets[HOME][0]).toMatchObject({ id: 't', done: true });
    // GET is a read: stored only by the catch-up after a paste
    const stored = () => JSON.parse(db.prepare('SELECT data FROM build_orders WHERE user_id = ?').pluck().get(ids.carol) as string).planets[HOME][0];
    expect(stored().done).toBeUndefined();
    const { catchUpBuildState } = await import('../src/repo/buildOrders.js');
    const { resolveGroup, getUniverse } = await import('../src/context.js');
    catchUpBuildState(db, resolveGroup(db, { id: ids.carol, username: 'carol', isAdmin: false } as never, getUniverse(db, 'u8'), group));
    expect(stored().done).toBe(true);
    db.prepare('DELETE FROM fleet_snapshots').run();
    expect((await call('GET', '/u8/build-order', h.carol)).json().buildOrder.order.planets[HOME][0].done).toBe(true);
  });

  it('assigns a planned planet to a synced one', async () => {
    const P1 = '0:0:1:planet';
    const planned = { base: { planets: { [P1]: { 1: 10 } }, research: {} }, planets: { [P1]: [{ id: 'p', kind: 'building', element: 1 }] } };
    await call('PUT', '/u8/build-order', h.dave, { order: planned, meta: { mapping: { 1: P1 } } });
    // no notification for a planet without coordinates
    expect((await call('GET', '/u8/notifications', h.dave)).json().filter((n: { kind: string }) => n.kind === 'buildorder')).toEqual([]);
    expect((await call('POST', '/u8/build-order/assign', h.dave, { from: HOME, to: P1 })).statusCode).toBe(400);
    // the target must be one of the viewer's synced planets: not a planet of someone else, a moon or a planned planet
    expect((await call('POST', '/u8/build-order/assign', h.dave, { from: P1, to: HOME })).json().code).toBe('build_order_target_invalid');
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, ids.dave, T0, JSON.stringify(empire));
    expect((await call('POST', '/u8/build-order/assign', h.dave, { from: P1, to: '1:1:1:moon' })).json().code).toBe('build_order_target_invalid');
    expect((await call('POST', '/u8/build-order/assign', h.dave, { from: P1, to: '0:0:2:planet' })).json().code).toBe('build_order_target_invalid');
    expect((await call('POST', '/u8/build-order/assign', h.dave, { from: '0:0:2:planet', to: HOME })).json().code).toBe('build_order_planet_taken');
    const res = (await call('POST', '/u8/build-order/assign', h.dave, { from: P1, to: HOME })).json();
    expect(res.buildOrder.order).toEqual({ base: { planets: { [HOME]: { 1: 10 } }, research: {} }, planets: { [HOME]: planned.planets[P1] } });
    expect(res.buildOrder.meta.mapping).toEqual({ 1: HOME });
    await call('DELETE', '/u8/build-order', h.dave);
    db.prepare('DELETE FROM empire_snapshots WHERE user_id = ?').run(ids.dave);
  });

  it('lets an API token plan: planned planets, transports with ships, the timeline', async () => {
    const P1 = '0:0:1:planet';
    const COLONY = '1:5:4:planet';
    // a read-only token (the default, and every token created before the choice) may not write the build order
    const readOnly = (await call('POST', '/auth/tokens', h.dave, { name: 'reader' })).json();
    expect(readOnly.write).toBe(false);
    const reader = { authorization: `Bearer ${readOnly.token}`, 'x-hub-group': String(group) };
    expect((await call('PUT', '/u8/build-order', reader, { order: { base: { planets: {}, research: {} }, planets: {} } })).json().code).toBe('read_only_token');
    expect((await call('DELETE', '/u8/build-order', reader)).json().code).toBe('read_only_token');

    const created = (await call('POST', '/auth/tokens', h.dave, { name: 'planner', write: true })).json();
    expect(created.write).toBe(true);
    const listed = (await call('GET', '/auth/tokens', h.dave)).json();
    expect(listed.map((r: { name: string; write: boolean }) => [r.name, r.write]).sort()).toEqual([['planner', true], ['reader', false]]);
    const bearer = { authorization: `Bearer ${created.token}`, 'x-hub-group': String(group) };
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(
      group, ids.dave, T0 + 60, JSON.stringify({ ...empire, research: { 117: 3, 124: 1 }, planets: [{ ...empire.planets[0], resources: { 901: 9000, 902: 9000, 903: 9000 } }] }),
    );
    // the snapshot deleted above may have had the same row id: forget what was parsed for it
    (await import('../src/repo/empire.js')).clearEmpireCache();
    const steps = [
      { id: 'col', kind: 'transport', transport: { target: P1, resources: { 901: 500 }, flight: 0, mission: 'colonize', ships: { 208: 1 } } },
      { id: 'tr', kind: 'transport', transport: { target: P1, resources: {}, flight: 0, ships: { 202: 1 }, all: true, notBefore: t + 86400 } },
    ];
    const planned = { [P1]: { name: 'Colony', coords: { g: 1, s: 5, p: 4 }, temp: 30 } };
    const plan = { base: { planets: {}, research: {} }, planets: { [HOME]: steps, [P1]: [{ id: 'm', kind: 'building', element: 1 }] }, planned };
    expect((await call('GET', '/u8/build-order/timeline', bearer)).statusCode).toBe(404);
    const put = await call('PUT', '/u8/build-order', bearer, { order: plan, meta: { source: 'agent' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().buildOrder.order).toEqual(plan);
    // every other write stays refused with a token
    expect((await call('PUT', '/u8/storage-alerts', bearer, {})).json().code).toBe('read_only_token');

    const timeline = (await call('GET', '/u8/build-order/timeline', bearer)).json();
    const by = (id: string) => timeline.steps.find((s: { id: string }) => s.id === id);
    expect(timeline.next[HOME]).toBe('col');
    expect(by('col')).toMatchObject({ planet: HOME, state: 'planned', cost: { 901: 500 } });
    expect(by('col').end).toBeGreaterThan(by('col').start);
    expect(by('col').fuel).toBeGreaterThan(0);
    // the colony is founded when the ship lands; the transporter leaves at its set time
    expect(by('m')).toMatchObject({ planet: P1, state: 'planned', start: by('col').end, wait: 'colony' });
    expect(by('tr')).toMatchObject({ state: 'planned', start: t + 86400, wait: 'time' });

    // PATCH keeps the planned details, and drops those of a planet left out
    const patched = (await call('PATCH', '/u8/build-order', bearer, { planets: plan.planets })).json().buildOrder.order;
    expect(patched.planned).toEqual(planned);
    expect((await call('PATCH', '/u8/build-order', bearer, { planets: plan.planets, planned: { '0:0:2:planet': {} } })).statusCode).toBe(400);
    expect((await call('PATCH', '/u8/build-order', bearer, { planets: { [HOME]: [] } })).json().buildOrder.order.planned).toBeUndefined();
    await call('PATCH', '/u8/build-order', bearer, { planets: plan.planets, planned });

    // the colony is synced at the planned coordinates: assigned by the catch-up after a paste
    const colony = { ...empire.planets[0], name: 'Colony', coords: { g: 1, s: 5, p: 4 }, values: {} };
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(
      group, ids.dave, t, JSON.stringify({ ...empire, research: { 117: 3, 124: 1 }, planets: [empire.planets[0], colony] }),
    );
    const { catchUpBuildState } = await import('../src/repo/buildOrders.js');
    const { resolveGroup, getUniverse } = await import('../src/context.js');
    catchUpBuildState(db, resolveGroup(db, { id: ids.dave, username: 'dave', isAdmin: false } as never, getUniverse(db, 'u8'), group));
    const after = (await call('GET', '/u8/build-order', bearer)).json().buildOrder.order;
    expect(after.planned).toBeUndefined();
    expect(Object.keys(after.planets)).toEqual([HOME, COLONY]);
    expect(after.planets[HOME]).toMatchObject([{ id: 'col', done: true, transport: { target: COLONY } }, { id: 'tr', transport: { target: COLONY } }]);

    expect((await call('DELETE', '/u8/build-order', bearer)).json()).toEqual({ buildOrder: null });
    db.prepare('DELETE FROM empire_snapshots WHERE user_id = ?').run(ids.dave);
    db.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(ids.dave);
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
