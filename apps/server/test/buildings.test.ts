import { readFileSync } from 'node:fs';
import { buildingCost, deriveResearchSpeed } from '@pr0hub/core/buildings';
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

/** Metal mine 10 on [1:1:1] synced two hours ago: 3600 metal and 360 crystal per hour from nothing. */
const T0 = t - 7200;
const empire = (values: Record<number, number>, building: { id: number; level: number } | null = null) => ({
  kind: 'empire', research: {},
  planets: [
    {
      name: 'Home', coords: { g: 1, s: 1, p: 1 }, type: 'planet', values: { 22: 5, 23: 5, 24: 5, ...values }, fields: { used: 30, max: 163 },
      resources: { 901: 0, 902: 0, 903: 0 }, perHour: { 901: 3600, 902: 360, 903: 0 }, building,
    },
  ],
});
const cost = buildingCost(1, 11);

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
  db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, ids.carol, T0, JSON.stringify(empire({ 1: 10, 2: 5 })));
  db.prepare('UPDATE users SET discord_webhook = ? WHERE id = ?').run(HOOK, ids.carol);
  await call('POST', '/push/subscriptions', h.carol, { endpoint: 'https://push.example/carol', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
});

beforeEach(() => {
  pushed.length = 0;
  posted.length = 0;
});

describe('buildings page', () => {
  it('shows the own planets with production, and fleets bringing resources', async () => {
    const res = (await call('GET', '/u8/buildings', h.carol)).json();
    expect(res.planets).toHaveLength(1);
    expect(res.planets[0]).toMatchObject({ key: '1:1:1:planet', source: 'empire', planet: { time: T0, values: { 1: 10 } }, arrivals: [] });
    expect(res.alerts).toEqual([]);
    // another member sees only their own (none)
    expect((await call('GET', '/u8/buildings', h.dave)).json().planets).toEqual([]);
  });

  it('validates alerts: own synced planets and buildings of the planet type only', async () => {
    expect((await call('PUT', '/u8/buildings/alerts', h.carol, { g: 1, s: 1, p: 1, type: 'planet', id: 41, level: 1 })).statusCode).toBe(400);
    expect((await call('PUT', '/u8/buildings/alerts', h.carol, { g: 1, s: 1, p: 2, type: 'planet', id: 1, level: 11 })).statusCode).toBe(404);
    expect((await call('PUT', '/u8/buildings/alerts', h.carol, { g: 1, s: 1, p: 1, type: 'planet', id: 1 })).statusCode).toBe(400);
  });

  it('notifies once when the resources are there, a landing fleet included', async () => {
    // crystal alone takes cost / 360 h (> 2 h); a transport landing an hour ago makes it affordable now
    expect(cost[902] / 360).toBeGreaterThan(2);
    const alerts = (await call('PUT', '/u8/buildings/alerts', h.carol, { g: 1, s: 1, p: 1, type: 'planet', id: 1, level: 11 })).json().alerts;
    expect(alerts).toMatchObject([{ element_id: 1, level: 11 }]);
    await app.push.deliver(group, t);
    expect(pushed).toEqual([]);

    const fleet = {
      owner: 'own', player: null, mission: 3, missionName: 'Transport', phase: 'out', ships: { 202: 10 }, resources: { 901: 0, 902: 1000, 903: 0 },
      arrival: t - 3600, from: { coords: { g: 1, s: 1, p: 9 }, type: 'planet', name: null }, to: { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: null },
    };
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, ids.carol, T0 + 60, JSON.stringify([fleet]));
    const state = (await call('GET', '/u8/buildings', h.carol)).json();
    expect(state.planets[0].arrivals).toMatchObject([{ at: t - 3600, resources: { 902: 1000 }, mission: 3, back: false }]);

    const bell = (await call('GET', '/u8/notifications', h.carol)).json();
    expect(bell).toMatchObject([{ kind: 'building', element: 1, level: 11, planet: { g: 1, s: 1, p: 1, type: 'planet', name: 'Home' }, time: t - 3600 }]);
    await app.push.deliver(group, t);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload).toMatchObject({ title: '🏗 Metallmine 11 baubar', url: `/hub/u8/build?tab=buildings&c=1%3A1%3A1&type=planet&group=${group}` });
    await app.discord.deliver(group, t);
    expect(posted).toHaveLength(1);
    expect(posted[0].message.embeds[0].title).toBe('🏗 Metallmine 11 baubar');
    // once
    await app.push.tick(t + 60);
    await app.discord.tick(t + 60);
    expect(pushed).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });

  it('looks at waiting alerts only when they may be ready, and sends them on time', async () => {
    // the robot factory needs deuterium, which the planet does not produce: it waits for a transport landing in 10 minutes
    const fleet = {
      owner: 'own', player: null, mission: 3, missionName: 'Transport', phase: 'out', ships: { 202: 10 }, resources: { 901: 0, 902: 0, 903: 1e6 },
      arrival: t + 600, from: { coords: { g: 1, s: 1, p: 9 }, type: 'planet', name: null }, to: { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: null },
    };
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, ids.carol, t + 1, JSON.stringify([fleet]));
    await call('PUT', '/u8/buildings/alerts', h.carol, { g: 1, s: 1, p: 1, type: 'planet', id: 14, level: 1 });
    // the delivery after the change plans the group for the landing
    await app.push.deliver(group, t);
    const deliver = vi.spyOn(app.push, 'deliver');
    await app.push.tick(t + 300);
    expect(deliver).not.toHaveBeenCalled();
    await app.push.tick(t + 601);
    expect(deliver).toHaveBeenCalledTimes(1);
    deliver.mockRestore();
    expect(pushed.map((p) => p.payload.title)).toEqual(['🏗 Roboterfabrik 1 baubar']);
    db.prepare('DELETE FROM fleet_snapshots WHERE page_time = ?').run(t + 1);
    db.prepare('DELETE FROM building_alerts WHERE element_id = 14').run();
  });

  it('respects the setting and removes the alert once the level is queued', async () => {
    expect((await call('POST', '/auth/push-settings', h.carol, { buildings: false })).json()).toMatchObject({ buildings: false });
    await call('POST', '/auth/push-settings', h.carol, { buildings: true });
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)')
      .run(group, ids.carol, t - 30, JSON.stringify(empire({ 1: 10, 2: 5 }, { id: 1, level: 11 })));
    const res = (await call('GET', '/u8/buildings', h.carol)).json();
    expect(res.alerts).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) FROM building_alerts').pluck().get()).toBe(0);
  });

  it('keeps hidden buildings in the account', async () => {
    expect((await call('GET', '/u8/buildings', h.carol)).json().hidden).toEqual([]);
    expect((await call('PUT', '/u8/buildings/hidden', h.carol, { ids: [6, 999] })).statusCode).toBe(400);
    expect((await call('PUT', '/u8/buildings/hidden', h.carol, { ids: [34, 6, 34] })).json()).toEqual({ hidden: [6, 34] });
    expect((await call('GET', '/u8/buildings', h.carol)).json().hidden).toEqual([6, 34]);
    expect((await call('GET', '/u8/buildings', h.dave)).json().hidden).toEqual([]);
    expect((await call('PUT', '/u8/buildings/hidden', h.carol, { ids: [] })).json()).toEqual({ hidden: [] });
  });

  it('knows when research or the shipyard keep the lab and shipyard busy', async () => {
    const overview = {
      kind: 'overview', pageTime: null, current: null, catchUp: null,
      queues: [
        { kind: 'research', coords: { g: 1, s: 1, p: 1 }, type: 'planet', id: 113, level: 5, destroy: false, seconds: 600 },
        { kind: 'shipyard', coords: { g: 1, s: 1, p: 1 }, type: 'planet', id: 202, level: 10, destroy: false, seconds: 60 },
      ],
    };
    db.prepare('INSERT INTO overview_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, ids.carol, t, JSON.stringify(overview));
    const state = (await call('GET', '/u8/buildings', h.carol)).json();
    expect(state.planets[0].planet.busy).toEqual({ research: { until: t + 600 }, shipyard: { until: null }, lab: null });
    db.prepare('DELETE FROM overview_snapshots WHERE user_id = ?').run(ids.carol);
  });

  it('stores a synced buildings page and takes its levels, costs and resources when newer', async () => {
    const html = readFileSync(new URL('../../../packages/parser/test/fixtures/buildings.html', import.meta.url), 'utf8');
    const res = await call('POST', '/u8/ingest', h.dave, { html });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pageType: 'buildings', counts: { buildings: { new: 1 } } });
    const state = (await call('GET', '/u8/buildings', h.dave)).json();
    expect(state.catchUp).toBe(12.5);
    expect(state.planets).toHaveLength(1);
    expect(state.planets[0]).toMatchObject({
      key: '1:100:12:planet', source: 'buildings',
      // the crystal mine of the queue finished long ago
      planet: { queue: [], values: { 1: 18, 2: 16, 15: 0 }, resources: { 901: 120000 }, storage: { 901: 1215000 }, perHour: { 902: 3000 },
        // the page shows the shipyard busy; no lab on it, nothing else tells about research
        busy: { research: null, shipyard: { until: null } } },
      shown: { 1: { next: 19, cost: { 901: 77907, 902: 19476 }, time: 2804 }, 2: { next: 17 } },
    });
  });

  it('takes the exact catch-up bonus behind the costs, and the statistics once they are newer', async () => {
    const html = readFileSync(new URL('../../../packages/parser/test/fixtures/buildings-real-source.html', import.meta.url), 'utf8');
    expect((await call('POST', '/u8/ingest', h.dave, { html })).json()).toMatchObject({ pageType: 'buildings' });
    let state = (await call('GET', '/u8/buildings', h.dave)).json();
    // the page shows 10.18 %, its costs need 10.1838 %
    expect(state.catchUp).toBeCloseTo(10.1838, 3);
    expect(state.catchUpFrom.source).toBe('page');
    expect(state.planets.find((p: { key: string }) => p.key === '1:100:12:planet').planet.fields).toEqual({ used: 168, max: 208 });

    // a statistics update after the page: the game's formula with the own and the leader's points
    const dave = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Dave')").run(group).lastInsertRowid);
    const top = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Top')").run(group).lastInsertRowid);
    const points: Record<number, [number, number]> = { 4: [500, 1000], 3: [250, 500], 2: [100, 200] };
    for (const [type, [own, best]] of Object.entries(points)) {
      const snap = Number(db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', ?, ?)").run(group, Number(type), t).lastInsertRowid);
      db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points) VALUES (?, ?, 2, ?)').run(snap, dave, own);
      db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points) VALUES (?, ?, 1, ?)').run(snap, top, best);
    }
    state = (await call('GET', '/u8/buildings', h.dave)).json();
    // half of the leader's weighted points
    expect(state.catchUpFrom).toEqual({ source: 'stats', time: t });
    expect(state.catchUp).toBeCloseTo((50 / 9) * (10 * 0.9747 ** 50 - 1), 8);
  });

  it('takes research levels, queue and the lab lock from a research page and notifies research alerts', async () => {
    const html = readFileSync(new URL('../../../packages/parser/test/fixtures/research.html', import.meta.url), 'utf8');
    expect((await call('POST', '/u8/ingest', h.dave, { html })).json()).toMatchObject({ pageType: 'research', counts: { research: { new: 1 } } });
    const state = (await call('GET', '/u8/buildings', h.dave)).json();
    expect(state.research).toMatchObject({ 106: 8, 123: 0 });
    expect(state.researchQueue).toEqual([{ id: 113, level: 13, end: 4102444800 }, { id: 106, level: 9, end: 4102448400 }]);
    const ares = state.planets.find((p: { key: string }) => p.key === '1:100:12:planet');
    // the page says the lab is being built; the queue runs until its last entry
    expect(ares.planet.busy).toMatchObject({ research: { until: 4102448400 }, lab: { until: null } });
    expect(ares.shownResearch[106]).toEqual({ next: 10, cost: { 901: 45986, 902: 229930, 903: 45986 }, time: 1234 });
    // research alerts only on planets
    expect((await call('PUT', '/u8/buildings/alerts', h.dave, { g: 1, s: 100, p: 12, type: 'moon', id: 106, level: 10 })).statusCode).toBe(400);
    expect((await call('PUT', '/u8/buildings/alerts', h.dave, { g: 1, s: 100, p: 12, type: 'planet', id: 106, level: 10 })).statusCode).toBe(200);
    expect((await call('PUT', '/u8/buildings/hidden', h.dave, { ids: [6, 199] })).json()).toEqual({ hidden: [6, 199] });
  });

  it('merges a newer overview into the queue of a buildings page, also behind a newer research page', async () => {
    const coords = { g: 1, s: 1, p: 1 };
    const bar = { resources: { 901: 0, 902: 0, 903: 0 }, storage: {}, perHour: {}, catchUp: null };
    const page = {
      kind: 'buildings', coords, type: 'planet', pageTime: null, ...bar, fields: null,
      buildings: [{ id: 1, level: 10, cost: {}, time: null }, { id: 2, level: 5, cost: {}, time: null }, { id: 3, level: 0, cost: {}, time: null }],
      queue: [
        { id: 1, level: 11, destroy: false, end: t - 15 },
        { id: 2, level: 6, destroy: false, end: null },
        { id: 3, level: 1, destroy: false, end: null },
      ],
    };
    const research = { kind: 'research', coords, type: 'planet', pageTime: null, ...bar, labBusy: false, noLab: false, research: [], queue: [] };
    // the metal mine finished, the crystal mine runs now
    const overview = {
      kind: 'overview', pageTime: null, current: null, catchUp: null,
      queues: [{ kind: 'building', coords, type: 'planet', id: 2, level: 6, destroy: false, seconds: 600 }],
    };
    const row = '(group_id, user_id, g, s, p, planet_type, page_time, data) VALUES (?, ?, 1, 1, 1, ?, ?, ?)';
    db.prepare(`INSERT INTO building_snapshots ${row}`).run(group, ids.carol, 'planet', t - 20, JSON.stringify(page));
    db.prepare(`INSERT INTO research_snapshots ${row}`).run(group, ids.carol, 'planet', t - 10, JSON.stringify(research));
    db.prepare('INSERT INTO overview_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, ids.carol, t - 5, JSON.stringify(overview));
    const state = (await call('GET', '/u8/buildings', h.carol)).json();
    expect(state.planets[0]).toMatchObject({ source: 'research', planet: { values: { 1: 11, 2: 5, 3: 0 } } });
    expect(state.planets[0].planet.queue).toEqual([
      { id: 2, level: 6, destroy: false, end: t + 595 },
      { id: 3, level: 1, destroy: false, end: null },
    ]);
    for (const table of ['building_snapshots', 'research_snapshots', 'overview_snapshots']) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(ids.carol);
  });

  it('derives the research speed with the lab levels of the time of the research page, not later upgrades', async () => {
    const pageTime = db.prepare('SELECT page_time FROM research_snapshots WHERE user_id = ? ORDER BY page_time DESC LIMIT 1').pluck().get(ids.dave) as number;
    const planet = (lab: number) => ({ kind: 'empire', research: {}, planets: [{ name: 'Ares', coords: { g: 1, s: 100, p: 12 }, type: 'planet', values: { 31: lab } }] });
    // lab 12 when the page was synced, lab 14 since then
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, ids.dave, pageTime - 100, JSON.stringify(planet(12)));
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, ids.dave, pageTime + 3600, JSON.stringify(planet(14)));
    const state = (await call('GET', '/u8/buildings', h.dave)).json();
    // the page's longest time: the research network, 574835 metal + crystal in 9999 s
    expect(state.researchSpeed).toBe(deriveResearchSpeed({ 901: 215563, 902: 359272 }, 9999, 12));
    expect(state.planets.find((p: { key: string }) => p.key === '1:100:12:planet').planet.values[31]).toBe(14);
  });
});

