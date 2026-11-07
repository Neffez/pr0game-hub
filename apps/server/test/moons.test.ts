import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const t = now();
let group = 0;
let carol: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const report = (id: string, time: number, chance: number | null, created: boolean, attackers: string[], defenders: string[], extra = 0) =>
  db
    .prepare(
      `INSERT INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets, g, s, p, planet_type,
         moon_chance, moon_extra, moon_created) VALUES (?, ?, ?, 'attacker', 1, 0, 0, 0, 0, ?, 1, 10, 4, 'planet', ?, ?, ?)`,
    )
    .run(group, id, time, JSON.stringify([...attackers.map((n) => [0, n, []]), ...defenders.map((n) => [1, n, []])]), chance, extra, created ? 1 : 0);

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const carolId = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid;
  const cookie = await login('admin', 'adminpass');
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: { cookie } });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: { cookie } })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
  const carolPlayer = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Carol')").run(group).lastInsertRowid);
  db.prepare('INSERT INTO planets (group_id, g, s, p, player_id, has_moon, moon_diameter) VALUES (?, 1, 10, 4, NULL, 1, 8000)').run(group);
  report('a', t - 3600, 20, false, ['Carol', 'Other'], ['Foe'], 5);
  report('b', t - 7200, 15, true, ['Foe'], ['carol']);
  report('c', t - 7200, 0, false, ['Carol'], ['Foe']);
  report('d', t - 40 * 86400, 20, true, ['Carol'], ['Foe']);
  db.prepare("INSERT INTO activity_log (group_id, time, kind, g, s, p, player_id, dedupe_key) VALUES (?, ?, 'moon_new', 1, 10, 4, ?, 'm1')").run(group, t - 600, carolPlayer);
});

describe('moon chances (B-6)', () => {
  it('lists battles with a moon chance and sums the expected moons per member', async () => {
    const res = (await app.inject({ method: 'GET', url: '/hub/api/u8/moon-chances', headers: carol })).json();
    expect(res.days).toBe(30);
    expect(res.battles.map((b: any) => b.reportId)).toEqual(['a', 'b']);
    expect(res.battles[0]).toMatchObject({ chance: 25, extra: 5, created: false, memberSide: 'attacker', attackers: ['Carol', 'Other'], moon: { diameter: 8000 } });
    expect(res.battles[1]).toMatchObject({ chance: 15, created: true, memberSide: 'defender' });
    expect(res.members).toEqual([{ name: 'Carol', battles: 2, expected: 0.4, created: 1 }]);
    expect(res.newMoons).toEqual([{ time: t - 600, g: 1, s: 10, p: 4, player: 'Carol', diameter: 8000 }]);
  });

  it('stores the moon chance of a pasted battle report', async () => {
    const text = readFileSync(new URL('../../../packages/parser/test/fixtures/combat-report-de.txt', import.meta.url), 'utf8');
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload: { text } });
    const row = db.prepare('SELECT moon_chance, moon_created FROM combat_reports WHERE group_id = ? AND report_id NOT IN (?, ?, ?, ?)').get(group, 'a', 'b', 'c', 'd');
    expect(row).toEqual({ moon_chance: 0, moon_created: 0 });
  });
});
