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

  it('marks the guesses in the list of recent reports', async () => {
    const rows = (await app.inject({ method: 'GET', url: '/hub/api/u8/spy-reports', headers: carol })).json();
    const by = (p: number, type = 'planet') => rows.find((r: { p: number; planet_type: string }) => r.p === p && r.planet_type === type);
    expect(by(4).fleetSave).not.toBeNull();
    expect(by(8).fleetSave).toBeNull();
    expect(by(4, 'moon').fleetSave).toBeNull();
  });
});
