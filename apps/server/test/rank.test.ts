import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { ranksAt } = await import('../src/repo/rank.js');
const { resolveGroup, getUniverse } = await import('../src/context.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let carolId = 0;
let daveId = 0;
let carol: Record<string, string>;
const T = 1_780_000_000;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}

const battle = db.prepare(
  `INSERT INTO battle_reports (group_id, user_id, dedupe_key, time, g, s, p, planet_type, outcome, lost_attacker, lost_defender,
     loot_metal, loot_crystal, loot_deuterium, debris_metal, debris_crystal, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'planet', ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
);
let n = 0;
/** a battle of the member at target position `p` (system 1:1), at T + `dt` */
const fight = (user: number, p: number, outcome: string | null, lostAtt: number, lostDef: number, loot: number, dt = n) =>
  battle.run(group, user, `k${++n}`, T + dt, 1, 1, p, outcome, lostAtt, lostDef, loot, T + dt);

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

  // players: the members (by name), two enemies and an ally of the own in-game alliance
  const ally = Number(db.prepare("INSERT INTO alliances (group_id, name, tag) VALUES (?, 'Own', 'OWN')").run(group).lastInsertRowid);
  const player = (name: string, allianceId: number | null) =>
    Number(db.prepare('INSERT INTO players (group_id, name, alliance_id) VALUES (?, ?, ?)').run(group, name, allianceId).lastInsertRowid);
  const carolP = player('carol', ally);
  const daveP = player('dave', ally);
  const enemy1 = player('Enemy1', null);
  const enemy2 = player('Enemy2', null);
  const friend = player('Friend', ally);
  // planets at 1:1:p owned by the enemies (1, 2) and the ally (3)
  [enemy1, enemy2, friend].forEach((id, i) => db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id) VALUES (?, 1, 1, ?, 'x', ?)").run(group, i + 1, id));

  // statistics: carol leads fleet and total, dave research and buildings (a later update overrides the first)
  const snap = (type: number, time: number) =>
    Number(db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', ?, ?)").run(group, type, time).lastInsertRowid);
  const score = (s: number, playerId: number, points: number, type: number, time: number) =>
    db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points, type, stat_time) VALUES (?, ?, 1, ?, ?, ?)').run(s, playerId, points, type, time);
  for (const [type, c, d] of [[1, 5000, 4000], [2, 3000, 1000], [3, 100, 900], [4, 800, 2000]]) {
    const s = snap(type, T);
    score(s, carolP, c, type, T);
    score(s, daveP, d, type, T);
  }
  // fleet: dave overtakes in a later update
  const later = snap(2, T + 1000);
  score(later, daveP, 3500, 2, T + 1000);

  // carol: two wins with losses for the enemy, a farm run (enemy lost nothing), one more win; a defeat against the ally
  // does not break her streak
  fight(carolId, 1, 'win', 100, 5000, 20000);
  fight(carolId, 2, 'win', 0, 3000, 10000);
  fight(carolId, 1, 'win', 0, 0, 500);
  fight(carolId, 3, 'lose', 2000, 0, 0);
  fight(carolId, 2, 'win', 0, 1000, 1000);
  // dave: a win, a defeat against an enemy breaks it, then two wins; loses a lot, attacks only one player
  fight(daveId, 1, 'win', 0, 100, 100);
  fight(daveId, 1, 'lose', 9000, 0, 0);
  fight(daveId, 1, 'win', 0, 200, 200);
  fight(daveId, 1, 'draw', 50, 50, 0);
  fight(daveId, 1, 'win', 0, 300, 50000);
});

describe('rank badge', () => {
  const ctx = () => resolveGroup(db, { id: carolId, username: 'carol', isAdmin: false } as never, getUniverse(db, 'u8'), group);

  it('gives each condition to its leader', () => {
    const ranks = ranksAt(db, ctx(), [carolId, daveId], [T + 10_000]).get(T + 10_000)!;
    const c = ranks.get(carolId)!;
    const d = ranks.get(daveId)!;
    expect(c.values).toMatchObject({ totalPoints: 5000, fleetPoints: 3000, unitsDestroyed: 9000, unitsLost: 2100, resources: 31500, winStreak: 3, playersAttacked: 2 });
    expect(d.values).toMatchObject({ fleetPoints: 3500, unitsDestroyed: 650, unitsLost: 9050, resources: 50300, winStreak: 2, playersAttacked: 1 });
    // 31500 / 2100 = 15 against 50300 / 9050 ≈ 5.56
    expect(c.values.profitRatio).toBe(15);
    expect(c.holds.sort()).toEqual(['playersAttacked', 'profitRatio', 'totalPoints', 'unitsDestroyed', 'winStreak']);
    expect(d.holds.sort()).toEqual(['buildingPoints', 'fleetPoints', 'researchPoints', 'resources', 'unitsLost']);
    expect(c.points).toBe(5);
    expect(d.points).toBe(5);
  });

  it('looks only at the data before the end', () => {
    // before dave's later fleet update and before most battles
    const ranks = ranksAt(db, ctx(), [carolId, daveId], [T + 3]).get(T + 3)!;
    expect(ranks.get(carolId)!.holds).toContain('fleetPoints');
    expect(ranks.get(carolId)!.values.winStreak).toBe(2);
  });

  it('shares a tie and leaves a condition nobody has open', () => {
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(group, Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('erin', 'x')").run().lastInsertRowid));
    const erin = db.prepare("SELECT id FROM users WHERE username = 'erin'").pluck().get() as number;
    const ranks = ranksAt(db, ctx(), [carolId, daveId, erin], [T + 10_000]).get(T + 10_000)!;
    expect(ranks.get(erin)!.points).toBe(0);
    // carol catches up in research: both hold it
    const carolP = db.prepare("SELECT id FROM players WHERE group_id = ? AND name = 'carol'").pluck().get(group) as number;
    const s = Number(db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 3, ?)").run(group, T + 5000).lastInsertRowid);
    db.prepare('INSERT INTO player_scores (snapshot_id, player_id, rank, points, type, stat_time) VALUES (?, ?, 1, 900, 3, ?)').run(s, carolP, T + 5000);
    const tie = ranksAt(db, ctx(), [carolId, daveId], [T + 6000]).get(T + 6000)!;
    expect(tie.get(carolId)!.holds).toContain('researchPoints');
    expect(tie.get(daveId)!.holds).toContain('researchPoints');
  });

  it('is part of the achievements and the recap', async () => {
    const res = await app.inject({ method: 'GET', url: '/hub/api/u8/achievements', headers: carol });
    expect(res.statusCode).toBe(200);
    const me = res.json().members.find((m: { userId: number }) => m.userId === carolId);
    expect(me.rank.points).toBeGreaterThan(0);
    const recap = await app.inject({ method: 'GET', url: '/hub/api/u8/recap?period=start', headers: carol });
    expect(recap.statusCode).toBe(200);
    expect(Array.isArray(recap.json().ranks)).toBe(true);
  });
});
