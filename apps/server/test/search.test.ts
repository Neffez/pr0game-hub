import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let group = 0;
let other = 0;
let carol: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const search = async (q: string, groupId = group) =>
  (await app.inject({ method: 'GET', url: `/hub/api/u8/search?q=${encodeURIComponent(q)}`, headers: { ...carol, 'x-hub-group': String(groupId) } })).json();

function player(groupId: number, name: string, allianceId: number | null, lastSeen: number) {
  return Number(db.prepare('INSERT INTO players (group_id, name, alliance_id, last_seen) VALUES (?, ?, ?, ?)').run(groupId, name, allianceId, lastSeen).lastInsertRowid);
}

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  other = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, ...h })).json().id;
  for (const g of [group, other]) db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(g, carolId);
  carol = { cookie: await login('carol', 'carolpass') };

  const ally = Number(db.prepare("INSERT INTO alliances (group_id, name, tag) VALUES (?, 'Die Gilde', 'GLD')").run(group).lastInsertRowid);
  db.prepare("INSERT INTO alliances (group_id, name, tag) VALUES (?, 'Gilde der Nacht', 'GDN')").run(group);
  const max = player(group, 'Maximus', ally, 100);
  player(group, 'Max', null, 50);
  player(group, 'Admax', null, 200);
  const renamed = player(group, 'Neo', null, 10);
  db.prepare("INSERT INTO player_aliases (player_id, name, seen_until) VALUES (?, 'Maxi', 5)").run(renamed);
  db.prepare("INSERT INTO planets (group_id, g, s, p, name, player_id, has_moon, moon_name) VALUES (?, 1, 120, 8, 'Heimat', ?, 1, 'Mond')").run(group, max);
  player(other, 'Maxwell', null, 300);
});

describe('global search', () => {
  it('finds players by name and former name: exact, then starting with it, then the most recently seen', async () => {
    const res = await search('max');
    expect(res.players.map((p: any) => p.name)).toEqual(['Max', 'Maximus', 'Admax', 'Neo']);
    expect(res.players[1]).toMatchObject({ ally_tag: 'GLD', alias: null, status: [] });
    expect(res.players.find((p: any) => p.name === 'Neo').alias).toBe('Maxi');
    expect(res.planet).toBeNull();
  });

  it('finds alliances by tag and name', async () => {
    expect((await search('gld')).alliances.map((a: any) => a.name)).toEqual(['Die Gilde']);
    expect((await search('gilde')).alliances.map((a: any) => [a.tag, a.players])).toEqual([
      ['GLD', 1],
      ['GDN', 0],
    ]);
  });

  it('resolves coordinates to the planet and its owner', async () => {
    expect((await search('[1:120:8]')).planet).toMatchObject({ g: 1, s: 120, p: 8, name: 'Heimat', has_moon: true, moon_name: 'Mond', player_name: 'Maximus', ally_tag: 'GLD' });
    expect((await search('2:5:3')).planet).toEqual({ g: 2, s: 5, p: 3 });
  });

  it('needs two characters and stays inside the group', async () => {
    expect(await search('m')).toEqual({ players: [], alliances: [], planet: null });
    expect((await search('max', other)).players.map((p: any) => p.name)).toEqual(['Maxwell']);
    expect((await search('1:120:8', other)).planet).toEqual({ g: 1, s: 120, p: 8 });
  });
});
