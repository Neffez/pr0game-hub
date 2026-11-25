import { beforeAll, describe, expect, it } from 'vitest';
import { positionTemp, productionOf } from '@pr0hub/core/production';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let carol: Record<string, string>;
const t = now();
let farm = 0;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const spy = (p: number, time: number, sections: Record<number, Record<number, number>>, type = 'planet') =>
  db
    .prepare("INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_id, player_name, report_time, sections) VALUES (?, 1, 100, ?, ?, ?, 'Farm', ?, ?)")
    .run(group, p, type, farm, time, JSON.stringify(sections));

const MINES = { 1: 24, 2: 20, 3: 14, 4: 24, 22: 7, 23: 6, 24: 5 };
const RESEARCH = { 113: 10, 131: 5, 132: 4 };
/** crystal bonus of position 4 in the universe settings */
const BONUS = { 4: [0, 15, 0] };

/** What the game shows `seconds` after a fleet save left `left` of each resource on position `p`. */
function shown(p: number, seconds: number, left: number) {
  const b = BONUS[p as 4] ?? [0, 0, 0];
  const prod = productionOf({ levels: MINES, research: RESEARCH, temp: positionTemp(p), resourceSpeed: 2, bonus: { 901: b[0], 902: b[1], 903: b[2] } });
  return Object.fromEntries(([901, 902, 903] as const).map((r) => [r, Math.floor(left + (seconds * prod[r]) / 3600)]));
}

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  db.prepare("UPDATE universes SET settings = json_set(json_set(COALESCE(settings, '{}'), '$.resourceMultiplier', 5000), '$.positionBonus', json(?)) WHERE slug = 'u8'").run(JSON.stringify(BONUS));
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
  farm = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Farm')").run(group).lastInsertRowid);

  // position 4: saved 3:25:07 before the newest report, buildings and research in older reports; deuterium used since
  const save = shown(4, 3 * 3600 + 25 * 60 + 7, 0.6);
  spy(4, t - 60, { 900: { ...save, 903: 10 }, 200: { 212: 0 } });
  spy(4, t - 86400, { 0: MINES, 200: { 212: 0 } });
  spy(8, t - 2 * 86400, { 100: RESEARCH, 0: MINES, 900: { 901: 1, 902: 1, 903: 1 } });
  // position 8: resources left behind, nothing to tell
  spy(8, t - 120, { 900: { ...shown(8, 7200, 0), 902: 123_456 }, 0: MINES });
  // a moon produces nothing
  spy(4, t - 30, { 900: { 901: 0, 902: 0, 903: 0 } }, 'moon');
});

describe('fleet save guess', () => {
  it('finds the departure in the history of a position with buildings and research from other reports', async () => {
    const res = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy/1/100/4', headers: carol })).json();
    const guess = res.reports[0].fleetSave;
    const departure = t - 60 - (3 * 3600 + 25 * 60 + 7);
    expect(guess.from).toBeLessThanOrEqual(departure);
    expect(guess.to).toBeGreaterThanOrEqual(departure);
    expect(guess.to - guess.from).toBeLessThan(4);
    expect(guess.deuterium).toBe(false);
    expect(guess.buildingsTime).toBe(t - 86400);
    expect(guess.researchTime).toBe(t - 2 * 86400);
    // the older report has no resources worth telling
    expect(res.reports[1].fleetSave).toBeNull();
  });

  it('adds the departure to the activity pattern, once per planet and departure', async () => {
    // a second probe 30 s later sees the same save
    const seconds = 3 * 3600 + 25 * 60 + 7;
    spy(4, t - 30, { 900: { ...shown(4, seconds + 30, 0.6), 903: 10 }, 0: MINES, 200: { 212: 0 } });
    const res = (await app.inject({ method: 'GET', url: `/hub/api/u8/players/${farm}/activity`, headers: carol })).json();
    const saves = res.events.filter((e: { source: string; p: number }) => e.source === 'fleetSave' && e.p === 4);
    expect(saves).toHaveLength(1);
    const departure = t - 60 - seconds;
    expect(Math.abs(saves[0].time - departure)).toBeLessThanOrEqual(saves[0].spread + 1);
    expect(saves[0]).toMatchObject({ g: 1, s: 100 });
    db.prepare("DELETE FROM spy_reports WHERE report_time = ? AND p = 4 AND planet_type = 'planet'").run(t - 30);
  });

  it('lists fleet saves in the activity log, reports of the same save narrowed to one departure', async () => {
    const seconds = 3 * 3600 + 25 * 60 + 7;
    const departure = t - 60 - seconds;
    // a second probe 2 h later during the same save, without fractions left: its window differs, the overlap stays
    const later = spy(4, t - 50, { 900: { ...shown(4, seconds + 10, 0), 903: 10 }, 0: MINES, 200: { 212: 0 } }).lastInsertRowid;
    const single = (await app.inject({ method: 'GET', url: `/hub/api/u8/spy/1/100/4`, headers: carol })).json().reports;
    const windows = single.filter((r: { fleetSave: unknown }) => r.fleetSave).map((r: { fleetSave: { from: number; to: number } }) => r.fleetSave);
    const res = (await app.inject({ method: 'GET', url: `/hub/api/u8/activity?from=${t - 86400}&to=${t + 60}`, headers: carol })).json();
    const saves = res.entries.filter((e: { kind: string; p: number }) => e.kind === 'fleet_save' && e.p === 4);
    expect(saves).toHaveLength(1);
    const d = saves[0].data;
    expect(d.reports).toBe(2);
    expect(d.from).toBe(Math.max(...windows.map((w: { from: number }) => w.from)));
    expect(d.to).toBe(Math.min(...windows.map((w: { to: number }) => w.to)));
    expect(d.from).toBeLessThanOrEqual(departure);
    expect(d.to).toBeGreaterThanOrEqual(departure);
    expect(saves[0]).toMatchObject({ player_id: farm, player_name: 'Farm', g: 1, s: 100, time: d.from, id: -Number(later) });
    expect(res.counts.fleet_save).toBe(1);
    // asked for other kinds only: none
    const other = (await app.inject({ method: 'GET', url: `/hub/api/u8/activity?from=${t - 86400}&to=${t + 60}&kinds=planet_new`, headers: carol })).json();
    expect(other.entries.some((e: { kind: string }) => e.kind === 'fleet_save')).toBe(false);
    db.prepare('DELETE FROM spy_reports WHERE id = ?').run(later);
  });

  it('filters the recent reports to fleet saves, page by page', async () => {
    const all = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy-reports?fleetSave=1', headers: carol })).json();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((r: { fleetSave: unknown; planet_type: string }) => r.fleetSave && r.planet_type === 'planet')).toBe(true);
    const first = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy-reports?fleetSave=1&limit=1', headers: carol })).json();
    const next = (await app.inject({ method: 'GET', url: `/hub/api/u8/spy-reports?fleetSave=1&limit=1&before=${first[0].report_time}:${first[0].id}`, headers: carol })).json();
    expect([...first, ...next].map((r: { id: number }) => r.id)).toEqual(all.slice(0, 2).map((r: { id: number }) => r.id));
  });

  it('marks the guesses in the list of recent reports', async () => {
    const rows = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy-reports', headers: carol })).json();
    const by = (p: number, type = 'planet') => rows.find((r: { p: number; planet_type: string }) => r.p === p && r.planet_type === type);
    expect(by(4).fleetSave).not.toBeNull();
    expect(by(8).fleetSave).toBeNull();
    expect(by(4, 'moon').fleetSave).toBeNull();
  });
});
