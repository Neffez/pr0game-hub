import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { scoreEntry, statSlots } = await import('../src/domain/stats.js');

/** Query for the lists that show the last 8 days by default: the fixtures' reports are dated in October 2026. */
const EVER = 'from=1&to=4102444800';

const fixture = (name: string) =>
  readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'hub_session')!;
  return { cookie: `hub_session=${cookie.value}` };
}

let admin: { cookie: string };
let groupA: number;
let groupB: number;

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  admin = await login('admin', 'adminpass');
  const h = { headers: admin };
  expect((await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h })).statusCode).toBe(200);
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  groupB = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, ...h })).json().id;
});

describe('api', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/hub/api/u8/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('ingests stats and computes deltas', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const html = fixture('stats-player.html');
    // Older snapshot (type 2, 6h earlier) with lower points via text edit of the fixture.
    const older = html.replace('12:00:03', '06:00:03').replace('1.234.567', '1.000.000');
    let res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: older } });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts.player_scores).toEqual({ new: 3, duplicate: 0 });
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } });
    expect(res.json().counts.player_scores).toEqual({ new: 3, duplicate: 0 });
    // Same paste again -> duplicates only.
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } });
    expect(res.json().counts.player_scores).toEqual({ new: 0, duplicate: 3 });

    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    const alpha = ov.players.find((p: any) => p.name === 'Alpha');
    expect(alpha.ingame_id).toBe(1234);
    expect(alpha.ally_name).toBe('Die Allianz');
    expect(alpha.scores[2]).toMatchObject({ points: 1234567, rankChange: 3 });
    expect(alpha.scores[2].deltas['6h']).toMatchObject({ delta: 234567, partial: false });
    // Only 6h of history: the 24h delta falls back to the oldest snapshot.
    expect(alpha.scores[2].deltas['24h']).toMatchObject({ delta: 234567, partial: true });
    // FF-Hub style slots per statistics update: newest update against the one before; no older update yet
    expect(alpha.scores[2].slots[0]).toMatchObject({ delta: 234567 });
    expect(alpha.scores[2].slots[1]).toBeNull();
  });

  it('matches plain-text players by name to existing ids', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture('stats-player.txt') } });
    expect(res.json().counts.player_scores.new).toBe(3);
    const players = db.prepare('SELECT COUNT(*) FROM players WHERE group_id = ?').pluck().get(groupA);
    expect(players).toBe(3);
  });

  it('ingests messages and serves spy history, expeditions and deck', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('messages.html') } });
    expect(res.json().counts).toMatchObject({
      spy_reports: { new: 1 }, battle_reports: { new: 1 }, expeditions: { new: 3 }, hostile_spying: { new: 1 }, recycle_reports: { new: 1 },
    });
    const spy = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy/1/234/5', headers })).json();
    expect(spy.total).toBe(1);
    expect(spy.reports[0].sections['900']['901']).toBe(1234567);

    const deck = (await app.inject({ method: 'GET', url: '/hub/api/u8/deck', headers })).json();
    expect(deck.state.drawnInDeck).toBe(3);

    const raids = (await app.inject({ method: 'GET', url: `/hub/api/u8/raids?${EVER}`, headers })).json();
    expect(raids.perUser[0]).toMatchObject({ raids: 1, metal: 600000 });
    expect(raids.recyclePerUser[0]).toMatchObject({ runs: 1, metal: 80000, crystal: 25000, left: 3895000 });
    const activity = (await app.inject({ method: 'GET', url: `/hub/api/u8/activity?kinds=debris_shrunk&${EVER}`, headers })).json();
    expect(activity.entries[0].data).toMatchObject({ metal: 2920000, crystal: 975000, collected: { metal: 80000, crystal: 25000 }, by: 'admin' });

    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    const planet = ov.planets.find((p: any) => p.g === 1 && p.s === 234 && p.p === 5);
    expect(planet).toMatchObject({ type: 'planet', name: 'Heimat' });
    // 15 small cargos at 4000 resources each
    expect(planet.spy).toMatchObject({ res: { 901: 1234567 }, fleet: 60, defense: 0 });
  });

  it('imports universe.json without overwriting fresher views', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const text = fixture('universe.json');
    let res = await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text } });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts.galaxy_systems).toEqual({ new: 2, duplicate: 0 });
    const planet = db.prepare('SELECT * FROM planets WHERE group_id = ? AND g = 1 AND s = 234 AND p = 5').get(groupA) as any;
    expect(planet).toMatchObject({ name: 'Heimat', has_moon: 1 });
    // An older export is skipped
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: text.replaceAll('"timepoint": 1792', '"timepoint": 1791') } });
    expect(res.json().counts.galaxy_systems).toEqual({ new: 0, duplicate: 2 });
    // Names from an export older than the stats don't rename the player, they become aliases.
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: text.replaceAll('"Alpha"', '"AltAlpha"').replaceAll('"timepoint": 1792569600000', '"timepoint": 1792570000000') } });
    const alpha = db.prepare('SELECT id, name FROM players WHERE group_id = ? AND ingame_id = 1234').get(groupA) as any;
    expect(alpha.name).toBe('Alpha');
    expect(db.prepare('SELECT name FROM player_aliases WHERE player_id = ?').pluck().all(alpha.id)).toContain('AltAlpha');
    // universe browser: system view and the per-galaxy navigation strip
    const sys = (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1/234', headers })).json();
    expect(sys.view.seen_at).toBe(1792570000);
    expect(sys.rows.find((r: any) => r.p === 5)).toMatchObject({ name: 'Heimat', has_moon: 1, player_name: 'Alpha', ally_name: 'Die Allianz' });
    const strip = (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1', headers })).json();
    expect(strip.planets['234']).toBe(2);
    expect(strip.seen['235']).toBe(1792483200);
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: '{}' } });
    expect(res.statusCode).toBe(400);
  });

  it('serves the latest empire and overview page for the live imperium view', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    for (const f of ['empire-real-source.html', 'overview.html']) {
      const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture(f) } });
      expect(res.statusCode).toBe(200);
    }
    const im = (await app.inject({ method: 'GET', url: '/hub/api/u8/imperium', headers })).json();
    // page times (Berlin) become the snapshot times
    expect(im.empire.time).toBe(Date.UTC(2026, 9, 21, 11, 43, 45) / 1000);
    expect(im.empire.data.planets[0].perHour).toEqual({ 901: 38369 });
    expect(im.overview.time).toBe(Date.UTC(2026, 9, 21, 12, 0, 0) / 1000);
    expect(im.overview.data.queues).toHaveLength(5);
  });

  it('gives the own planets with silo level and missiles for the IPM calculator link', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    // rows of the empire page: sum, then one cell per planet (planet 1:100:12, its moon, planet 3:200:1)
    const row = (info: string, name: string, sum: number, cells: number[]) =>
      `<tr data-info="${info}"><td><a href='#'>${name}</a></td><td>${sum}</td>${cells.map((v) => `<td><span class="">${v}</span></td>`).join('')}</tr>`;
    const text = fixture('empire-real-source.html').replace(
      '<tr class="defenses" data-info="d_401">',
      `${row('b_44', 'Raketensilo', 6, [5, 0, 1])}${row('d_503', 'Interplanetarrakete', 12, [12, 0, 0])}<tr class="defenses" data-info="d_401">`,
    );
    expect((await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text } })).statusCode).toBe(200);
    const ctx = (await app.inject({ method: 'GET', url: '/hub/api/u8/context', headers })).json();
    expect(ctx.own.planets.map((p: any) => [p.coords, p.type, p.silo, p.ipm])).toEqual([
      [{ g: 1, s: 100, p: 12 }, 'planet', 5, 12],
      [{ g: 1, s: 100, p: 12 }, 'moon', 0, 0],
      [{ g: 3, s: 200, p: 1 }, 'planet', 1, 0],
    ]);
  });

  it('keeps the newest fleet movements of the overview or pasted on their own', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    let res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture('overview-fleets.html') } });
    expect(res.json().counts.fleets).toEqual({ new: 1, duplicate: 0 });
    let im = (await app.inject({ method: 'GET', url: '/hub/api/u8/imperium', headers })).json();
    // page time + remaining seconds = the game's arrival timestamp (data-fleet-end-time)
    expect(im.fleets.data.map((f: any) => f.arrival)).toEqual([1792707523, 1792715605, 1792737047]);

    const line = '00:18:43 | 17m 27s Eine deiner Flotten (1 Leichter Jäger) kehrt vom Mond X [1:129:11] zurück zum Planet Ares [1:100:12]. Mission: Angreifen';
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: line } });
    expect(res.json()).toMatchObject({ pageType: 'fleets', preview: [{ kind: 'fleets', fleets: 1, hostile: 0 }] });
    im = (await app.inject({ method: 'GET', url: '/hub/api/u8/imperium', headers })).json();
    expect(im.fleets.data).toHaveLength(1);
    // without a page time the arrival is the shown clock (00:18:43 Berlin) on the day it is due
    const berlin = new Date(im.fleets.data[0].arrival * 1000).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' });
    expect(berlin).toBe('00:18:43');
    // the overview page is older than 12 hours but kept: it holds the fleets arriving until the pasted list
    expect(db.prepare('SELECT COUNT(*) FROM fleet_snapshots WHERE group_id = ?').pluck().get(groupA)).toBe(2);
    const alliance = (await app.inject({ method: 'GET', url: '/hub/api/u8/alliance', headers })).json();
    expect(alliance.find((m: any) => m.user_id === im.userId).fleets.data).toHaveLength(1);
  });

  it('keeps the fleet movements of the last 12 hours as history', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get() as number;
    db.prepare('DELETE FROM fleet_snapshots WHERE group_id = ?').run(groupA);
    const t = Math.floor(Date.now() / 1000);
    const fleet = (mission: number, arrival: number) => ({
      owner: 'own', player: null, mission, missionName: 'x', phase: 'out', ships: { 202: 1 }, resources: null, arrival,
      from: { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: null }, to: { coords: { g: 1, s: 1, p: 2 }, type: 'planet', name: null },
    });
    const insert = db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)');
    // 1: arrived 13 h ago (too old); 3: recalled, missing from the next list although due later
    insert.run(groupA, adminId, t - 15 * 3600, JSON.stringify([fleet(1, t - 13 * 3600), fleet(2, t - 11 * 3600)]));
    insert.run(groupA, adminId, t - 2 * 3600, JSON.stringify([fleet(3, t - 900), fleet(4, t - 3600)]));
    insert.run(groupA, adminId, t - 1200, JSON.stringify([fleet(6, t - 600), fleet(7, t + 600)]));
    const im = (await app.inject({ method: 'GET', url: '/hub/api/u8/imperium', headers })).json();
    expect(im.fleetHistory.map((f: any) => f.mission)).toEqual([2, 4]);

    // a new list drops the ones older than 12 hours except the newest of them
    const line = '1h 0m 0s Eine deiner Flotten (1 Leichter Jäger) vom Planet Ares [1:100:12] erreicht den Planet X [1:129:11]. Mission: Angreifen';
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: line } });
    expect(db.prepare('SELECT COUNT(*) FROM fleet_snapshots WHERE group_id = ?').pluck().get(groupA)).toBe(4);
    insert.run(groupA, adminId, t - 16 * 3600, '[]');
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: line.replace('1 Leichter', '2 Leichter') } });
    expect(db.prepare('SELECT COUNT(*) FROM fleet_snapshots WHERE group_id = ?').pluck().get(groupA)).toBe(5);
    expect(db.prepare('SELECT MIN(page_time) FROM fleet_snapshots WHERE group_id = ?').pluck().get(groupA)).toBe(t - 15 * 3600);
    const after = (await app.inject({ method: 'GET', url: '/hub/api/u8/imperium', headers })).json();
    expect(after.fleetHistory.map((f: any) => f.mission)).toEqual([2, 4, 6]);
  });

  it('shares fleet movements with the other members as the owner chose', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    // the list pasted in the test before is newer than this page
    db.prepare('DELETE FROM fleet_snapshots WHERE group_id = ?').run(groupA);
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture('overview-fleets.html') } });
    const erin = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('erin', hashPassword('erinpass1')).lastInsertRowid);
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(groupA, erin);
    const other = { ...(await login('erin', 'erinpass1')), 'x-hub-group': String(groupA) };
    const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get() as number;
    const seen = async (h: object) => {
      const im = (await app.inject({ method: 'GET', url: `/hub/api/u8/imperium?user=${adminId}`, headers: h })).json();
      const al = (await app.inject({ method: 'GET', url: '/hub/api/u8/alliance', headers: h })).json();
      return { im: im.fleets?.data.map((f: any) => f.mission) ?? null, private: im.fleets?.private, al: al.find((m: any) => m.user_id === adminId).fleets };
    };
    expect((await app.inject({ method: 'GET', url: '/hub/api/auth/fleet-share', headers: admin })).json()).toEqual({ enabled: true, hidden: [], history: true });
    expect((await app.inject({ method: 'GET', url: '/hub/api/auth/show-online', headers: admin })).json()).toEqual({ enabled: true });
    expect((await seen(other)).im).toEqual([1, 4, 4]);

    // deploys hidden: the others don't see them, the owner still does
    let res = await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: true, hidden: [4, 4, 99] } });
    expect(res.json()).toEqual({ enabled: true, hidden: [4], history: true });
    expect((await seen(other)).im).toEqual([1]);
    expect((await seen(other)).al.data).toHaveLength(1);
    expect((await seen(headers)).im).toEqual([1, 4, 4]);

    res = await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: false, hidden: [] } });
    expect(await seen(other)).toMatchObject({ im: [], private: true, al: { data: [], private: true } });
    expect((await seen(headers)).im).toEqual([1, 4, 4]);
    await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: true, hidden: [] } });
  });

  it('shows attacks and spying of members still flying in the overview', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const other = { ...(await login('erin', 'erinpass1')), 'x-hub-group': String(groupA) };
    const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get() as number;
    const planets = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json().planets;
    const target = planets.find((p: any) => p.type === 'planet');
    const coords = { g: target.g, s: target.s, p: target.p };
    const t = Math.floor(Date.now() / 1000);
    const fleet = (mission: number, arrival: number, phase = 'out', owner = 'own') => ({
      owner, player: null, mission, missionName: 'x', phase, ships: { 210: 1 }, resources: null, arrival,
      from: { coords: { g: 9, s: 9, p: 9 }, type: 'planet', name: null }, to: { coords, type: 'planet', name: null },
    });
    db.prepare('DELETE FROM fleet_snapshots WHERE group_id = ?').run(groupA);
    // arrived, returning and foreign fleets don't count; the earliest attack (ACS, destroy too) is shown
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(groupA, adminId, t - 60, JSON.stringify([
      fleet(6, t - 10), fleet(1, t + 900, 'return'), fleet(1, t + 50, 'out', 'foreign'), fleet(9, t + 600), fleet(2, t + 300), fleet(6, t + 120),
    ]));
    const row = async (h: object) =>
      (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers: h })).json().planets.find(
        (p: any) => p.type === 'planet' && p.g === coords.g && p.s === coords.s && p.p === coords.p,
      );
    expect(await row(headers)).toMatchObject({ next_attack: { arrival: t + 300, members: ['admin'] }, next_spy: { arrival: t + 120, members: ['admin'] } });
    // the owner's fleet sharing applies
    await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: true, hidden: [6] } });
    expect(await row(other)).toMatchObject({ next_attack: { arrival: t + 300 }, next_spy: null });
    await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: true, hidden: [] } });
    db.prepare('DELETE FROM fleet_snapshots WHERE group_id = ?').run(groupA);
  });

  it('shares the fleet history unless the owner turned it off', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const other = { ...(await login('erin', 'erinpass1')), 'x-hub-group': String(groupA) };
    const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get() as number;
    db.prepare('DELETE FROM fleet_snapshots WHERE group_id = ?').run(groupA);
    const t = Math.floor(Date.now() / 1000);
    const fleet = (owner: string, mission: number, arrival: number) => ({
      owner, player: null, mission, missionName: 'x', phase: 'out', ships: { 202: 1 }, resources: null, arrival,
      from: { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: null }, to: { coords: { g: 1, s: 1, p: 2 }, type: 'planet', name: null },
    });
    const insert = db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)');
    insert.run(groupA, adminId, t - 3600, JSON.stringify([fleet('own', 3, t - 1800), fleet('hostile', 1, t - 1200)]));
    insert.run(groupA, adminId, t - 600, '[]');
    const seen = async (h: object) => {
      const al = (await app.inject({ method: 'GET', url: '/hub/api/u8/alliance', headers: h })).json();
      return al.find((m: any) => m.user_id === adminId).fleetHistory.map((f: any) => f.mission);
    };
    expect(await seen(other)).toEqual([3, 1]);

    // without the history the others still see the hostile fleets that headed for the owner
    const res = await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: true, hidden: [], history: false } });
    expect(res.json()).toEqual({ enabled: true, hidden: [], history: false });
    expect(await seen(other)).toEqual([1]);
    expect(await seen(headers)).toEqual([3, 1]);
    await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: true, hidden: [] } });
  });

  it('shares single fleets ahead of the owner setting, with the rest of their flight', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const other = { ...(await login('erin', 'erinpass1')), 'x-hub-group': String(groupA) };
    const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get() as number;
    db.prepare('DELETE FROM fleet_snapshots WHERE group_id = ?').run(groupA);
    const t = Math.floor(Date.now() / 1000);
    const a = { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: null };
    const b = { coords: { g: 1, s: 1, p: 2 }, type: 'planet', name: null };
    const fleet = (mission: number, arrival: number, phase = 'out', from = a, to = b) => ({
      owner: 'own', player: null, mission, missionName: 'x', phase, ships: { 202: 1 }, resources: null, arrival, from, to,
    });
    const insert = db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)');
    insert.run(groupA, adminId, t - 3600, JSON.stringify([fleet(3, t - 1800)]));
    insert.run(groupA, adminId, t - 600, JSON.stringify([fleet(1, t + 600), fleet(1, t + 1200, 'return', b, a), fleet(4, t + 300)]));
    const seen = async (h: object) => {
      const im = (await app.inject({ method: 'GET', url: `/hub/api/u8/imperium?user=${adminId}`, headers: h })).json();
      return { fleets: im.fleets.data.map((f: any) => `${f.mission}${f.phase[0]}`), history: im.fleetHistory.map((f: any) => f.mission), private: im.fleets.private };
    };
    const share = (f: object, shared: unknown) => app.inject({ method: 'PUT', url: '/hub/api/u8/fleets/share', headers, payload: { ...f, shared } });
    await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: false } });
    expect(await seen(other)).toEqual({ fleets: [], history: [], private: true });

    // the outbound attack takes its return along; an arrived fleet of the history can be shared too
    expect((await share(fleet(1, t + 602), true)).json()).toEqual({ shared: true, lines: 2 });
    expect((await share(fleet(3, t - 1800), true)).json()).toEqual({ shared: true, lines: 1 });
    expect(await seen(other)).toEqual({ fleets: ['1o', '1r'], history: [3], private: false });
    const own = (await app.inject({ method: 'GET', url: '/hub/api/u8/imperium', headers })).json();
    expect(own.fleets.data.map((f: any) => f.shared)).toEqual([true, true, false]);

    // shared by default: a single fleet can be hidden
    await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: true, hidden: [] } });
    await share(fleet(1, t + 600), false);
    expect((await seen(other)).fleets).toEqual(['4o']);

    expect((await share(fleet(5, t + 600), true)).statusCode).toBe(404);
    expect((await share(fleet(1, t + 600), 'yes')).statusCode).toBe(400);
    db.prepare('DELETE FROM fleet_snapshots WHERE group_id = ?').run(groupA);
    db.prepare('DELETE FROM fleet_share_choices').run();
  });

  it('lets hub admins remove a stored attack from fleet snapshots', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const text =
      '3T 17:13:37 | 3d 01h 25m 12s Eine Flotten vom Mond auch ein Satellit [3:4:1] erreicht den Mond Spicy Noodle [1:82:4]. Mission: Angreifen';
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text } });
    let list = (await app.inject({ method: 'GET', url: `/hub/api/admin/groups/${groupA}/fleet-attacks`, headers: admin })).json();
    expect(list.length).toBe(1);
    expect(list[0].owner).toBe('hostile');
    const { userId, key } = list[0];
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run('fleetally', hashPassword('fleetally12'));
    const allyId = db.prepare("SELECT id FROM users WHERE username = 'fleetally'").pluck().get() as number;
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(groupA, allyId);
    const allyAdmin = await login('fleetally', 'fleetally12');
    expect((await app.inject({ method: 'GET', url: `/hub/api/admin/groups/${groupA}/fleet-attacks`, headers: allyAdmin })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupA}/fleet-attacks/remove`, headers: allyAdmin, payload: { userId, key } }))
        .statusCode,
    ).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupA}/fleet-attacks/remove`, headers: admin, payload: { userId, key } })).json().snapshots).toBeGreaterThan(0);
    list = (await app.inject({ method: 'GET', url: `/hub/api/admin/groups/${groupA}/fleet-attacks`, headers: admin })).json();
    expect(list).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/hostile-attacks', headers })).json()).toHaveLength(0);
  });

  it('notifies the group of hostile fleets heading for a member', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    // other kinds (a full storage of the fixtures' fixed timestamps) come and go with the clock
    const attacks = async (h: object) =>
      (await app.inject({ method: 'GET', url: '/hub/api/u8/notifications', headers: h })).json().filter((n: any) => n.kind === 'attack');
    const text = [
      '2h 0m 0s Eine feindliche Flotte (5 Schlachtschiff) des Spielers Mallory vom Planet Böse [4:20:6] erreicht den Planet Ares [1:100:12]. Mission: Angreifen',
      '1h 0m 0s Eine deiner Flotten (1 Leichter Jäger) vom Planet Ares [1:100:12] erreicht den Planet X [1:129:11]. Mission: Angreifen',
    ].join('\n');
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text } });
    const list = await attacks(headers);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'attack', member: 'admin', fleet: { owner: 'hostile', player: 'Mallory', ships: { 207: 5 } }, fleets: 1 });
    expect(list[0].time - Math.floor(Date.now() / 1000)).toBeGreaterThan(7000);

    // an ACS attack (written without player, its further fleets without time) is one notification with all ships
    const acs = [
      '3h 0m 0s Eine Flotten(1 Spionagesonde) vom Mond Mond [1:41:1] erreicht den Planet Ares [1:100:12]. Mission: Angreifen',
      'Eine Flotten(1773 Schlachtschiff; 2 Schlachtkreuzer) vom Mond Mond [1:41:1] erreicht den Planet Ares [1:100:12]. Mission: Verbandsangriff',
      'Eine Flotten(1322 Schwerer Kreuzer) vom Mond Mond [1:41:1] erreicht den Planet Ares [1:100:12]. Mission: Verbandsangriff',
    ];
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: [text, ...acs].join('\n') } });
    const both = await attacks(headers);
    expect(both).toHaveLength(2);
    expect(both[1]).toMatchObject({ fleets: 3, fleet: { mission: 1, from: { coords: { g: 1, s: 41, p: 1 } }, ships: { 207: 1773, 210: 1, 215: 2, 222: 1322 } } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text } });

    // sharing covers the member's own fleets only: incoming attacks stay visible
    await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: false, hidden: [] } });
    const erinHeaders = { ...(await login('erin', 'erinpass1')), 'x-hub-group': String(groupA) };
    let seen = await attacks(erinHeaders);
    expect(seen.map((n: any) => n.fleet.player)).toEqual(['Mallory']);
    await app.inject({ method: 'POST', url: '/hub/api/auth/fleet-share', headers: admin, payload: { enabled: true, hidden: [] } });

    // a fleet of an alliance member (moon attempt, debris for saving) raises no alarm
    db.prepare("UPDATE group_members SET ingame_name = 'Mallory' WHERE group_id = ? AND user_id = (SELECT id FROM users WHERE username = 'erin')").run(groupA);
    seen = await attacks(headers);
    expect(seen).toEqual([]);
    db.prepare("UPDATE group_members SET ingame_name = NULL WHERE group_id = ? AND user_id = (SELECT id FROM users WHERE username = 'erin')").run(groupA);
  });

  it('keeps player messages private unless the member shares them', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const erin = { ...(await login('erin', 'erinpass1')), 'x-hub-group': String(groupA) };
    const pm = (id: number, from: string, to: string, date: string, body: string) =>
      `<div id="message_${id}" class="message-item"><div class="message-details"><div class="message-from">${from}</div>
       <div class="message-subject">Kein Betreff</div><div class="message-date">${date}</div>
       <div class="message-receiver">An:&nbsp; ${to};</div></div><div class="message-content">${body}</div></div>`;
    const list = async (h: object) => (await app.inject({ method: 'GET', url: '/hub/api/u8/messages', headers: h })).json();

    let res = await app.inject({
      method: 'POST', url: '/hub/api/u8/ingest', headers,
      payload: { html: pm(11, 'Mallory [4:20:6]', 'Admin [1:100:12]', '22. Okt 2026, 21:51:10', 'Hallo <br>\nWelt') + pm(10, 'Admin [1:100:12]', 'Mallory [4:20:6]', '21. Okt 2026, 16:00:00', 'Hi') },
    });
    expect(res.json().counts.player_messages).toEqual({ new: 2, duplicate: 0 });
    const own = await list(headers);
    expect(own.share).toBe(false);
    expect(own.messages.map((m: any) => [m.from_name, m.recipients.map(({ name, coords }: any) => ({ name, coords })), m.body])).toEqual([
      ['Mallory', [{ name: 'Admin', coords: '1:100:12' }], 'Hallo\nWelt'],
      ['Admin', [{ name: 'Mallory', coords: '4:20:6' }], 'Hi'],
    ]);
    expect((await list(erin)).messages).toEqual([]);

    // shared: the others see them; the recipient's copy of the same message (other id) is listed once
    expect((await app.inject({ method: 'POST', url: '/hub/api/auth/message-share', headers: admin, payload: { enabled: true } })).json()).toEqual({ enabled: true });
    await app.inject({
      method: 'POST', url: '/hub/api/u8/ingest', headers: erin,
      payload: { html: pm(99, 'Admin [1:100:12]', 'Mallory [4:20:6]', '21. Okt 2026, 16:00:00', 'Hi') + pm(98, 'Erin', 'Mallory [4:20:6]', '20. Okt 2026, 10:00:00', 'privat') },
    });
    const shared = await list(erin);
    expect(shared.messages.map((m: any) => [m.body, m.synced_by.sort()])).toEqual([['Hallo\nWelt', ['admin']], ['Hi', ['admin', 'erin']], ['privat', ['erin']]]);
    // erin shares nothing: the admin sees none of erin's own messages
    expect((await list(headers)).messages.map((m: any) => [m.body, m.synced_by])).toEqual([['Hallo\nWelt', ['admin']], ['Hi', ['admin']]]);
    // other groups never see them
    expect((await list({ ...admin, 'x-hub-group': String(groupB) })).messages).toEqual([]);

    await app.inject({ method: 'POST', url: '/hub/api/auth/message-share', headers: admin, payload: { enabled: false } });
    expect((await list(erin)).messages.map((m: any) => m.body)).toEqual(['Hi', 'privat']);

    // single messages: shared or not against the account setting, only the own copy
    const mine = (await list(headers)).messages;
    expect(mine.map((m: any) => [m.body, m.own, m.own_shared, m.shared])).toEqual([['Hallo\nWelt', true, false, false], ['Hi', true, false, false]]);
    const share = (id: number, shared: boolean, h: object = headers) =>
      app.inject({ method: 'POST', url: `/hub/api/u8/messages/${id}/share`, headers: h, payload: { shared } });
    expect((await share(mine[0].id, true)).json()).toEqual({ shared: true });
    expect((await list(erin)).messages.map((m: any) => m.body)).toEqual(['Hallo\nWelt', 'Hi', 'privat']);
    // erin has no copy of it
    expect((await share(mine[0].id, false, erin)).statusCode).toBe(404);
    // the id of another member's copy finds the own copy of the same message
    const hi = (await list(erin)).messages.find((m: any) => m.body === 'Hi');
    expect((await share(hi.id, true)).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/hub/api/auth/message-share', headers: admin, payload: { enabled: true } });
    expect((await share(mine[0].id, false)).statusCode).toBe(200);
    expect((await list(erin)).messages.map((m: any) => m.body)).toEqual(['Hi', 'privat']);
    expect((await list(headers)).messages[0]).toMatchObject({ body: 'Hallo\nWelt', own_shared: false, shared: false });
    await app.inject({ method: 'POST', url: '/hub/api/auth/message-share', headers: admin, payload: { enabled: false } });

    // players of the own alliance are marked
    db.prepare("UPDATE group_members SET ingame_name = 'Admin' WHERE group_id = ? AND user_id = 1").run(groupA);
    const marked = (await list(headers)).messages.find((m: any) => m.body === 'Hi');
    expect([marked.from.ally, marked.recipients.map((r: any) => r.ally)]).toEqual([true, [false]]);
    db.prepare('UPDATE group_members SET ingame_name = NULL WHERE group_id = ? AND user_id = 1').run(groupA);
  });

  it('groups player messages into conversations per partner', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const pm = (id: number, from: string, to: string, date: string, body: string, thread: string, partner = 4711) =>
      `<div class="message-group" id="group_${thread}_1"><div id="message_${id}" class="message-item">
       <div class="message-actions"><a href="#" onclick="return Dialog.PM([${partner}], Message.CreateAnswer('Re: x'), '', '${thread}');"></a></div>
       <div class="message-details"><div class="message-from">${from}</div><div class="message-subject">Re: x</div>
       <div class="message-date">${date}</div><div class="message-receiver">An:&nbsp; ${to};</div></div>
       <div class="message-content">${body}</div></div></div>`;
    db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 4711, 'Trudy')").run(groupA);
    const html = [
      // two game threads with Trudy; the admin was called "Oldname" before (same main planet)
      pm(31, 'Trudy [5:5:5]', 'Oldname [1:100:12]', '10. Okt 2026, 10:00:00', 'eins', 'u_31'),
      pm(32, 'Oldname [1:100:12]', 'Trudy [5:5:5]', '10. Okt 2026, 10:05:00', 'zwei', 'u_31'),
      pm(40, 'Admin [1:100:12]', 'Trudy [5:5:5]', '11. Okt 2026, 09:00:00', 'neuer Verlauf', 'u_40'),
      pm(50, 'Victor [6:6:6]', 'Admin [1:100:12]', '12. Okt 2026, 09:00:00', 'jemand anderes', 'u_50', 4712),
    ].join('');
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } });
    const res = (await app.inject({ method: 'GET', url: '/hub/api/u8/messages', headers })).json();
    const conv = (body: string) => res.messages.find((m: any) => m.body === body).conversation;
    expect(new Set(['eins', 'zwei', 'neuer Verlauf'].map(conv)).size).toBe(1);
    expect(conv('jemand anderes')).not.toBe(conv('eins'));
    const trudy = res.conversations.find((c: any) => c.id === conv('eins'));
    expect(trudy).toMatchObject({ count: 3 });
    // the admin is one person under both names (newest name), Trudy is known as a hub player
    expect(trudy.parties.map((p: any) => [p.name, p.self, p.player != null]).sort()).toEqual([['Admin', true, false], ['Trudy', false, true]]);
    expect(res.messages.filter((m: any) => m.conversation === trudy.id).map((m: any) => [m.body, m.out])).toEqual([
      ['neuer Verlauf', true], ['zwei', true], ['eins', false],
    ]);
  });

  it('lists phalanxes that reach a system', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const empire = { kind: 'empire', research: {}, planets: [
      { name: 'Mondi', coords: { g: 1, s: 200, p: 4 }, type: 'moon', values: { 41: 4, 42: 3 } },
    ] };
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, ?, ?)').run(groupA, 1893456000, JSON.stringify(empire));
    // level 3: (9 - 1) = 8 systems in both directions
    const near = (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1/208', headers })).json();
    expect(near.phalanx).toEqual([expect.objectContaining({ s: 200, p: 4, level: 3, range: 8, from: 192, to: 208, source: 'empire', own: true })]);
    const far = (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1/209', headers })).json();
    expect(far.phalanx).toEqual([]);
  });

  it('shows known research and moon phalanx levels on the player page', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const alpha = db.prepare('SELECT id FROM players WHERE group_id = ? AND ingame_id = 1234').get(groupA) as { id: number };
    const insert = db.prepare(
      `INSERT INTO spy_reports (group_id, user_id, g, s, p, planet_type, player_name, player_id, report_time, sections) VALUES (?, 1, 1, 234, 5, ?, 'Alpha', ?, ?, ?)`,
    );
    insert.run(groupA, 'planet', alpha.id, 1792500000, JSON.stringify({ 900: {}, 100: { 109: 12, 118: 7 } }));
    insert.run(groupA, 'moon', alpha.id, 1792510000, JSON.stringify({ 900: {}, 0: { 41: 3, 42: 4 } }));
    const res = (await app.inject({ method: 'GET', url: `/hub/api/u8/players/${alpha.id}`, headers })).json();
    expect(res.research).toEqual({ values: { 109: 12, 118: 7 }, time: 1792500000, source: 'spy' });
    expect(res.phalanx['1:234:5']).toEqual({ level: 4, time: 1792510000, source: 'spy' });
  });

  it('fills the alliance pages from spy reports for members without an empire page', async () => {
    const groupD = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'D' }, headers: admin })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupD) };
    const ally = Number(db.prepare("INSERT INTO alliances (group_id, name, tag) VALUES (?, 'Wir', 'WIR')").run(groupD).lastInsertRowid);
    const player = db.prepare('INSERT INTO players (group_id, name, alliance_id, first_seen, last_seen) VALUES (?, ?, ?, 0, 0)');
    // the admin plays "admin" (hub username), Bob is in the same in-game alliance but not in the hub
    const own = Number(player.run(groupD, 'admin', ally).lastInsertRowid);
    const bob = Number(player.run(groupD, 'Bob', ally).lastInsertRowid);
    const carl = Number(player.run(groupD, 'Carl', null).lastInsertRowid);
    db.prepare('INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 2, 10, 4, ?, ?)').run(groupD, 'Taken', carl);
    const spy = db.prepare(
      'INSERT INTO spy_reports (group_id, user_id, g, s, p, planet_type, planet_name, player_name, player_id, report_time, sections) VALUES (?, 1, 2, 10, ?, ?, ?, ?, ?, ?, ?)',
    );
    spy.run(groupD, 3, 'planet', 'Bobs Welt', 'Bob', bob, 1000, JSON.stringify({ 900: {}, 200: { 202: 5 }, 400: { 401: 10 }, 0: { 1: 20 }, 100: { 106: 8 } }));
    // newer report with fleets only: the buildings stay from the older one
    spy.run(groupD, 3, 'planet', 'Bobs Welt', 'Bob', bob, 2000, JSON.stringify({ 900: {}, 200: { 202: 7 } }));
    spy.run(groupD, 3, 'moon', 'Mond', 'Bob', bob, 1500, JSON.stringify({ 900: {}, 0: { 41: 2 } }));
    // only resources: no row; an old report of a planet now owned by Carl: left out
    spy.run(groupD, 5, 'planet', 'Leer', 'Bob', bob, 1800, JSON.stringify({ 900: { 901: 1 } }));
    spy.run(groupD, 4, 'planet', 'Taken', 'Bob', bob, 900, JSON.stringify({ 900: {}, 0: { 1: 3 } }));

    let al = (await app.inject({ method: 'GET', url: '/hub/api/u8/alliance', headers })).json();
    expect(al.find((m: any) => m.player_id === own)).toMatchObject({ source: null, data: null });
    const b = al.find((m: any) => m.player_id === bob);
    expect(b).toMatchObject({ key: `p${bob}`, user_id: null, username: 'Bob', source: 'spy', created_at: 2000, fleets: null });
    expect(b.data.research).toEqual({ 106: 8 });
    expect(b.data.planets).toEqual([
      { name: 'Bobs Welt', coords: { g: 2, s: 10, p: 3 }, type: 'planet', values: { 202: 7, 401: 10, 1: 20 }, time: 2000 },
      { name: 'Mond', coords: { g: 2, s: 10, p: 3 }, type: 'moon', values: { 41: 2 }, time: 1500 },
    ]);

    // the own player is spied as well: the member gets the spy data until they sync their empire page
    spy.run(groupD, 8, 'planet', 'Heim', 'admin', own, 1700, JSON.stringify({ 900: {}, 0: { 1: 9 } }));
    al = (await app.inject({ method: 'GET', url: '/hub/api/u8/alliance', headers })).json();
    expect(al.find((m: any) => m.player_id === own)).toMatchObject({ source: 'spy', created_at: 1700 });
    expect(al.filter((m: any) => m.player_id === own)).toHaveLength(1);
  });

  it('keeps the planets after the end of a cut-off galaxy text copy', async () => {
    const groupT = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'Cut' }, headers: admin })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupT) };
    const ingest = (text: string) => app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text, system: '1:3' } });
    const full = fixture('galaxy.txt');
    expect((await ingest(full)).statusCode).toBe(200);
    expect((await ingest(full.slice(0, full.indexOf('Hauptplanet') - 1))).statusCode).toBe(200);
    const positions = db.prepare('SELECT p FROM planets WHERE group_id = ? AND g = 1 AND s = 3 ORDER BY p').pluck().all(groupT);
    expect(positions).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13]);
    expect(db.prepare("SELECT COUNT(*) FROM activity_log WHERE group_id = ? AND kind = 'planet_destroyed'").pluck().get(groupT)).toBe(0);
  });

  it('writes the activity log while syncing', async () => {
    const groupC = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'C' }, headers: admin })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupC) };
    const ingest = async (payload: object) => {
      const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload });
      expect(res.statusCode).toBe(200);
    };

    // galaxy: system known without the planet, then with planet + moon
    const galaxy = fixture('galaxy.html');
    await ingest({ html: galaxy.replace(/<div class="galaxy-grid-row even" data-info="p_5">[\s\S]*?(?=<div class="galaxy-grid-row empty odd" data-info="p_7">)/, '') });
    await ingest({ html: galaxy });

    // total points: same for 6 h (no growth), then a loss
    const stats = (time: string, points: string) =>
      fixture('stats-player.html')
        .replace('12:00:03', time)
        .replace('1.234.567', points)
        .replace('<option value="1">Punkte</option><option value="2" selected="selected">Flotte</option>', '<option value="1" selected="selected">Punkte</option><option value="2">Flotte</option>');
    await ingest({ html: stats('00:00:03', '1.000.000') });
    await ingest({ html: stats('06:00:03', '1.000.000') });
    await ingest({ html: stats('12:00:03', '900.000') });

    // phalanx: first seen with level 2, later level 4
    const spyMoon = (time: string, level: number) =>
      `<div id="message_9${level}" class="message-item"><div class="message-date">21. Okt 2026, ${time}</div><div class="message-content"><div class="spyRaport">` +
      `<div class="spyRaportHead"><a>Spionagebericht vom Mond Mondi (Alpha) [1:234:5] am 21. Okt 2026, ${time}</a></div>` +
      `<div class="spyRaportContainer"><div class="spyRaportContainerHead spyRaportContainerHeadClass0">Gebäude</div>` +
      `<div class="spyRaportContainerRow"><div class="spyRaportContainerCell">Sensorphalanx</div><div class="spyRaportContainerCell" data-info="0_42">${level}</div></div></div>` +
      `</div></div></div>`;
    await ingest({ html: spyMoon('08:00:00', 2) });
    await ingest({ html: spyMoon('09:00:00', 4) });

    // debris: grown, then reduced, then gone
    await ingest({ html: galaxy.replace('1.2K', '2.5K') });
    await ingest({ html: galaxy.replace('1.2K', '900') });
    const clearedDebris = galaxy.replace('1.2K / 300', '');
    await ingest({ html: clearedDebris });

    const noMoon = clearedDebris.replace(/<div class="galaxy-grid-item galaxy-moon centered">[\s\S]*?<\/div>/, '<div class="galaxy-grid-item galaxy-moon centered"></div>');
    await ingest({ html: noMoon });

    const noPlanet = noMoon.replace(/<div class="galaxy-grid-row even" data-info="p_5">[\s\S]*?<\/div>\s*/, '');
    await ingest({ html: noPlanet });

    const log = (await app.inject({ method: 'GET', url: `/hub/api/u8/activity?${EVER}`, headers })).json();
    const kinds = log.entries.map((e: any) => [e.kind, e.player_name, e.data.hours ?? e.data.level ?? e.data.delta ?? null]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['planet_new', 'Alpha', null],
        ['moon_new', 'Alpha', null],
        ['moon_destroyed', 'Alpha', null],
        ['planet_destroyed', 'Alpha', null],
        ['no_growth', 'Alpha', 6],
        ['no_growth', 'Alpha', 12],
        ['points_loss', 'Alpha', -100000],
        ['phalanx_new', 'Alpha', 2],
        ['phalanx_up', 'Alpha', 4],
      ]),
    );
    const debris = log.entries.filter((e: any) => e.kind.startsWith('debris_')).map((e: any) => [e.kind, e.data.metal ?? null]).reverse();
    expect(debris).toEqual([
      ['debris_new', 1200],
      ['debris_grown', 2500],
      ['debris_shrunk', 900],
      ['debris_cleared', null],
    ]);
    expect(log.counts.no_growth).toBe(2);
    // filter by kind
    const only = (await app.inject({ method: 'GET', url: `/hub/api/u8/activity?kinds=phalanx_new,phalanx_up&${EVER}`, headers })).json();
    expect(only.entries.map((e: any) => e.kind).sort()).toEqual(['phalanx_new', 'phalanx_up']);

    // backfill recreates the stats/spy based entries (galaxy changes can't be replayed)
    db.prepare("DELETE FROM activity_log WHERE group_id = ? AND kind NOT IN ('planet_new', 'moon_new', 'debris_new')").run(groupC);
    const res = await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupC}/activity/backfill`, headers: admin, payload: {} });
    expect(res.json().added).toBe(5);
    const again = await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupC}/activity/backfill`, headers: admin, payload: {} });
    expect(again.json().added).toBe(0);
  });

  it('archives battle hall reports and pages through them', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    let res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture('battlehall.html') } });
    expect(res.json().counts.battle_hall).toEqual({ new: 4, duplicate: 0 });
    res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture('battlehall.html') } });
    expect(res.json().counts.battle_hall).toEqual({ new: 0, duplicate: 4 });
    const hall = (await app.inject({ method: 'GET', url: '/hub/api/u8/battle-hall', headers })).json();
    expect(hall).toMatchObject({ total: 4, pages: 1 });
    expect(hall.entries.map((e: any) => e.units)).toEqual([1075302000, 276316000, 260583000, 25541000]);
    const anda = (await app.inject({ method: 'GET', url: '/hub/api/u8/battle-hall?q=Anda&sort=time', headers })).json();
    expect(anda.entries.map((e: any) => e.report_id.slice(0, 4))).toEqual(['778f', '4a2c']);
    db.prepare('INSERT INTO players (group_id, name, ingame_id) VALUES (?, ?, NULL)').run(groupA, 'Anda');
    const andaId = db.prepare('SELECT id FROM players WHERE group_id = ? AND name = ?').pluck().get(groupA, 'Anda') as number;
    db.prepare('INSERT OR REPLACE INTO player_aliases (player_id, name, seen_until) VALUES (?, ?, 1)').run(andaId, 'AndaFormer');
    const byAlias = (await app.inject({ method: 'GET', url: '/hub/api/u8/battle-hall?q=AndaFormer&sort=time', headers })).json();
    expect(byAlias.entries.map((e: any) => e.report_id.slice(0, 4))).toEqual(['778f', '4a2c']);
    // a later battle hall sync after deleted accounts must not replace stored participant names
    const redacted = fixture('battlehall.html')
      .replace('pUsteblUme', '')
      .replace('Arys', '')
      .replace('<span class="colorNegative"></span>', '<span class="colorNegative">-</span>');
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: redacted } });
    const puste = (await app.inject({ method: 'GET', url: '/hub/api/u8/battle-hall?q=pUsteblUme', headers })).json();
    expect(puste.entries[0]?.attackers).toEqual(['pUsteblUme']);
    expect(puste.entries[0]?.defenders).toEqual(['Arys']);
  });

  it('archives battle reports with the background worker', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const { step, crawlerState } = await import('../src/crawler.js');
    const log = { info: () => {}, warn: () => {} };
    await app.inject({ method: 'PUT', url: '/hub/api/admin/universes/u8', headers: admin, payload: { settings: { gameUrl: 'https://pr0game.com/uni8/' } } });
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return { ok: true, text: async () => (url.includes('93a44dd0') ? fixture('raport-public.html') : 'Invalid Battle Report ID') };
    }) as unknown as typeof fetch;
    // newest hall entry first (20 Oct), then the others are already deleted in the game
    // game unreachable / maintenance page: pause without spending the report's tries
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const maintenance = (async () => ({ ok: true, text: async () => '<title>Wartung</title>' })) as unknown as typeof fetch;
    expect(await step(db, log, down)).toBe('transient');
    // the universe is paused now and skipped; other universes would keep going
    expect(crawlerState.get(1)).toMatchObject({ failures: 1, lastError: 'ECONNREFUSED', stopped: false });
    expect(await step(db, log, fetcher)).toBe('idle');
    crawlerState.clear();
    expect(await step(db, log, maintenance)).toBe('transient');
    expect(crawlerState.get(1)?.lastError).toBe('no report page (maintenance?)');
    crawlerState.clear();
    // attacker shot down in the first round: no report in the game, final instead of pausing
    const lostContact = (async () => ({
      ok: true,
      text: async () => '<title>Info - Universum 8</title> Contact with the attacking fleet was lost (i.e. it was shot down in the first round).',
    })) as unknown as typeof fetch;
    expect(await step(db, log, lostContact)).toBe('done');
    expect(crawlerState.size).toBe(0);
    const lost = db.prepare("SELECT report_id FROM battle_hall WHERE group_id = ? AND report_status = 'lost'").pluck().all(groupA) as string[];
    expect(lost).toHaveLength(1);
    db.prepare('UPDATE battle_hall SET report_status = NULL, report_tries = 0 WHERE group_id = ?').run(groupA);
    expect(db.prepare("SELECT MAX(report_tries) FROM battle_hall WHERE group_id = ?").pluck().get(groupA)).toBe(0);
    // the same report in the hall of another alliance of the universe is fetched once
    db.prepare(
      `INSERT INTO battle_hall (group_id, report_id, time, attackers, defenders, winner, units)
       SELECT ?, report_id, time, attackers, defenders, winner, units FROM battle_hall WHERE group_id = ? AND report_id LIKE '93a4%'`,
    ).run(groupB, groupA);

    expect(await step(db, log, fetcher)).toBe('done');
    expect(urls[0]).toBe('https://pr0game.com/uni8/game.php?page=raport&raport=93a44dd012ff05992739d1afd749df1d');
    for (let i = 0; i < 3; i++) await step(db, log, fetcher);
    expect(await step(db, log, fetcher)).toBe('idle');
    expect(urls.filter((u) => u.includes('93a44dd0'))).toHaveLength(1);
    expect(db.prepare('SELECT group_id FROM combat_reports ORDER BY group_id').pluck().all()).toEqual([groupA, groupB]);

    const report = (await app.inject({ method: 'GET', url: '/hub/api/u8/combat-reports/93a44dd012ff05992739d1afd749df1d', headers })).json();
    expect(report).toMatchObject({ winner: 'attacker', lost_attacker: 3280000, debris_metal: 3560500, units: 25541000 });
    expect(report.fleets[0]).toMatchObject({ side: 'attacker', name: 'pUsteblUme' });
    expect(report.fleets[0].ships).toContainEqual({ id: 207, before: 6445, after: 6402 });
    const hall = (await app.inject({ method: 'GET', url: '/hub/api/u8/battle-hall', headers })).json();
    expect(hall.entries.map((e: any) => [e.report_id.slice(0, 4), e.archived, e.report_status])).toEqual([
      ['1528', 0, 'gone'], ['4a2c', 0, 'gone'], ['778f', 0, 'gone'], ['93a4', 1, 'archived'],
    ]);
    // later tests paste pages of other universes (U7, test server) into u8
    await app.inject({ method: 'PUT', url: '/hub/api/admin/universes/u8', headers: admin, payload: { settings: { gameUrl: '' } } });
  });

  it('keeps groups isolated', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupB) };
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    expect(ov.players).toEqual([]);
    const spy = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy/1/234/5', headers })).json();
    expect(spy.total).toBe(0);
  });

  it('invites a member who only sees their group', async () => {
    const inv = (
      await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupB}/members`, headers: admin, payload: { name: 'Bob' } })
    ).json();
    const res = await app.inject({ method: 'POST', url: `/hub/api/invites/${inv.token}/accept`, payload: { username: 'bob', password: 'bobpass12' } });
    expect(res.statusCode).toBe(200);
    const bob = await login('bob', 'bobpass12');
    const forbidden = await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers: { ...bob, 'x-hub-group': String(groupA) } });
    expect(forbidden.statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/hub/api/u8/context', headers: bob });
    expect(ok.json().group.id).toBe(groupB);
    // Invite is single use.
    const again = await app.inject({ method: 'POST', url: `/hub/api/invites/${inv.token}/accept`, payload: { username: 'eve', password: 'evepass12' } });
    expect(again.statusCode).toBe(404);
  });

  it('adds placeholder members and claim invites', async () => {
    const ga = `/hub/api/admin/groups/${groupA}`;
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const add = await app.inject({ method: 'POST', url: `${ga}/members`, headers: admin, payload: { name: 'Phantom Pilot' } });
    expect(add.statusCode).toBe(200);
    const phId = add.json().id;
    let members = (await app.inject({ method: 'GET', url: `${ga}/members`, headers: admin })).json();
    const ph = members.find((m: { id: number }) => m.id === phId);
    expect(ph).toMatchObject({ account: false, ingame_name: 'Phantom Pilot' });
    const alliance = (await app.inject({ method: 'GET', url: '/hub/api/u8/alliance', headers })).json();
    expect(alliance.some((m: { user_id: number }) => m.user_id === phId)).toBe(true);
    const badLogin = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: ph.username, password: 'anypass12' } });
    expect(badLogin.statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `${ga}/members`, headers: admin, payload: { name: 'Phantom Pilot' } })).json().code).toBe('member_exists');
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('member1', hashPassword('member1pass'));
    const member1Id = db.prepare("SELECT id FROM users WHERE username = 'member1'").pluck().get();
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(groupA, member1Id);
    const member1 = await login('member1', 'member1pass');
    expect((await app.inject({ method: 'POST', url: `${ga}/members`, headers: member1, payload: { name: 'Other' } })).json().code).toBe('group_admin_only');

    expect(add.json().token).toBeTruthy();
    expect(ph.invite).toBe(add.json().token);
    const accept = await app.inject({
      method: 'POST',
      url: `/hub/api/invites/${add.json().token}/accept`,
      payload: { username: 'phantom', password: 'phantompass' },
    });
    expect(accept.statusCode).toBe(200);
    expect(db.prepare('SELECT id FROM users WHERE username = ?').pluck().get('phantom')).toBe(phId);
    const phantom = await login('phantom', 'phantompass');
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/context', headers: phantom })).json().group.id).toBe(groupA);

    const ph2 = (await app.inject({ method: 'POST', url: `${ga}/members`, headers: admin, payload: { name: 'Merge Me' } })).json().id;
    db.prepare('INSERT INTO target_claims (group_id, user_id, g, s, p, planet_type, kind, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      groupA,
      ph2,
      1,
      1,
      1,
      'planet',
      'farm',
      Math.floor(Date.now() / 1000) + 3600,
    );
    const planId = (
      await app.inject({
        method: 'POST',
        url: '/hub/api/u8/plans',
        headers,
        payload: { g: 1, s: 41, p: 1, type: 'moon', target_time: Math.floor(Date.now() / 1000) + 86400 },
      })
    ).json().id;
    await app.inject({ method: 'POST', url: `/hub/api/u8/plans/${planId}/fleets`, headers, payload: { user_id: ph2 } });
    const mergeInv = (await app.inject({ method: 'POST', url: `${ga}/members/${ph2}/invite`, headers: admin })).json().token;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/hub/api/invites/${mergeInv}/accept`,
          headers: phantom,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(db.prepare('SELECT 1 FROM users WHERE id = ?').get(ph2)).toBeUndefined();
    expect(db.prepare('SELECT user_id FROM target_claims WHERE group_id = ? AND g = 1 AND s = 1 AND p = 1').pluck().get(groupA)).toBe(phId);
    const fleets = (await app.inject({ method: 'GET', url: '/hub/api/u8/plans', headers: phantom })).json().find((p: { id: number }) => p.id === planId).fleets;
    expect(fleets.some((f: { user_id: number }) => f.user_id === phId)).toBe(true);

    const ph3 = (await app.inject({ method: 'POST', url: `${ga}/members`, headers: admin, payload: { name: 'Gone' } })).json().id;
    expect((await app.inject({ method: 'DELETE', url: `${ga}/members/${ph3}`, headers: admin })).statusCode).toBe(200);
    expect(db.prepare('SELECT 1 FROM users WHERE id = ?').get(ph3)).toBeUndefined();
  });

  it('password recovery invite for members with an account', async () => {
    const ga = `/hub/api/admin/groups/${groupA}`;
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('forgotten', hashPassword('oldpass12'));
    const uid = db.prepare("SELECT id FROM users WHERE username = 'forgotten'").pluck().get() as number;
    db.prepare("INSERT INTO group_members (group_id, user_id, role, ingame_name) VALUES (?, ?, 'member', 'Forgotten')").run(groupA, uid);
    const before = await login('forgotten', 'oldpass12');
    await app.inject({ method: 'POST', url: '/hub/api/auth/tokens', headers: before, payload: { name: 'script' } });
    // alliance admins can't create recovery links (they could take over any member's account) nor see them
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run('allyadmin', hashPassword('allyadmin12'));
    const allyAdminId = db.prepare("SELECT id FROM users WHERE username = 'allyadmin'").pluck().get() as number;
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(groupA, allyAdminId);
    const allyAdmin = await login('allyadmin', 'allyadmin12');
    const denied = await app.inject({ method: 'POST', url: `${ga}/members/${uid}/invite`, headers: allyAdmin });
    expect(denied.json().code).toBe('admin_only');
    const ownerId = db.prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get() as number;
    expect((await app.inject({ method: 'POST', url: `${ga}/members/${ownerId}/invite`, headers: allyAdmin })).statusCode).toBe(403);
    const token = (await app.inject({ method: 'POST', url: `${ga}/members/${uid}/invite`, headers: admin })).json().token;
    const seen = (await app.inject({ method: 'GET', url: `${ga}/members`, headers: allyAdmin })).json();
    expect(seen.find((m: { id: number }) => m.id === uid).invite).toBeNull();
    const seenByAdmin = (await app.inject({ method: 'GET', url: `${ga}/members`, headers: admin })).json();
    expect(seenByAdmin.find((m: { id: number }) => m.id === uid).invite).toBe(token);
    const info = (await app.inject({ method: 'GET', url: `/hub/api/invites/${token}` })).json();
    expect(info.recovery).toBe(true);
    expect(info.username).toBe('forgotten');
    const wrong = await app.inject({
      method: 'POST',
      url: `/hub/api/invites/${token}/accept`,
      headers: admin,
      payload: { password: 'newpass12' },
    });
    expect(wrong.statusCode).toBe(403);
    const accept = await app.inject({ method: 'POST', url: `/hub/api/invites/${token}/accept`, payload: { password: 'newpass12' } });
    expect(accept.statusCode).toBe(200);
    // sessions and API tokens from before the recovery are gone
    expect((await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: before })).json().user).toBeNull();
    expect(db.prepare('SELECT COUNT(*) FROM api_tokens WHERE user_id = ?').pluck().get(uid)).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'forgotten', password: 'oldpass12' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'forgotten', password: 'newpass12' } })).statusCode).toBe(200);
  });

  it('refuses writes from another origin', async () => {
    const payload = { lang: 'de' };
    const url = '/hub/api/auth/lang';
    const foreign = await app.inject({ method: 'POST', url, payload, headers: { ...admin, host: 'hub.example.org', origin: 'https://evil.example.org' } });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().code).toBe('cross_origin');
    expect((await app.inject({ method: 'POST', url, payload, headers: { ...admin, host: 'hub.example.org', origin: 'null' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url, payload, headers: { ...admin, host: 'hub.example.org', origin: 'https://hub.example.org' } })).statusCode).toBe(200);
    // reads and clients without Origin (scripts) are unaffected
    expect((await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: { ...admin, host: 'hub.example.org', origin: 'https://evil.example.org' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url, payload, headers: admin })).statusCode).toBe(200);
  });

  it('counts failed logins per client IP behind one proxy, not per forged X-Forwarded-For', async () => {
    const attempt = (n: number) =>
      app.inject({
        method: 'POST',
        url: '/hub/api/auth/login',
        remoteAddress: '10.0.0.2',
        headers: { 'x-forwarded-for': `198.51.100.${n}, 203.0.113.7` },
        payload: { username: `nobody${n}`, password: 'wrongpass' },
      });
    const codes: number[] = [];
    for (let n = 0; n < 31; n++) codes.push((await attempt(n)).statusCode);
    expect(codes.slice(0, 30).every((c) => c === 401)).toBe(true);
    expect(codes[30]).toBe(429);
  });

  it('ingests a galaxy view and needs a session', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/hub/api/u8/ingest',
      headers: { ...admin, 'x-hub-group': String(groupA) },
      payload: { html: fixture('galaxy.html') },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pageType).toBe('galaxy');
    const views = (await app.inject({ method: 'GET', url: '/hub/api/u8/galaxy-views', headers: { ...admin, 'x-hub-group': String(groupA) } })).json();
    expect(views).toHaveLength(2); // 1:234 again (newer than the universe.json) and 1:235 from the universe.json
    expect((await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', payload: { html: '<p>x</p>' } })).statusCode).toBe(401);
  });
});

describe('review fixes', () => {
  it('rate limits failed logins', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'nobody', password: 'x' } })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('rate limits failed logins per IP across usernames', async () => {
    const attempt = async (username: string) =>
      (await app.inject({ method: 'POST', url: '/hub/api/auth/login', remoteAddress: '10.0.0.9', payload: { username, password: 'x' } })).statusCode;
    for (let i = 0; i < 30; i++) expect(await attempt(`user${i}`)).toBe(401);
    expect(await attempt('another')).toBe(429);
  });

  it('ingests English stats (date without dot, huge points)', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'English' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('stats-en-testserver.html') } });
    expect(res.json().warnings).toEqual([]);
    expect(res.json().counts.player_scores).toEqual({ new: 4, duplicate: 0 });
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    expect(ov.players.find((p: any) => p.name === 'Gottkaiser')).toMatchObject({ ingame_id: 214 });
    expect(ov.players.find((p: any) => p.name === 'reflex').scores['1'].points).toBeGreaterThan(1.8e18);
    // statistics page: latest snapshot of the category in game order
    const stats = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=player&type=1', headers })).json();
    expect(stats.rows.map((r: any) => [r.rank, r.name])).toEqual([[1, 'reflex'], [2, 'Gottkaiser'], [11, 'Virus'], [88, 'test123']]);
    expect(stats.rows[1]).toMatchObject({ ally_name: 'F1337erB0yz', points: 449037461141982, status: [] });
    expect(stats.categories).toEqual([{ who: 'player', type: 1, stat_time: stats.statTime, pages: [0] }]);
    const empty = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=alliance&type=2', headers })).json();
    expect(empty).toMatchObject({ statTime: null, rows: [] });
  });

  it('serves the statistics page: honor points, alliances, changes and own reference', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Stats' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const ingest = async (html: string) => (await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } })).json();
    // the admin plays "Gottkaiser" in this alliance
    await app.inject({ method: 'PUT', url: `/hub/api/admin/groups/${groupX}/members/1`, headers: admin, payload: { ingameName: 'Gottkaiser' } });

    expect((await ingest(fixture('stats-honor.html'))).warnings).toEqual([]);
    const honor = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=player&type=6', headers })).json();
    expect(honor.rows.map((r: any) => [r.rank, r.rank_change, r.name, r.title, r.points])).toEqual([
      [1, 2, 'Gottkaiser', 'Gott-Imperator', 12345],
      [2, 0, 'Virus', null, 0],
      [3, -3, 'reflex', 'Banditen-Imperator', -4200],
    ]);
    expect(honor.rows[0]).toMatchObject({ own: true, ownAlly: true, member: 1 });

    // total points twice: change against the previous stand, all categories per player
    const en = fixture('stats-en-testserver.html');
    await ingest(en.replace('22:55:25', '16:55:25').replace('449.037.461.141.982', '449.037.461.000.000'));
    await ingest(en);
    const total = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=player&type=1', headers })).json();
    const gk = total.rows.find((r: any) => r.name === 'Gottkaiser');
    expect(gk).toMatchObject({ delta: 141982, prev_rank: 2, scores: { 1: 449037461141982 } });
    expect(total.me).toMatchObject({ points: { 1: 449037461141982 } });
    expect(total.prevTime).toBeLessThan(total.statTime);
    expect(total.categories.find((c: any) => c.type === 1)).toMatchObject({ who: 'player', pages: [0] });

    expect((await ingest(fixture('stats-alliance.html'))).warnings).toEqual([]);
    const allys = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=alliance&type=1', headers })).json();
    expect(allys.rows.map((r: any) => [r.rank, r.name, r.members, r.points, r.own])).toEqual([
      [1, 'F1337erB0yz', 12, 1234567, true],
      [2, 'Sinnlos im Weltraum', 3, 45000, false],
    ]);
  });

  it('puts the Δ columns on the 6 h statistics grid, a missed update leaves its column empty', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Grid' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const en = fixture('stats-en-testserver.html');
    // updates at 22:55 (newest), 10:55 and 04:55; the one at 16:55 was not synced
    const at = (time: string, points: string) => en.replace('22:55:25', time).replace('267.637.157', points);
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: at('04:55:25', '266.000.000') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: at('10:55:25', '267.000.000') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: en } });
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    const virus = ov.players.find((p: any) => p.name === 'Virus');
    const [s0, s1, s2, s3] = virus.scores[1].slots;
    expect(s0).toMatchObject({ delta: 637157, ...ov.slots[0] });
    expect(s0.to - s0.from).toBe(12 * 3600);
    expect(s1).toBeNull();
    expect(s2).toMatchObject({ delta: 1000000 });
    expect(s2.to - s2.from).toBe(6 * 3600);
    expect(s3).toBeNull();
    expect(ov.slots[1]).toBeNull();
  });

  it('finds Δ references older than the loaded week of statistics', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Week' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const html = fixture('stats-player.html');
    const at = (time: string, points: string) => html.replace('21. Okt 2026, 12:00:03', time).replace('1.234.567', points);
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: at('12. Okt 2026, 12:00:03', '1.000.000') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: at('21. Okt 2026, 06:00:03', '1.200.000') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } });
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    const { deltas } = ov.players.find((p: any) => p.name === 'Alpha').scores[2];
    expect(deltas['6h']).toMatchObject({ delta: 34567, partial: false });
    expect(deltas['48h']).toMatchObject({ delta: 234567, partial: false });
    expect(deltas['7d']).toMatchObject({ delta: 234567, partial: false });
  });

  it('lists known players in the overview even without synced statistics', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'No stats' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('galaxy.html') } });
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    expect(ov.players.length).toBeGreaterThan(0);
    expect(ov.players.every((p: any) => Object.keys(p.scores).length === 0)).toBe(true);
    expect(ov.planets.length).toBeGreaterThan(0);
  });

  it('maps statistics updates onto the 6 h grid', () => {
    const h = 3600;
    const t0 = 1_800_000_000;
    // consecutive updates
    expect(statSlots([t0, t0 - 6 * h, t0 - 12 * h]).map((s) => s && (s.to - s.from) / h)).toEqual([6, 6, null, null]);
    // more frequent updates (test server): the one closest to each grid point counts
    expect(statSlots([t0, t0 - h, t0 - 5 * h, t0 - 6 * h - 60])[0]).toEqual({ from: t0 - 6 * h - 60, to: t0 });
    // off the grid (test server): 14.5 h back belongs to the 12 h point, the change goes into the first column
    expect(statSlots([t0, t0 - 14.5 * h])).toEqual([{ from: t0 - 14.5 * h, to: t0 }, null, null, null]);
    // off the grid within the same section (synced 21:20 and 00:00): the older one is the start
    expect(statSlots([t0, t0 - 2 * h - 40 * 60])).toEqual([{ from: t0 - 2 * h - 40 * 60, to: t0 }, null, null, null]);
    // gap of more than the four columns: nothing to show
    expect(statSlots([t0, t0 - 30 * h])).toEqual([null, null, null, null]);
  });

  it('computes the Δ values of a player from the score history', () => {
    const h = 3600;
    const t0 = 1_800_000_000;
    const row = (points: number, back: number) => ({ points, rank: 1, rank_change: null, stat_time: t0 - back * h });
    const history = [row(130, 0), row(120, 6), row(100, 12)];
    const e = scoreEntry(history, statSlots(history.map((r) => r.stat_time)));
    expect(e).toMatchObject({ points: 130, time: t0 });
    expect(e.deltas['6h']).toEqual({ delta: 10, since: t0 - 6 * h, partial: false });
    expect(e.deltas['12h']).toEqual({ delta: 30, since: t0 - 12 * h, partial: false });
    // not enough history: compared with the oldest score
    expect(e.deltas['24h']).toEqual({ delta: 30, since: t0 - 12 * h, partial: true });
    expect(e.slots.map((s) => s?.delta ?? null)).toEqual([10, 20, null, null]);
  });

  it('counts manually added expedition events in the deck', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Deck' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const add = (payload: object) => app.inject({ method: 'POST', url: '/hub/api/u8/deck/events', headers, payload });
    const deck = async () => (await app.inject({ method: 'GET', url: '/hub/api/u8/deck', headers })).json();

    const first = await add({ event: 'Res', size: 'Small' });
    expect(first.statusCode).toBe(200);
    expect((await add({ event: 'Nothing', size: 'None', depletion: 'few' })).statusCode).toBe(200);
    expect((await add({ event: 'Res', size: 'Huge' })).statusCode).toBe(400);
    expect((await add({ event: 'Res', size: 'Small', depletion: 'few' })).statusCode).toBe(400);

    let d = await deck();
    expect(d.state.events).toBe(2);
    expect(d.state.cards.find((c: any) => c.key.includes('Res') && c.key.includes('Small')).remaining).toBe(328);
    expect(d.lastEvents[0]).toMatchObject({ event: 'Nothing', depletion: 'few', manual: 1 });

    // only manual entries of the own deck can be removed
    const synced = db.prepare("INSERT INTO expeditions (group_id, user_id, dedupe_key, time, event, size) VALUES (?, 1, 'm1', 1, 'Res', 'Small')").run(groupX).lastInsertRowid;
    expect((await app.inject({ method: 'DELETE', url: `/hub/api/u8/deck/events/${synced}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/hub/api/u8/deck/events/${first.json().id}`, headers })).statusCode).toBe(200);
    d = await deck();
    expect(d.state.events).toBe(2); // the synced one + the manual "Nothing"
  });

  it('keeps moon names and diameters from the galaxy view', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Moons' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('galaxy.html') } });
    const moonOf = async () => (await app.inject({ method: 'GET', url: '/hub/api/u8/browse/1/234', headers })).json().rows.find((r: any) => r.p === 5);
    expect(await moonOf()).toMatchObject({ has_moon: 1, moon_name: 'Luna Prime', moon_diameter: 4560 });
    // a newer universe.json (no moon names) keeps the known name
    const newer = fixture('universe.json').replaceAll('"timepoint": 1792569600000', '"timepoint": 4102444800000');
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: newer } });
    expect(await moonOf()).toMatchObject({ has_moon: 1, moon_name: 'Luna Prime', moon_diameter: 4560 });
    const alpha = db.prepare('SELECT id FROM players WHERE group_id = ? AND ingame_id = 1234').pluck().get(groupX);
    const detail = (await app.inject({ method: 'GET', url: `/hub/api/u8/players/${alpha}`, headers })).json();
    expect(detail.planets.find((p: any) => p.p === 5)).toMatchObject({ moon_name: 'Luna Prime', moon_diameter: 4560 });
  });

  it('exports universe.json in pr0game format', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Export' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: fixture('universe.json') } });
    const res = await app.inject({ method: 'GET', url: `/hub/api/u8/universe-json?group=${groupX}`, headers: admin });
    expect(res.headers['content-disposition']).toContain('universe.json');
    const [universe, players, allies] = res.json();
    const original = JSON.parse(fixture('universe.json'))[0];
    expect(Object.keys(universe)).toEqual(['1:234', '1:235']);
    expect(Object.keys(universe['1:234'])).toEqual([...Array.from({ length: 15 }, (_, i) => String(i + 1)), 'timepoint']);
    expect(universe['1:234'].timepoint).toBe(original['1:234'].timepoint);
    expect(universe['1:234']['5']).toEqual(original['1:234']['5']);
    expect(universe['1:234']['7']).toMatchObject({ playerid: 55, name: 'Beta Max', allianceid: -1, alliancename: '-', special: 'uIi' });
    expect(universe['1:234']['6']).toBeNull();
    expect(universe['1:235']['3']).toMatchObject({ playerid: 99, name: '-', allianceid: 88, special: 'un' });
    expect(players['1234']).toEqual({ name: 'Alpha', timepoint: 1792569600000 });
    expect(allies['-1'].name).toBe('-');
    // Round trip: importing the export into another group gives the same file.
    const groupD = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Export-Import' } })).json().id;
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers: { ...admin, 'x-hub-group': String(groupD) }, payload: { text: res.body } });
    expect((await app.inject({ method: 'GET', url: `/hub/api/u8/universe-json?group=${groupD}`, headers: admin })).body).toBe(res.body);
  });

  it('renames users', async () => {
    const carol = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
    const c = await login('carol', 'carolpass');
    const rename = (payload: object) => app.inject({ method: 'POST', url: '/hub/api/auth/username', headers: c, payload });
    expect((await rename({ username: 'caroline', password: 'wrong' })).statusCode).toBe(400);
    expect((await rename({ username: 'ADMIN', password: 'carolpass' })).statusCode).toBe(409);
    expect((await rename({ username: 'x', password: 'carolpass' })).statusCode).toBe(400);
    expect((await rename({ username: 'caroline', password: 'carolpass' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: c })).json().user.username).toBe('caroline');

    const byAdmin = (headers: object, username: string) =>
      app.inject({ method: 'PUT', url: `/hub/api/admin/users/${carol}`, headers, payload: { username } });
    expect((await byAdmin(c, 'carl')).statusCode).toBe(403);
    expect((await byAdmin(admin, 'carl')).statusCode).toBe(200);
    await login('carl', 'carolpass');
  });

  it('stores the UI language and date format per user', async () => {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', hashPassword('davepass1'));
    const d = await login('dave', 'davepass1');
    const me = async () => (await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: d })).json().user.lang;
    expect(await me()).toBe('de');
    const setLang = (lang: string) => app.inject({ method: 'POST', url: '/hub/api/auth/lang', headers: d, payload: { lang } });
    expect((await setLang('en')).statusCode).toBe(200);
    expect(await me()).toBe('en');
    const bad = await setLang('fr');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'Invalid language', code: 'lang_invalid' });
    expect(await me()).toBe('en');

    const format = async () => (await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers: d })).json().user.dateFormat;
    expect(await format()).toBe('auto');
    const setFormat = (dateFormat: string) => app.inject({ method: 'POST', url: '/hub/api/auth/date-format', headers: d, payload: { dateFormat } });
    expect((await setFormat('ymd')).statusCode).toBe(200);
    expect(await format()).toBe('ymd');
    expect((await setFormat('mdy')).json()).toEqual({ error: 'Invalid date format', code: 'date_format_invalid' });
    expect(await format()).toBe('ymd');
  });

  it('stores a message synced as HTML and as text once', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Dedupe' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const ingest = async () => (await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('messages.html') } })).json();
    await ingest();
    const tables = ['battle_reports', 'expeditions', 'hostile_spying', 'recycle_reports'];
    const rows = () => tables.map((t) => db.prepare(`SELECT COUNT(*) FROM ${t} WHERE group_id = ?`).pluck().get(groupX));
    const before = rows();
    // as if synced from text: no message/report id, content hash as key
    for (const t of tables) db.prepare(`UPDATE ${t} SET msg_id = NULL, dedupe_key = 'h' || id WHERE group_id = ?`).run(groupX);
    db.prepare("UPDATE battle_reports SET report_id = NULL, outcome = NULL WHERE group_id = ?").run(groupX);
    const res = await ingest();
    expect(res.counts).toMatchObject({
      battle_reports: { new: 0 }, expeditions: { new: 0 }, hostile_spying: { new: 0 }, recycle_reports: { new: 0 },
    });
    expect(rows()).toEqual(before);
    const battle = db.prepare('SELECT msg_id, report_id, outcome FROM battle_reports WHERE group_id = ?').get(groupX) as any;
    expect(battle.msg_id).not.toBeNull();
    expect(battle.report_id).not.toBeNull();
    expect(battle.outcome).not.toBeNull();

    // copies from text stored before (no message id): the migration removes them
    const copy = (key: string, msgId: number | null) =>
      db.prepare(
        `INSERT INTO expeditions (group_id, user_id, dedupe_key, msg_id, time, g, s, p, event, size, factor, depletion, found_resources, found_ships)
         SELECT group_id, user_id, ? || id, ?, time, g, s, p, event, size, factor, depletion, found_resources, found_ships FROM expeditions
         WHERE group_id = ? AND dedupe_key NOT LIKE 'copy%' AND dedupe_key NOT LIKE 'twin%'`,
      ).run(key, msgId, groupX);
    copy('copy', null);
    // an expedition with the same result but its own message id stays
    copy('twin', 999999);
    db.exec(readFileSync(new URL('../migrations/011_dedupe_html_text.sql', import.meta.url), 'utf8'));
    const keys = db.prepare('SELECT dedupe_key FROM expeditions WHERE group_id = ?').pluck().all(groupX) as string[];
    expect(keys.filter((k) => k.startsWith('copy'))).toEqual([]);
    expect(keys.filter((k) => k.startsWith('twin'))).toHaveLength(before[1] as number);
    expect(keys).toHaveLength(2 * (before[1] as number));
  });

  it('keeps pasted pages for a while, universe.json uploads not at all', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Raw' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    db.prepare("INSERT INTO raw_ingests (group_id, source, page_type, text_gz, created_at) VALUES (?, 'paste', 'stats', x'00', 1)").run(groupX);
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: fixture('universe.json') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('galaxy.html') } });
    const raw = db.prepare('SELECT page_type, html_gz IS NOT NULL AS html, text_gz IS NOT NULL AS text FROM raw_ingests WHERE group_id = ? ORDER BY id').all(groupX);
    expect(raw).toEqual([{ page_type: 'galaxy', html: 0, text: 0 }, { page_type: 'galaxy', html: 1, text: 0 }]);
  });

  it('keeps the newest overview page and the empire pages of the last week', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Snapshots' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const day = Math.floor(Date.now() / 1000) - 86400;
    for (const t of [1000, day]) {
      db.prepare("INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, ?, '{}')").run(groupX, t);
      db.prepare("INSERT INTO overview_snapshots (group_id, user_id, page_time, data) VALUES (?, 1, ?, '{}')").run(groupX, t);
    }
    for (const f of ['empire-real-source.html', 'overview.html']) {
      await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: fixture(f) } });
    }
    const empire = db.prepare('SELECT created_at FROM empire_snapshots WHERE group_id = ?').pluck().all(groupX) as number[];
    expect(empire).not.toContain(1000);
    expect(empire).toContain(day);
    const overview = db.prepare('SELECT page_time FROM overview_snapshots WHERE group_id = ?').pluck().all(groupX) as number[];
    expect(overview).toEqual([Math.max(day, Date.UTC(2026, 9, 21, 12, 0, 0) / 1000)]);
  });

  it('replaces placeholder names of players only known by id', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Placeholder' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers, payload: { text: fixture('universe.json').replaceAll('"Alpha"', '"-"') } });
    const alpha = () => db.prepare('SELECT id, name FROM players WHERE group_id = ? AND ingame_id = 1234').get(groupX) as any;
    expect(alpha().name).toBe('Spieler #1234');
    // statistics older than the universe.json still bring the real name
    const stats = fixture('stats-player.html').replace('21. Okt 2026, 12:00:03', '1. Okt 2026, 12:00:03');
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: stats } });
    expect(alpha().name).toBe('Alpha');
    expect(db.prepare('SELECT name FROM player_aliases WHERE player_id = ?').pluck().all(alpha().id)).toEqual([]);
    // the export leaves the placeholder out
    const json = (await app.inject({ method: 'GET', url: '/hub/api/u8/universe-json', headers })).body;
    expect(json).toContain('"Alpha"');

    // stored before: the migration restores the real name
    const id = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 77, 'Spieler #77')").run(groupX).lastInsertRowid);
    db.prepare("INSERT INTO player_aliases (player_id, name, seen_until) VALUES (?, 'Old', 1), (?, 'Real', 2)").run(id, id);
    const other = Number(db.prepare("INSERT INTO players (group_id, ingame_id, name) VALUES (?, 78, 'Real78')").run(groupX).lastInsertRowid);
    db.prepare("INSERT INTO player_aliases (player_id, name, seen_until) VALUES (?, 'Spieler #78', 1)").run(other);
    db.exec(readFileSync(new URL('../migrations/013_placeholder_names.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT name FROM players WHERE id = ?').pluck().get(id)).toBe('Real');
    expect(db.prepare('SELECT name FROM player_aliases WHERE player_id IN (?, ?)').pluck().all(id, other)).toEqual(['Old']);
  });

  it('keeps a position seen later from older spy reports', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Old spy' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const add = (name: string) => Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(groupX, name).lastInsertRowid);
    const [alpha, owner] = [add('Former'), add('Owner')];
    // "Alpha" of the report is a former name
    db.prepare("INSERT INTO player_aliases (player_id, name, seen_until) VALUES (?, 'Alpha', 1)").run(alpha);
    const ingest = () => app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('messages.html') } });
    const planet = () => db.prepare('SELECT name, player_id FROM planets WHERE group_id = ? AND g = 1 AND s = 234 AND p = 5').get(groupX) as any;

    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 1, 234, 5, 'New', ?)").run(groupX, owner);
    db.prepare('INSERT INTO galaxy_views (group_id, g, s, seen_at) VALUES (?, 1, 234, ?)').run(groupX, Math.floor(Date.now() / 1000));
    await ingest();
    expect(planet()).toEqual({ name: 'New', player_id: owner });
    expect(db.prepare('SELECT player_id FROM spy_reports WHERE group_id = ?').pluck().get(groupX)).toBe(alpha);

    // without a newer view the report is the newest state
    db.prepare('DELETE FROM galaxy_views WHERE group_id = ?').run(groupX);
    db.prepare('DELETE FROM spy_reports WHERE group_id = ?').run(groupX);
    await ingest();
    expect(planet()).toEqual({ name: 'Heimat', player_id: alpha });
  });

  it('shows since when a player is inactive', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Inactive' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const id = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Sleepy')").run(groupX).lastInsertRowid);
    const log = db.prepare('INSERT INTO player_status_log (player_id, status, seen_at) VALUES (?, ?, ?)');
    const since = async () => (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json().players.find((p: any) => p.id === id).inactive_since;
    log.run(id, '["inactive"]', 100);
    log.run(id, '["inactive"]', 200);
    expect(await since()).toBe(100);
    // active again, then inactive anew: counts from the new start
    log.run(id, '[]', 300);
    expect(await since()).toBeNull();
    log.run(id, '["inactive"]', 400);
    log.run(id, '["inactive","longinactive"]', 500);
    expect(await since()).toBe(400);
  });

  it('finds a member’s player the same way in every view', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Members' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    // no in-game name set: the owner of a planet on the member's empire page is their player
    const owner = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Owner')").run(groupX).lastInsertRowid);
    db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 2, 3, 4, 'Home', ?)").run(groupX, owner);
    const empire = { kind: 'empire', research: {}, planets: [{ name: 'Home', coords: { g: 2, s: 3, p: 4 }, type: 'planet', values: {} }] };
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, ?, ?)').run(groupX, 1000, JSON.stringify(empire));
    const snap = Number(db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 1, 2000)").run(groupX).lastInsertRowid);
    db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points) VALUES (?, ?, 1, 500)').run(snap, owner);

    const stats = (await app.inject({ method: 'GET', url: '/hub/api/u8/stats?who=player&type=1', headers })).json();
    expect(stats.me).toMatchObject({ id: owner, points: { 1: 500 } });
    expect(stats.rows[0]).toMatchObject({ name: 'Owner', own: true, member: 1 });
    const imperium = (await app.inject({ method: 'GET', url: '/hub/api/u8/imperium', headers })).json();
    expect(imperium.player).toMatchObject({ id: owner, name: 'Owner', stats: { 1: { points: 500, rank: 1, time: 2000 } } });
    const ov = (await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).json();
    expect(ov.planets.find((p: any) => p.g === 2 && p.s === 3 && p.p === 4)).toMatchObject({ player_id: owner, own: { time: 1000 } });
  });

  it('adds the planet type to empire pages stored before moon detection', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Moon types' } })).json().id;
    const c = { g: 1, s: 2, p: 3 };
    const empire = { kind: 'empire', research: {}, planets: [
      { name: 'Home', coords: c, values: {} },
      { name: 'Moon', coords: c, values: {} },
      { name: 'Base', coords: { g: 1, s: 5, p: 6 }, values: { 41: 1 } },
      { name: 'Typed', coords: { g: 1, s: 7, p: 8 }, type: 'planet', values: {} },
    ] };
    const id = Number(db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, 1, ?)').run(groupX, JSON.stringify(empire)).lastInsertRowid);
    db.exec(readFileSync(new URL('../migrations/016_empire_moon_types.sql', import.meta.url), 'utf8'));
    const data = JSON.parse(db.prepare('SELECT data FROM empire_snapshots WHERE id = ?').pluck().get(id) as string);
    expect(data.planets.map((p: any) => [p.name, p.type])).toEqual([['Home', 'planet'], ['Moon', 'moon'], ['Base', 'moon'], ['Typed', 'planet']]);
    expect(data.planets[2].values).toEqual({ 41: 1 });
  });

  it('keeps the activity log of merged players', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Merge' } })).json().id;
    const add = (name: string) => Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(groupX, name).lastInsertRowid);
    const [from, into] = [add('Old'), add('New')];
    db.prepare("INSERT INTO activity_log (group_id, time, kind, player_id, dedupe_key) VALUES (?, 1, 'planet_new', ?, 'merge')").run(groupX, from);
    const res = await app.inject({ method: 'POST', url: `/hub/api/admin/groups/${groupX}/players/merge`, headers: admin, payload: { from, into } });
    expect(res.statusCode).toBe(200);
    expect(db.prepare("SELECT player_id FROM activity_log WHERE dedupe_key = 'merge'").pluck().get()).toBe(into);
  });

  it('clamps limits and validates notes and deck settings', async () => {
    const headers = { ...admin, 'x-hub-group': String(groupA) };
    const spyCount = db.prepare('SELECT COUNT(*) FROM spy_reports WHERE group_id = ?').pluck().get(groupA) as number;
    for (let i = 0; i < 2; i++) {
      db.prepare("INSERT INTO spy_reports (group_id, g, s, p, planet_type, report_time, player_name, sections) VALUES (?, 9, 9, 9, 'planet', ?, 'X', '{}')").run(groupA, 1000 + i);
    }
    const spy = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy/9/9/9?limit=-1', headers })).json();
    expect(spy).toMatchObject({ total: 2 });
    expect(spy.reports).toHaveLength(1);
    const recent = (await app.inject({ method: 'GET', url: `/hub/api/u8/spy-reports?limit=1&offset=${spyCount + 1}`, headers })).json();
    expect(recent).toHaveLength(1);
    expect(recent[0].report_time).toBe(1000);
    // keyset paging: same second, ordered by id; a report added meanwhile does not shift the next page
    const same = [1, 2].map((p) =>
      Number(db.prepare("INSERT INTO spy_reports (group_id, g, s, p, planet_type, report_time, player_name, sections) VALUES (?, 9, 8, ?, 'planet', 500, 'X', '{}')").run(groupA, p).lastInsertRowid),
    );
    const page = async (before: string) => (await app.inject({ method: 'GET', url: `/hub/api/u8/spy-reports?limit=1&before=${before}`, headers })).json();
    const first = await page('501:0');
    expect(first.map((r: any) => r.id)).toEqual([same[1]]);
    db.prepare("INSERT INTO spy_reports (group_id, g, s, p, planet_type, report_time, player_name, sections) VALUES (?, 9, 9, 9, 'planet', 2000, 'X', '{}')").run(groupA);
    expect((await page(`500:${first[0].id}`)).map((r: any) => r.id)).toEqual([same[0]]);

    const player = db.prepare('SELECT id FROM players WHERE group_id = ? LIMIT 1').pluck().get(groupA);
    const note = (payload: object) => app.inject({ method: 'PUT', url: `/hub/api/u8/players/${player}/note`, headers, payload });
    expect((await note({ note: { x: 1 } })).statusCode).toBe(400);
    expect((await note({ note: 'x'.repeat(5001) })).statusCode).toBe(400);
    expect((await note({ note: 'farm' })).statusCode).toBe(200);

    const deck = (payload: object) => app.inject({ method: 'PUT', url: '/hub/api/u8/deck', headers, payload });
    expect((await deck({ startTime: 'yesterday' })).statusCode).toBe(400);
    expect((await deck({ initialDrawn: { 'Nothing:normal': -1 } })).statusCode).toBe(400);
    expect((await deck({ startTime: 1000, initialDrawn: { 'Nothing:normal': 2 } })).statusCode).toBe(200);
  });

  it('keeps the last admin of an alliance', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Admins' } })).json().id;
    const gx = `/hub/api/admin/groups/${groupX}`;
    const carolPh = (await app.inject({ method: 'POST', url: `${gx}/members`, headers: admin, payload: { name: 'Carol' } })).json();
    await app.inject({ method: 'PUT', url: `${gx}/members/${carolPh.id}`, headers: admin, payload: { role: 'admin' } });
    const inv = (await app.inject({ method: 'POST', url: `${gx}/members/${carolPh.id}/invite`, headers: admin })).json();
    await app.inject({ method: 'POST', url: `/hub/api/invites/${inv.token}/accept`, payload: { username: 'carol', password: 'carolpass' } });
    const carol = await login('carol', 'carolpass');
    const id = db.prepare("SELECT id FROM users WHERE username = 'carol'").pluck().get();
    const url = `/hub/api/admin/groups/${groupX}/members/${id}`;
    // nobody removes themselves or the hub owner (first admin), nor demotes the owner
    const owner = `/hub/api/admin/groups/${groupX}/members/1`;
    expect((await app.inject({ method: 'DELETE', url: owner, headers: admin })).json().code).toBe('remove_self');
    expect((await app.inject({ method: 'DELETE', url: owner, headers: carol })).json().code).toBe('owner_protected');
    expect((await app.inject({ method: 'PUT', url: owner, headers: carol, payload: { role: 'member' } })).json().code).toBe('owner_protected');
    expect((await app.inject({ method: 'DELETE', url, headers: carol })).json().code).toBe('remove_self');
    const members = (await app.inject({ method: 'GET', url: `/hub/api/admin/groups/${groupX}/members`, headers: carol })).json();
    expect(members.map((m: any) => [m.username, m.owner])).toEqual([['admin', true], ['carol', false]]);
    // technical administration stays with the global admin
    const raw = db.prepare("INSERT INTO raw_ingests (group_id, source, page_type, created_at) VALUES (?, 'paste', 'stats', 1)").run(groupX).lastInsertRowid;
    for (const [method, path] of [
      ['GET', `groups/${groupX}/ingests`],
      ['POST', `groups/${groupX}/players/merge`],
      ['POST', `groups/${groupX}/activity/backfill`],
      ['POST', `ingests/${raw}/reparse`],
      ['POST', `ingests/${raw}/delete`],
    ] as const) {
      const res = await app.inject({ method, url: `/hub/api/admin/${path}`, headers: carol, payload: method === 'POST' ? {} : undefined });
      expect(res.json().code, path).toBe('admin_only');
    }
    // the owner left (e.g. before this rule), carol is the only admin
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = 1').run(groupX);
    expect((await app.inject({ method: 'PUT', url, headers: carol, payload: { role: 'member' } })).json().code).toBe('last_admin');
    // the global admin may
    expect((await app.inject({ method: 'PUT', url, headers: admin, payload: { role: 'member' } })).statusCode).toBe(200);
  });

  it('renames an alliance', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Alt' } })).json().id;
    const rename = (name: string) => app.inject({ method: 'PUT', url: `/hub/api/admin/groups/${groupX}`, headers: admin, payload: { name } });
    expect((await rename(' ')).json().code).toBe('name_missing');
    expect((await rename('A')).json().code).toBe('group_exists');
    expect((await rename(' Neu ')).statusCode).toBe(200);
    expect(db.prepare('SELECT name FROM groups WHERE id = ?').pluck().get(groupX)).toBe('Neu');
    expect((await rename('Neu')).statusCode).toBe(200);
  });

  it('rejects duplicate universes and invalid settings', async () => {
    const h = { headers: admin };
    expect((await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8' }, ...h })).statusCode).toBe(409);
    expect(
      (await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u9', settings: { timezone: 'Mars/Base' } }, ...h })).statusCode,
    ).toBe(400);
    for (const settings of [{ systems: 'many' }, { galaxies: 0 }, { positions: 1.5 }, { circularSystems: 'yes' }, { systemDistanceFactor: -1 }, { missileRangeFactor: -0.5 }, { missileRangeFactor: 'x' }, { fleetDebrisPercent: 101 }, { defenseDebrisPercent: -1 }, { bigShields: 'yes' }, { noobLimit: -1 }, { noobInactives: 1 }, { galaxies: null }]) {
      const res = await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u9', settings }, ...h });
      expect(res.json().code).toBe('setting_invalid');
    }
    // null removes an optional setting, so it falls back to its default
    const put = (settings: object) => app.inject({ method: 'PUT', url: '/hub/api/admin/universes/u8', payload: { settings }, ...h });
    const settings = () => JSON.parse(db.prepare("SELECT settings FROM universes WHERE slug = 'u8'").pluck().get() as string);
    expect((await put({ noobLimit: 5_000_000, noobFactor: 5 })).statusCode).toBe(200);
    expect(settings()).toMatchObject({ noobLimit: 5_000_000, noobFactor: 5 });
    expect((await put({ noobLimit: null })).statusCode).toBe(200);
    expect(settings()).not.toHaveProperty('noobLimit');
    expect(settings().noobFactor).toBe(5);
  });
});

describe('universe check on paste', () => {
  it('tells pasted pages of another universe apart', async () => {
    const { foreignUniverse } = await import('../src/ingest.js');
    const link = (base: string) => `<a href="${base}game.php?page=statistics">x</a>`;
    expect(foreignUniverse(link('https://pr0game.com/uni7/'), 'https://pr0game.com/uni7/')).toBeNull();
    expect(foreignUniverse(link('http://pr0game.com/uni7/'), 'https://pr0game.com/uni7')).toBeNull();
    expect(foreignUniverse(link('https://test.pr0game.com/'), 'https://pr0game.com/uni7/')).not.toBeNull();
    expect(foreignUniverse(fixture('stats-real-source.html'), 'https://pr0game.com/uni7/')).toBeNull();
    expect(foreignUniverse(fixture('stats-real-source.html'), 'https://pr0game.com/uni8/')).not.toBeNull();
    // no marker or no game URL: nothing to tell
    expect(foreignUniverse('<table></table>', 'https://pr0game.com/uni7/')).toBeNull();
    expect(foreignUniverse(link('https://test.pr0game.com/'), '')).toBeNull();
  });
});

describe('admin: taking a sync back', () => {
  it('removes what a sync stored, after a dry run', async () => {
    const groupC = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'Cleanup' }, headers: admin })).json().id;
    // a player of this universe with a planet: stays, only loses the foreign scores
    const own = Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(groupC, 'Alpha').lastInsertRowid);
    db.prepare('INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 1, 1, 1, ?, ?)').run(groupC, 'Heimat', own);
    const headers = { ...admin, 'x-hub-group': String(groupC) };
    const players = () => db.prepare('SELECT name FROM players WHERE group_id = ? ORDER BY name').pluck().all(groupC) as string[];
    const counts = () =>
      ['stat_snapshots', 'empire_snapshots', 'overview_snapshots', 'raw_ingests'].map((t) => db.prepare(`SELECT COUNT(*) FROM ${t} WHERE group_id = ?`).pluck().get(groupC));
    for (const f of ['stats-player.html', 'empire-real-source.html', 'overview.html']) {
      expect((await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture(f) } })).statusCode).toBe(200);
    }
    const before = players();
    expect(before.length).toBeGreaterThan(1);
    expect(counts()).toEqual([1, 1, 1, 3]);

    const ingests = (await app.inject({ method: 'GET', url: `/hub/api/admin/groups/${groupC}/ingests`, headers: admin })).json();
    const id = (page: string) => ingests.find((i: any) => i.page_type === page).id;
    const undo = (raw: number, dryRun = false) => app.inject({ method: 'POST', url: `/hub/api/admin/ingests/${raw}/delete`, headers: admin, payload: { dryRun } });

    const preview = (await undo(id('stats'), true)).json();
    expect(preview).toMatchObject({ snapshots: 1, scores: before.length, kept: ['Alpha'], empires: 0, skipped: [] });
    expect(preview.players.sort()).toEqual(before.filter((n) => n !== 'Alpha'));
    expect(players()).toEqual(before);
    expect(counts()).toEqual([1, 1, 1, 3]);

    expect((await undo(id('stats'))).json()).toEqual(preview);
    expect(players()).toEqual(['Alpha']);
    // alliances stay only as long as a remaining player belongs to them
    expect(
      db.prepare('SELECT COUNT(*) FROM alliances a WHERE group_id = ? AND NOT EXISTS (SELECT 1 FROM players p WHERE p.alliance_id = a.id)').pluck().get(groupC),
    ).toBe(0);
    expect(counts()).toEqual([0, 1, 1, 2]);

    expect((await undo(id('empire'))).json()).toMatchObject({ empires: 1, snapshots: 0 });
    expect((await undo(id('overview'))).json()).toMatchObject({ overviews: 1 });
    expect(counts()).toEqual([0, 0, 0, 0]);
    expect((await undo(id('overview'))).statusCode).toBe(404);

    // a galaxy view can't be taken back (only the newest state is stored): said so, the sync entry still goes
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('galaxy.html') } });
    const galaxy = (await app.inject({ method: 'GET', url: `/hub/api/admin/groups/${groupC}/ingests`, headers: admin })).json()[0];
    expect((await undo(galaxy.id, true)).json().skipped).toEqual(['galaxy']);
    expect((await undo(999999)).statusCode).toBe(404);
  });
});

describe('plausibility of pasted pages', () => {
  it('tells statistics and galaxy views of another universe by their content', async () => {
    const { foreignRecords } = await import('../src/plausibility.js');
    const groupP = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'Plausibility' }, headers: admin })).json().id;
    const add = db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)');
    const ids = Array.from({ length: 60 }, (_, i) => Number(add.run(groupP, `Own${i}`).lastInsertRowid));
    const planet = db.prepare('INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 1, 1, ?, ?, ?)');
    for (let p = 1; p <= 10; p++) planet.run(groupP, p, 'Kolonie', ids[p]);

    const stats = (names: string[]) => ({
      kind: 'stats' as const, who: 'player' as const, type: 1 as const, statTime: null,
      rows: names.map((name, i) => ({ rank: i + 1, rankChange: null, ingameId: null, name, status: [], allyId: null, allyName: null, points: 1 })),
    });
    const own = Array.from({ length: 30 }, (_, i) => `Own${i}`);
    const foreign = Array.from({ length: 30 }, (_, i) => `Fremd${i}`);
    expect(foreignRecords(db, { groupId: groupP, userId: 1 }, [stats(own)])).toBe(false);
    // some newcomers are fine, a page of strangers is not
    expect(foreignRecords(db, { groupId: groupP, userId: 1 }, [stats([...own.slice(0, 15), ...foreign.slice(0, 15)])])).toBe(false);
    expect(foreignRecords(db, { groupId: groupP, userId: 1 }, [stats(foreign)])).toBe(true);
    // a group that knows few players judges nothing
    expect(foreignRecords(db, { groupId: groupA, userId: 1 }, [stats(foreign)])).toBe(false);

    const galaxy = (owner: (p: number) => string) => ({
      kind: 'galaxy' as const, g: 1, s: 1,
      rows: Array.from({ length: 10 }, (_, i) => ({
        position: i + 1, planetName: 'X', moon: false, destroyed: false, playerId: null, playerName: owner(i + 1),
        status: [], allyId: null, allyTag: null, debris: null,
      })),
    });
    expect(foreignRecords(db, { groupId: groupP, userId: 1 }, [galaxy((p) => `Own${p}`)])).toBe(false);
    expect(foreignRecords(db, { groupId: groupP, userId: 1 }, [galaxy((p) => (p <= 3 ? `Fremd${p}` : `Own${p}`))])).toBe(false);
    expect(foreignRecords(db, { groupId: groupP, userId: 1 }, [galaxy((p) => `Fremd${p}`)])).toBe(true);

    // empire pages: planets of several other players, or none of the member's known planets
    const me = { groupId: groupP, userId: 1 };
    const empire = (...coords: [number, number, number][]) => ({
      kind: 'empire' as const, research: {},
      planets: coords.map(([g, s, p]) => ({ name: 'P', coords: { g, s, p }, type: 'planet' as const, values: {} })),
    });
    expect(foreignRecords(db, me, [empire([1, 1, 1], [1, 1, 2])])).toBe(true);
    expect(foreignRecords(db, me, [empire([1, 1, 1], [4, 4, 4])])).toBe(false);
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, 1, ?)').run(groupP, JSON.stringify(empire([2, 2, 2])));
    expect(foreignRecords(db, me, [empire([3, 3, 3])])).toBe(true);
    expect(foreignRecords(db, me, [empire([2, 2, 2], [3, 3, 3])])).toBe(false);
    db.prepare('DELETE FROM empire_snapshots WHERE group_id = ?').run(groupP);

    // overview: a planet of another player than the member's (new colonies without owner data pass)
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, 1, ?)').run(groupP, JSON.stringify(empire([1, 1, 3])));
    const overview = (g: number, s: number, p: number) => ({ kind: 'overview' as const, pageTime: null, current: { coords: { g, s, p }, type: 'planet' as const }, queues: [], catchUp: null });
    expect(foreignRecords(db, me, [overview(1, 1, 3)])).toBe(false);
    expect(foreignRecords(db, me, [overview(9, 9, 9)])).toBe(false);
    expect(foreignRecords(db, me, [overview(1, 1, 5)])).toBe(true);
    db.prepare('DELETE FROM empire_snapshots WHERE group_id = ?').run(groupP);

    // spy reports: mostly other players than the known owners
    const spy = (p: number, playerName: string) => ({
      kind: 'spy' as const, msgId: null, coords: { g: 1, s: 1, p }, planetType: 'planet' as const, planetName: 'X', playerName,
      reportTime: null, sections: {}, destroyChance: null, probesDestroyed: false,
    });
    expect(foreignRecords(db, me, [spy(1, 'Own1'), spy(2, 'Own2')])).toBe(false);
    expect(foreignRecords(db, me, [spy(1, 'Fremd1')])).toBe(false);
    expect(foreignRecords(db, me, [spy(1, 'Fremd1'), spy(2, 'Fremd2')])).toBe(true);

    // pages about the member's own planets (the member is Own3 on 1:1:3)
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, 1, 1, ?)').run(groupP, JSON.stringify(empire([1, 1, 3])));
    const at = (p: number) => ({ g: 1, s: 1, p });
    const hostile = (target: number, from: number, name: string) => ({
      kind: 'hostileSpy' as const, msgId: null, time: null, fromPlanetName: 'X', fromPlayerName: name, fromCoords: at(from), fromType: 'planet' as const,
      targetPlanetName: 'Y', targetCoords: at(target), targetType: 'planet' as const,
    });
    expect(foreignRecords(db, me, [hostile(3, 4, 'Own4')])).toBe(false);
    expect(foreignRecords(db, me, [hostile(5, 4, 'Own4')])).toBe(true);
    const fleet = (from: number) => ({
      owner: 'own' as const, player: null, mission: 1, missionName: 'Angreifen', phase: 'out' as const,
      from: { coords: at(from), type: 'planet' as const, name: null }, to: { coords: at(7), type: 'planet' as const, name: null },
      ships: {}, resources: null, seconds: 60,
    });
    expect(foreignRecords(db, me, [{ kind: 'fleets', pageTime: null, fleets: [fleet(3)] }])).toBe(false);
    expect(foreignRecords(db, me, [{ kind: 'fleets', pageTime: null, fleets: [fleet(6)] }])).toBe(true);
    // player messages: one of the member's planets among sender and recipients, names are not compared (renames)
    const message = (from: number, to: number) => ({
      kind: 'playerMessage' as const, msgId: null, time: null, subject: 's', body: 'b', thread: null, partnerId: null,
      from: { name: 'Altname', coords: at(from) }, to: [{ name: 'Wer', coords: at(to) }],
    });
    expect(foreignRecords(db, me, [message(3, 4), message(5, 3)])).toBe(false);
    expect(foreignRecords(db, me, [message(4, 5), message(6, 7)])).toBe(true);
    expect(foreignRecords(db, me, [message(4, 5)])).toBe(false);
    db.prepare('DELETE FROM empire_snapshots WHERE group_id = ?').run(groupP);

    // battle hall (not the all-time list) and combat reports: names the group mostly doesn't know
    const hall = (timeframe: number, names: string[]) => ({
      kind: 'battleHall' as const, timeframe,
      entries: names.map((n, i) => ({ reportId: String(i), rank: i + 1, attackers: [n], defenders: [], winner: null, time: null, units: 1 })),
    });
    expect(foreignRecords(db, me, [hall(2, own.slice(0, 8))])).toBe(false);
    expect(foreignRecords(db, me, [hall(2, foreign.slice(0, 8))])).toBe(true);
    expect(foreignRecords(db, me, [hall(0, foreign.slice(0, 8))])).toBe(false);
    const report = (names: string[]) => ({
      kind: 'combatReport' as const, reportId: null, time: null, winner: 'draw' as const, rounds: 6, lost: { attacker: 0, defender: 0 }, debris: { metal: 0, crystal: 0 },
      fleets: names.map((name) => ({ side: 'attacker' as const, name, from: null, start: {}, end: {} })),
    });
    expect(foreignRecords(db, me, [report(foreign.slice(0, 2))])).toBe(false);
    expect(foreignRecords(db, me, [report(foreign.slice(0, 6))])).toBe(true);

    // a pasted page of strangers is refused, also as preview, before anything is stored
    const head = fixture('stats-player.txt').split('\n').slice(0, 3).join('\n');
    const page = (names: string[]) => [head, ...names.map((n, i) => `${i + 1}\t${n}\t\t-\t${1000 - i}`)].join('\n');
    const headers = { ...admin, 'x-hub-group': String(groupP) };
    for (const dryRun of [true, false]) {
      const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: page(foreign), dryRun } });
      expect(res.json()).toMatchObject({ code: 'wrong_universe' });
    }
    expect(db.prepare('SELECT COUNT(*) FROM stat_snapshots WHERE group_id = ?').pluck().get(groupP)).toBe(0);
    expect(db.prepare("SELECT COUNT(*) FROM players WHERE group_id = ? AND name LIKE 'Fremd%'").pluck().get(groupP)).toBe(0);
    // the same page with own players is stored
    const ok = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { text: page(own) } });
    expect(ok.json().counts.player_scores.new).toBe(30);
  });
});

describe('admin: content of syncs', () => {
  it('describes what each sync contained, also for syncs stored before', async () => {
    const groupD = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'About' }, headers: admin })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupD) };
    for (const f of ['stats-player.html', 'empire-real-source.html']) {
      await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture(f) } });
    }
    // a sync from before the description: built from its page when listed, then stored
    const old = db.prepare('SELECT id FROM raw_ingests WHERE group_id = ? AND page_type = ?').pluck().get(groupD, 'stats') as number;
    db.prepare(`UPDATE raw_ingests SET summary = json_remove(summary, '$.about') WHERE id = ?`).run(old);
    const list = (await app.inject({ method: 'GET', url: `/hub/api/admin/groups/${groupD}/ingests`, headers: admin })).json();
    const about = (page: string) => list.find((i: any) => i.page_type === page).summary.about;
    expect(about('stats')).toEqual([{ kind: 'stats', count: 1, who: 'player', type: 2, sample: ['Alpha', 'Beta Max', 'Gamma'] }]);
    expect(about('empire')[0]).toMatchObject({ kind: 'empire', count: 1 });
    expect(about('empire')[0].sample[0]).toMatch(/ \d+:\d+:\d+$/);
    expect(JSON.parse(db.prepare('SELECT summary FROM raw_ingests WHERE id = ?').pluck().get(old) as string).about).toHaveLength(1);
  });

  it('syncs a page for another member of the group', async () => {
    const groupX = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'For others' } })).json().id;
    const headers = { ...admin, 'x-hub-group': String(groupX) };
    const frank = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('frank', hashPassword('frankpass1')).lastInsertRowid);
    const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").pluck().get() as number;
    const ingest = (forUser: number) =>
      app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('messages.html'), forUser } });
    // not (yet) a member of this group
    expect((await ingest(frank)).json().code).toBe('member_not_found');
    expect(db.prepare('SELECT COUNT(*) FROM raw_ingests WHERE group_id = ?').pluck().get(groupX)).toBe(0);
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(groupX, frank);
    expect((await ingest(frank)).json().counts.recycle_reports).toEqual({ new: 1, duplicate: 0 });
    expect(db.prepare('SELECT user_id FROM recycle_reports WHERE group_id = ?').pluck().all(groupX)).toEqual([frank]);
    expect(db.prepare('SELECT user_id, synced_by FROM raw_ingests WHERE group_id = ?').get(groupX)).toEqual({ user_id: frank, synced_by: adminId });
    const ingests = (await app.inject({ method: 'GET', url: `/hub/api/admin/groups/${groupX}/ingests`, headers: admin })).json();
    expect(ingests[0]).toMatchObject({ username: 'frank', synced_by: 'admin' });
    // oneself as the chosen member: an ordinary own sync
    await ingest(adminId);
    expect(db.prepare('SELECT synced_by FROM raw_ingests WHERE group_id = ? ORDER BY id DESC').pluck().get(groupX)).toBeNull();
  });
});

describe('performance and system monitor', () => {
  it('finds the newest score per category also when newer updates miss the player', async () => {
    const { latestScores } = await import('../src/repo/stats.js');
    const g = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers: admin, payload: { universe: 'u8', name: 'Scores' } })).json().id;
    const player = (name: string) => Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(g, name).lastInsertRowid);
    const [a, b] = [player('A'), player('B')];
    const snap = (type: number, time: number) =>
      Number(db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', ?, ?)").run(g, type, time).lastInsertRowid);
    const score = (s: number, p: number, points: number) => db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points) VALUES (?, ?, 1, ?)').run(s, p, points);
    const [old, mid, recent] = [snap(1, 1000), snap(1, 2000), snap(1, 3000)];
    score(old, a, 10); score(old, b, 20);
    score(mid, a, 11);
    score(recent, a, 12);
    // pasted later, but older
    score(snap(1, 500), b, 99);
    score(snap(2, 1500), b, 5);
    // the trigger copies category and time onto rows inserted without them
    expect(db.prepare('SELECT type, stat_time FROM player_scores WHERE snapshot_id = ?').get(mid)).toEqual({ type: 1, stat_time: 2000 });
    const latest = latestScores(db, g, [a, b, a]);
    expect(latest.get(a)).toEqual({ 1: { points: 12, rank: 1, time: 3000 } });
    expect(latest.get(b)).toEqual({ 1: { points: 20, rank: 1, time: 1000 }, 2: { points: 5, rank: 1, time: 1500 } });
    // players of other groups are not looked up
    expect(latestScores(db, groupA, [a]).size).toBe(0);
  });

  it('reports database, memory and request figures to global admins only', async () => {
    await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers: { ...admin, 'x-hub-group': String(groupA) } });
    const res = await app.inject({ method: 'GET', url: '/hub/api/admin/system', headers: admin });
    expect(res.statusCode).toBe(200);
    const sys = res.json();
    expect(sys.database.bytes).toBeGreaterThan(0);
    expect(sys.database.tables.find((t: any) => t.name === 'player_scores')).toMatchObject({ rows: expect.any(Number), indexBytes: expect.any(Number) });
    expect(sys.memory.rss).toBeGreaterThan(0);
    expect(sys.requests.find((r: any) => r.route === 'GET /api/:uni/overview')).toMatchObject({ count: expect.any(Number), p95: expect.any(Number) });
    expect(sys.usage.groups.find((x: any) => x.id === groupA)).toMatchObject({ members: expect.any(Number), syncs: expect.any(Number) });

    const member = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('sysmember', hashPassword('sysmember1')).lastInsertRowid);
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(groupA, member);
    const headers = await login('sysmember', 'sysmember1');
    expect((await app.inject({ method: 'GET', url: '/hub/api/admin/system', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/hub/api/admin/system/vacuum', headers, payload: {} })).statusCode).toBe(403);
    // in-memory database: VACUUM works the same
    const vac = await app.inject({ method: 'POST', url: '/hub/api/admin/system/vacuum', headers: admin, payload: {} });
    expect(vac.json()).toMatchObject({ ok: true, before: expect.any(Number), after: expect.any(Number) });
  });
});
