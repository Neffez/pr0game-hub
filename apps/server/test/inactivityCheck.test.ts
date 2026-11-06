import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let admin: Record<string, string>;
let carol: Record<string, string>;
const H = 3600;
const D = 24 * H;
const T = Math.floor(Date.now() / 1000 / (6 * H)) * 6 * H;
const ids: Record<string, number> = {};

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
function score(playerId: number, time: number, points: number, rank: number) {
  db.prepare("INSERT OR IGNORE INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 1, ?)").run(group, time);
  const snap = db.prepare("SELECT id FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = 1 AND stat_time = ?").pluck().get(group, time);
  db.prepare('INSERT INTO player_scores (snapshot_id, player_id, type, stat_time, points, rank) VALUES (?, ?, 1, ?, ?, ?)').run(snap, playerId, time, points, rank);
}

/** Gone: last online 8 days ago, flagged by the game a day ago. Flaky: three quiet days, then active again. */
const FLAG = T - D;
const LAST_LOGIN = FLAG - 3 * H - 7 * D;

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)').run('lead', hashPassword('leadpass'));
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('root', hashPassword('rootpass'));
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass'));
  const root = { headers: { cookie: await login('root', 'rootpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...root });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...root })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, role) SELECT ?, id, 'admin' FROM users WHERE username = 'lead'").run(group);
  db.prepare("INSERT INTO group_members (group_id, user_id) SELECT ?, id FROM users WHERE username = 'carol'").run(group);
  admin = { cookie: await login('lead', 'leadpass'), 'x-hub-group': String(group) };
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };

  for (const n of ['Busy1', 'Busy2', 'Gone', 'Flaky', 'Spier', 'Vague']) ids[n] = Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(group, n).lastInsertRowid);
  for (let time = T - 40 * D; time <= T; time += 6 * H) {
    const i = (time - (T - 40 * D)) / (6 * H);
    score(ids.Busy1, time, 50_000 + i * 1000, 1);
    score(ids.Busy2, time, 49_000 + i * 1000, 2);
    score(ids.Gone, time, 40_000 + Math.min(time, LAST_LOGIN) / 100 - (T - 40 * D) / 100, 3);
    // quiet from 10 to 7 days ago
    const quietFrom = T - 10 * D;
    const quietTo = T - 7 * D;
    const active = time < quietFrom ? time : time < quietTo ? quietFrom : time - (quietTo - quietFrom);
    score(ids.Flaky, time, 30_000 + (active - (T - 40 * D)) / 50, 4);
    score(ids.Spier, time, 20_000, 5);
    score(ids.Vague, time, 10_000, 6);
  }
  db.prepare('INSERT INTO player_status_log (player_id, status, seen_at) VALUES (?, ?, ?), (?, ?, ?)').run(ids.Gone, '[]', FLAG - 6 * H, ids.Gone, '["inactive"]', FLAG);
  db.prepare("UPDATE players SET status = '[\"inactive\"]' WHERE id = ?").run(ids.Gone);
  // Spier: sightings 5 days apart, but a spy on a member shortly before the latest possible login narrows it down
  db.prepare('INSERT INTO player_status_log (player_id, status, seen_at) VALUES (?, ?, ?), (?, ?, ?)').run(ids.Spier, '[]', FLAG - 5 * D, ids.Spier, '["inactive"]', FLAG);
  db.prepare(
    "INSERT INTO hostile_spying (group_id, dedupe_key, time, from_player, from_g, from_s, from_p, from_type, target_g, target_s, target_p, target_type) VALUES (?, 'k1', ?, 'Spier', 1, 1, 1, 'planet', 2, 2, 2, 'planet')",
  ).run(group, FLAG - 7 * D - 12 * H);
  // Vague: sightings 5 days apart and nothing else: skipped
  db.prepare('INSERT INTO player_status_log (player_id, status, seen_at) VALUES (?, ?, ?), (?, ?, ?)').run(ids.Vague, '[]', FLAG - 5 * D, ids.Vague, '["inactive"]', FLAG);
});

describe('inactivity check', () => {
  it('is for alliance admins', async () => {
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/inactivity-check', headers: carol })).statusCode).toBe(403);
  });

  it('replays the score after the last login of players the game flagged later', async () => {
    const res = (await app.inject({ method: 'GET', url: '/hub/api/u8/inactivity-check', headers: admin })).json();
    expect(res).toMatchObject({ events: 2, skipped: 1, narrowed: 1 });
    const by = Object.fromEntries(res.detection.map((d: any) => [d.hours, d]));
    expect(by[12].likely).toBe(0);
    expect(by[48]).toMatchObject({ n: 2, likely: 1 });
    expect(by[120]).toMatchObject({ likely: 1 });
  });

  it('counts a high score followed by points gains as a false alarm', async () => {
    const res = (await app.inject({ method: 'GET', url: '/hub/api/u8/inactivity-check?fresh=1', headers: admin })).json();
    expect(res.falseAlarms.days).toBeGreaterThan(20);
    expect(res.falseAlarms.contradicted).toBeGreaterThanOrEqual(1);
    expect(res.falseAlarms.examples.map((e: any) => e.name)).toContain('Flaky');
    expect(res.falseAlarms.examples.map((e: any) => e.name)).not.toContain('Gone');
    expect(res.weights.tau).toBe(36 * H);
    // Flaky came back with points gains, Spier spied on a member after days without a gain
    expect(Object.values(res.falseAlarms.causes).reduce((a: number, b: any) => a + b, 0)).toBe(res.falseAlarms.contradicted);
    expect(res.falseAlarms.examples.find((e: any) => e.name === 'Flaky').cause).toBe('gain');
    expect(res.falseAlarms.examples.find((e: any) => e.name === 'Spier').cause).toBe('spy');
    expect(res.falseAlarms.playersContradicted).toBeLessThanOrEqual(res.falseAlarms.players);
  });
});
