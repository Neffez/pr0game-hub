import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let carolId = 0;
let carol: Record<string, string>;
const t = now();

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = async (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url: `/hub/api/u8${url}`, headers: carol, payload });

const galaxy = (g: number, s: number, seen: number, rows: { p: number; debris?: [string, string]; playerId?: number }[]) => {
  db.prepare('INSERT OR REPLACE INTO galaxy_views (group_id, g, s, seen_at) VALUES (?, ?, ?, ?)').run(group, g, s, seen);
  for (const r of rows) {
    db.prepare('INSERT INTO planets (group_id, g, s, p, player_id, debris, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      group, g, s, r.p, r.playerId ?? null, r.debris ? JSON.stringify({ metal: r.debris[0], crystal: r.debris[1] }) : null, seen,
    );
  }
};
const battle = (g: number, s: number, p: number, time: number, metal: number, crystal: number, reportId: string) => {
  for (const user of [carolId, null]) {
    // the same battle synced twice (two members): counted once
    db.prepare(
      `INSERT INTO battle_reports (group_id, user_id, dedupe_key, report_id, time, g, s, p, planet_type, lost_attacker, lost_defender,
         loot_metal, loot_crystal, loot_deuterium, debris_metal, debris_crystal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planet', 0, 0, 0, 0, 0, ?, ?)`,
    ).run(group, user, `${reportId}:${user}`, reportId, time, g, s, p, metal, crystal);
  }
};

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };

  const foe = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Foe')").run(group).lastInsertRowid);
  // 1:10:5 seen with debris, then a battle there: both add up
  galaxy(1, 10, t - 7200, [{ p: 5, debris: ['1.5M', '500K'], playerId: foe }, { p: 6, playerId: foe }]);
  battle(1, 10, 5, t - 3600, 200_000, 100_000, 'r1');
  // a battle before the galaxy view is already in it
  battle(1, 10, 6, t - 9000, 50_000, 50_000, 'r0');
  // 1:20:3 never seen in the galaxy: the battle alone
  battle(1, 20, 3, t - 600, 30_000, 10_000, 'r2');
  // 1:30:7 seen with debris, then a member recycled part of it (the exact rest)
  galaxy(1, 30, t - 5000, [{ p: 7, debris: ['100K', '0'] }]);
  db.prepare(
    "INSERT INTO activity_log (group_id, time, kind, g, s, p, data, dedupe_key) VALUES (?, ?, 'debris_shrunk', 1, 30, 7, ?, 'recycle:x1')",
  ).run(group, t - 1000, JSON.stringify({ metal: 40_000, crystal: 0, before: { metal: 100_000, crystal: 0 }, collected: { metal: 60_000, crystal: 0 }, by: 'Carol' }));
  // 1:40:1 recycled completely
  galaxy(1, 40, t - 5000, [{ p: 1, debris: ['20K', '0'] }]);
  db.prepare(
    "INSERT INTO activity_log (group_id, time, kind, g, s, p, data, dedupe_key) VALUES (?, ?, 'debris_cleared', 1, 40, 1, ?, 'recycle:x2')",
  ).run(group, t - 1000, JSON.stringify({ metal: 0, crystal: 0, before: { metal: 20_000, crystal: 0 }, by: 'Carol' }));
  // old debris (20 days)
  galaxy(2, 1, t - 20 * 86400, [{ p: 1, debris: ['5M', '0'] }]);
  // Carol's recyclers on her moon
  db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(
    group, carolId, t - 300,
    JSON.stringify({ kind: 'empire', research: { 115: 6 }, planets: [
      { name: 'Home', coords: { g: 1, s: 12, p: 8 }, type: 'planet', values: { 209: 0 } },
      { name: 'Mond', coords: { g: 1, s: 12, p: 8 }, type: 'moon', values: { 209: 40 } },
    ] }),
  );
});

describe('debris finder', () => {
  it('lists open debris fields with the debris expected now', async () => {
    const res = (await call('GET', '/debris')).json();
    expect(res.days).toBe(7);
    const byKey = Object.fromEntries(res.fields.map((f: any) => [`${f.g}:${f.s}:${f.p}`, f]));
    expect(Object.keys(byKey).sort()).toEqual(['1:10:5', '1:20:3', '1:30:7']);
    expect(byKey['1:10:5']).toMatchObject({
      metal: 1_700_000, crystal: 600_000, time: t - 3600,
      base: { source: 'galaxy', time: t - 7200 }, battles: [{ time: t - 3600, metal: 200_000, crystal: 100_000 }],
      owner: { name: 'Foe', member: false },
    });
    expect(byKey['1:20:3']).toMatchObject({ metal: 30_000, crystal: 10_000, base: null, owner: null });
    expect(byKey['1:30:7']).toMatchObject({ metal: 40_000, base: { source: 'recycle', by: 'Carol', time: t - 1000 } });
    // largest first
    expect(res.fields[0].g + ':' + res.fields[0].s).toBe('1:10');
  });

  it('looks further back on request and returns the members\' recyclers', async () => {
    const res = (await call('GET', '/debris?days=30')).json();
    expect(res.fields.map((f: any) => `${f.g}:${f.s}:${f.p}`)).toContain('2:1:1');
    expect(res.capacity).toBe(20_000);
    expect(res.recyclers).toEqual([expect.objectContaining({ member: 'carol', g: 1, s: 12, p: 8, type: 'moon', recyclers: 40 })]);
    expect(res.recyclers[0].speed).toBeGreaterThan(2000);
  });

  it('takes recycling reports without the field totals by the recyclers still needed', async () => {
    galaxy(1, 50, t - 10 * 3600, [{ p: 1, debris: ['100K', '50K'] }, { p: 2, debris: ['200K', '100K'] }]);
    // game date in the member's time zone, three hours ago (after the galaxy view)
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date((t - 3 * 3600) * 1000))
        .map((x) => [x.type, x.value]),
    );
    const month = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][Number(parts.month) - 1];
    const date = `${Number(parts.day)}. ${month} ${parts.year}, ${parts.hour}:${parts.minute}:${parts.second}`;
    const text = [
      'Recyclerbericht', date,
      'Deine Recycler haben an den Koordinaten [1:50:1] 60.000 Metall und 30.000 Kristall von insgesamt  Metall und  Kristall gesammelt.',
      'Es werden 3 Recycler für das Trümmerfeld benötigt.',
      'Recyclerbericht', date,
      'Deine Recycler haben an den Koordinaten [1:50:2] 200.000 Metall und 100.000 Kristall von insgesamt  Metall und  Kristall gesammelt.',
      'Es werden 0 Recycler für das Trümmerfeld benötigt.',
    ].join('\n');
    const res = await call('POST', '/ingest', { text });
    expect(res.json().counts.recycle_reports).toEqual({ new: 2, duplicate: 0 });
    // the estimated field is stored, so a rebuild from the reports gives the same
    expect(db.prepare('SELECT g, s, p, total_metal, total_crystal FROM recycle_reports WHERE group_id = ? AND s = 50 ORDER BY p').all(group)).toEqual([
      { g: 1, s: 50, p: 1, total_metal: 100_000, total_crystal: 50_000 },
      { g: 1, s: 50, p: 2, total_metal: 200_000, total_crystal: 100_000 },
    ]);
    const fields = (await call('GET', '/debris')).json().fields.filter((f: any) => f.s === 50);
    // 3 recyclers still needed: 60,000 left, split like the collected debris; 1:50:2 emptied
    expect(fields).toEqual([expect.objectContaining({ g: 1, s: 50, p: 1, metal: 40_000, crystal: 20_000, base: expect.objectContaining({ source: 'recycle', by: 'carol' }) })]);
  });

  it('claims a debris field for recycling apart from the planet', async () => {
    const debris = await call('POST', '/claims', { g: 1, s: 10, p: 5, type: 'debris', kind: 'farm' });
    expect(debris.statusCode).toBe(200);
    const planet = await call('POST', '/claims', { g: 1, s: 10, p: 5, type: 'planet', kind: 'farm' });
    expect(planet.statusCode).toBe(200);
    const list = (await call('GET', '/claims')).json();
    expect(list.map((c: any) => `${c.planet_type}:${c.kind}`).sort()).toEqual(['debris:recycle', 'planet:farm']);
  });
});
