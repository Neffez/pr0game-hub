import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const t = now();
let group = 0;
const ids: Record<string, number> = {};
const headers: Record<string, Record<string, string>> = {};

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: 'pass1234' } });
  return { cookie: `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`, 'x-hub-group': String(group) };
}

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('root', hashPassword('pass1234'));
  const root = { headers: { cookie: (await login('root')).cookie } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...root });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...root })).json().id;
  for (const [name, role] of [['lead', 'admin'], ['busy', 'member'], ['slow', 'member'], ['gone', 'member']] as const) {
    ids[name] = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, hashPassword('pass1234')).lastInsertRowid);
    db.prepare('INSERT INTO group_members (group_id, user_id, role, ingame_name, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(group, ids[name], role, name, name === 'gone' ? t - 5 * 86400 : t - 600);
    headers[name] = await login(name);
  }
  // statistics: two updates a week apart (lead and busy grow, slow barely), gone has none
  const player = (name: string) => Number(db.prepare('INSERT INTO players (group_id, name) VALUES (?, ?)').run(group, name).lastInsertRowid);
  const pid = { lead: player('lead'), busy: player('busy'), slow: player('slow') };
  for (const [time, pts] of [[t - 8 * 86400, { lead: 1000, busy: 1000, slow: 1000 }], [t - 3600, { lead: 1600, busy: 1800, slow: 1050 }]] as const) {
    const snap = Number(db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 1, ?)").run(group, time).lastInsertRowid);
    for (const [name, p] of Object.entries(pts)) {
      db.prepare('INSERT INTO player_scores (snapshot_id, player_id, type, stat_time, points, rank) VALUES (?, ?, 1, ?, ?, 1)').run(snap, pid[name as keyof typeof pid], time, p);
    }
  }
  // syncs: busy pasted an empire page today, slow four days ago; raw pages of statistics
  const empire = JSON.stringify({ kind: 'empire', research: {}, planets: [] });
  db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, ids.busy, t - 3600, empire);
  db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, ids.slow, t - 4 * 86400, empire);
  db.prepare("INSERT INTO raw_ingests (group_id, user_id, source, page_type, created_at) VALUES (?, ?, 'paste', 'stats', ?)").run(group, ids.busy, t - 7200);
  db.prepare(
    `INSERT INTO battle_reports (group_id, user_id, dedupe_key, g, s, p, planet_type, time, lost_attacker, lost_defender, loot_metal, loot_crystal, loot_deuterium, debris_metal, debris_crystal)
     VALUES (?, ?, 'b1', 1, 1, 1, 'planet', ?, 0, 0, 1000, 500, 100, 0, 0)`,
  ).run(group, ids.busy, t - 86400);
  db.prepare("INSERT INTO expeditions (group_id, user_id, dedupe_key, time, g, s, p, event, size) VALUES (?, ?, 'e1', ?, 1, 1, 16, 'Res', 'Small')").run(group, ids.busy, t - 86400);
});

describe('alliance health', () => {
  it('is for every member; a hidden online status stays hidden from the others', async () => {
    db.prepare('UPDATE users SET show_online = 0 WHERE id = ?').run(ids.gone);
    const res = await app.inject({ method: 'GET', url: '/hub/api/u8/alliance-health', headers: headers.busy });
    expect(res.statusCode).toBe(200);
    const gone = res.json().members.find((m: any) => m.name === 'gone');
    expect(gone).toMatchObject({ lastSeen: null, onlineHidden: true });
    expect(gone.flags).toEqual(['noEmpire', 'noStats']);
    // the alliance admin still sees it
    const lead = (await app.inject({ method: 'GET', url: '/hub/api/u8/alliance-health', headers: headers.lead })).json().members.find((m: any) => m.name === 'gone');
    expect(lead).toMatchObject({ lastSeen: t - 5 * 86400, onlineHidden: false });
    db.prepare('UPDATE users SET show_online = 1 WHERE id = ?').run(ids.gone);
  });

  it('shows growth against the median, syncs, activity and flags per member', async () => {
    const res = await app.inject({ method: 'GET', url: '/hub/api/u8/alliance-health', headers: headers.lead });
    expect(res.statusCode).toBe(200);
    const h = res.json();
    expect(h.medianGrowth).toBe(600);
    const by = Object.fromEntries(h.members.map((m: any) => [m.name, m]));
    expect(by.busy).toMatchObject({ points: 1800, growth: 800, partial: false, battles: 1, loot: 1600, expeditions: 1, flags: [] });
    expect(by.busy.syncs).toMatchObject({ empire: t - 3600, stats: t - 7200 });
    // slow pasted an empire page four days ago: outdated, not missing
    expect(by.slow.flags).toEqual(['behind', 'staleEmpire']);
    expect(by.lead.flags).toEqual(['noEmpire']);
    expect(by.gone).toMatchObject({ points: null, growth: null });
    expect(by.gone.flags).toEqual(['noEmpire', 'noStats', 'away']);
  });
});
