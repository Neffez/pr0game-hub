import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const t = now();
let group = 0;
let other = 0;
let headers: Record<string, string>;

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('root', hashPassword('pass1234'));
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'root', password: 'pass1234' } });
  const cookie = `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: { cookie } });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: { cookie } })).json().id;
  other = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, headers: { cookie } })).json().id;
  headers = { cookie, 'x-hub-group': String(group) };
  const ally = Number(db.prepare("INSERT INTO alliances (group_id, name, tag) VALUES (?, 'Die \"Großen\"; Allianz', 'DGA')").run(group).lastInsertRowid);
  const p = Number(db.prepare("INSERT INTO players (group_id, name, alliance_id, status) VALUES (?, 'Alpha', ?, '[\"inactive\"]')").run(group, ally).lastInsertRowid);
  db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Fremd')").run(other);
  const snap = Number(db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 1, ?)").run(group, t - 600).lastInsertRowid);
  db.prepare('INSERT INTO player_scores (snapshot_id, player_id, type, stat_time, points, rank) VALUES (?, ?, 1, ?, 12345, 7)').run(snap, p, t - 600);
  db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id, has_moon, debris) VALUES (?, 1, 2, 3, 'Heim', ?, 1, ?)").run(group, p, JSON.stringify({ metal: '1.2K', crystal: '300' }));
  const spy = db.prepare("INSERT INTO spy_reports (group_id, g, s, p, planet_type, player_name, report_time, sections) VALUES (?, 1, 2, 3, 'planet', 'Alpha', ?, ?)");
  spy.run(group, t - 3600, JSON.stringify({ 900: { 901: 100, 902: 50, 903: 10 } }));
  spy.run(group, t - 40 * 86400, JSON.stringify({ 900: { 901: 1, 902: 1, 903: 1 } }));
});

describe('export', () => {
  it('downloads one dataset as CSV with the newest scores and quoted cells', async () => {
    const res = await app.inject({ method: 'GET', url: '/hub/api/u8/export/players.csv?sep=semicolon', headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="u8-players.csv"');
    const [head, row, ...rest] = res.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(rest).toEqual([]);
    expect(head.split(';').slice(0, 8)).toEqual(['id', 'ingame_id', 'name', 'alliance_tag', 'alliance', 'status', 'points_1', 'rank_1']);
    expect(row).toContain(';Alpha;DGA;"Die ""Großen""; Allianz";inactive;12345;7;');
  });

  it('keeps reports to the asked days and the group', async () => {
    const csv = (await app.inject({ method: 'GET', url: '/hub/api/u8/export/spy-reports', headers })).body.trim().split('\r\n');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toMatch(/^\d+,1,2,3,planet,,Alpha,100,50,10,/);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/export/spy-reports?days=60', headers })).body.trim().split('\r\n')).toHaveLength(3);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/export/spy-reports?days=0', headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/export/secrets', headers })).statusCode).toBe(404);
  });

  it('applies the overview filters to the players and planets tables', async () => {
    const beta = Number(db.prepare("INSERT INTO players (group_id, name, status) VALUES (?, 'Beta', '[\"vacation\"]')").run(group).lastInsertRowid);
    db.prepare("INSERT INTO planets (group_id, player_id, g, s, p, name) VALUES (?, ?, 2, 7, 7, 'Betaheim')").run(group, beta);
    const names = async (dataset: string, query: string, col: number) =>
      (await app.inject({ method: 'GET', url: `/hub/api/u8/export/${dataset}?${query}`, headers })).body.replace(/^\uFEFF/, '').trim().split('\r\n').slice(1).map((r) => r.split(',')[col]);
    expect(await names('players', '', 2)).toEqual(['Alpha', 'Beta']);
    expect(await names('players', 'inactive=hide', 2)).toEqual(['Beta']);
    expect(await names('players', 'inactive=only', 2)).toEqual(['Alpha']);
    expect(await names('players', 'vacation=0', 2)).toEqual(['Alpha']);
    expect(await names('players', 'q=ET', 2)).toEqual(['Beta']);
    expect(await names('players', 'ally=dga', 2)).toEqual(['Alpha']);
    expect(await names('players', 'minPoints=1', 2)).toEqual(['Alpha']);
    // planets follow their owner and the galaxy
    expect(await names('planets', 'q=beta', 4)).toEqual(['Beta']);
    expect(await names('planets', 'galaxy=2', 4)).toEqual(['Beta']);
    expect(await names('planets', 'galaxy=2&vacation=0', 4)).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/export/players?inactive=maybe', headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/export/players?minPoints=x', headers })).statusCode).toBe(400);
    db.prepare('DELETE FROM planets WHERE player_id = ?').run(beta);
    db.prepare('DELETE FROM players WHERE id = ?').run(beta);
  });

  it('exports everything as JSON objects', async () => {
    const res = await app.inject({ method: 'GET', url: '/hub/api/u8/export', headers });
    const all = JSON.parse(res.body);
    expect(Object.keys(all)).toEqual(['universe', 'group', 'exportedAt', 'since', 'players', 'planets', 'spy-reports', 'battle-reports', 'expeditions', 'settlements']);
    expect(all.players.map((p: any) => p.name)).toEqual(['Alpha']);
    expect(all.planets[0]).toMatchObject({ galaxy: 1, system: 2, position: 3, name: 'Heim', player: 'Alpha', moon: true, debris_metal: 1200, debris_crystal: 300 });
  });
});
