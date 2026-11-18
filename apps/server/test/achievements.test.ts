import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { addDays, dayOf, periodDays, streakOf } = await import('../src/repo/achievements.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');
let group = 0;
let carolId = 0;
let daveId = 0;
let carol: Record<string, string>;
const TZ = 'Europe/Berlin';

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const getJson = async (url: string) => {
  const res = await app.inject({ method: 'GET', url: `/hub/api/${url}`, headers: carol });
  expect(res.statusCode).toBe(200);
  return res.json();
};

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  daveId = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('dave', 'x')").run().lastInsertRowid);
  const cookie = await login('admin', 'adminpass');
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: { cookie } });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: { cookie } })).json().id;
  for (const id of [carolId, daveId]) db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(group, id);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
});

describe('days and streaks', () => {
  it('counts days in the time zone and weeks from Monday', () => {
    // 2026-11-18 23:30 UTC is already the 19th in Berlin
    expect(dayOf(Date.UTC(2026, 10, 18, 23, 30) / 1000, TZ)).toBe('2026-11-19');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    // the 18th is a Wednesday
    expect(periodDays('week', '2026-11-18')).toEqual({ from: '2026-11-16', to: '2026-11-18' });
    expect(periodDays('lastWeek', '2026-11-18')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(periodDays('days30', '2026-11-18')).toEqual({ from: '2026-10-20', to: '2026-11-18' });
  });

  it('runs on synced days, breaks on a missed one, pauses in vacation mode', () => {
    const today = '2026-11-18';
    const set = (list: string[]) => new Set(list);
    const none = () => false;
    // 15th–17th synced, today still open: 3 and not broken
    expect(streakOf(set(['2026-11-15', '2026-11-16', '2026-11-17']), none, today)).toEqual({ current: 3, best: 3, today: false });
    // a missed 16th breaks the run
    expect(streakOf(set(['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-17', '2026-11-18']), none, today)).toEqual({ current: 2, best: 4, today: true });
    // in vacation mode on the 16th: paused, not broken, not counted
    expect(streakOf(set(['2026-11-15', '2026-11-17', '2026-11-18']), (d) => d === '2026-11-16', today)).toMatchObject({ current: 3, best: 3 });
    expect(streakOf(set([]), none, today)).toEqual({ current: 0, best: 0, today: false });
  });
});

describe('badges and ranking', () => {
  it('credits galaxy systems once a day and the own empire', async () => {
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload: { html: fixture('galaxy.html') } });
    db.prepare('UPDATE galaxy_views SET seen_at = seen_at - 86400 WHERE group_id = ?').run(group);
    // newer again the same day: still one system-day
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload: { html: fixture('galaxy.html') } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload: { html: fixture('empire.html') } });
    const credits = db.prepare('SELECT kind, key FROM sync_credits WHERE group_id = ? AND user_id = ? ORDER BY kind').all(group, carolId);
    expect(credits).toEqual([
      { kind: 'empire', key: '' },
      { kind: 'galaxy', key: expect.stringMatching(/^\d+:\d+$/) },
    ]);
  });

  it('counts the badges from the credits and the group\'s tables', async () => {
    const t = now();
    for (let i = 0; i < 12; i++) {
      db.prepare("INSERT INTO battle_reports (group_id, user_id, dedupe_key, g, s, p, planet_type, lost_attacker, lost_defender, loot_metal, loot_crystal, loot_deuterium, debris_metal, debris_crystal, created_at) VALUES (?, ?, ?, 1, 1, 1, 'planet', 0, 0, 0, 0, 0, 0, 0, ?)")
        .run(group, carolId, `b${i}`, t);
    }
    for (let i = 0; i < 9; i++) db.prepare("INSERT INTO sync_credits (group_id, user_id, day, kind) VALUES (?, ?, ?, 'empire')").run(group, carolId, `2026-01-0${i + 1}`);
    const { members } = await getJson('u8/achievements');
    const me = members.find((m: any) => m.userId === carolId);
    const badge = (k: string) => me.badges.find((b: any) => b.key === k);
    expect(badge('fleeter')).toEqual({ key: 'fleeter', count: 12, level: 1, levels: 5, next: 100, steps: [10, 100, 200, 500, 1000] });
    expect(badge('imperator')).toMatchObject({ count: 10, level: 1, next: 20 });
    expect(badge('cartographer')).toMatchObject({ count: 1, level: 0, next: 400 });
    // battle reports today: today counts for the streak
    expect(me.streak).toMatchObject({ today: true });
    expect(members.find((m: any) => m.userId === daveId).badges.every((b: any) => b.level === 0)).toBe(true);
  });

  it('ranks the members by the points of the period', async () => {
    const { rows, period } = await getJson('u8/ranking');
    expect(period).toBe('week');
    const me = rows.find((r: any) => r.userId === carolId);
    // one galaxy system 3, one empire day 10, twelve battle reports 3 each (the January credits lie outside)
    expect(me.parts).toMatchObject({ galaxy: 3, empire: 10, battle: 36 });
    expect(rows[0].userId).toBe(carolId);
    expect(rows.find((r: any) => r.userId === daveId).points).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/ranking?period=year', headers: carol })).statusCode).toBe(400);
  });
});
