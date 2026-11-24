import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { syncNews } = await import('../src/repo/hubActivity.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');
let group = 0;
let other = 0;
let carolId = 0;
let bobId = 0;
let carol: Record<string, string>;
let bob: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = async (method: string, url: string, headers: Record<string, string>, payload?: object) => {
  const res = await app.inject({ method: method as 'GET', url: `/hub/api/u8${url}`, headers, payload });
  expect(res.statusCode).toBe(200);
  return res.json();
};
const activity = async (headers: Record<string, string>) => (await call('GET', '/hub-activity', headers)).entries as any[];

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  bobId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('bob', hashPassword('bobpass')).lastInsertRowid);
  const cookie = await login('admin', 'adminpass');
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: { cookie } });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: { cookie } })).json().id;
  other = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, headers: { cookie } })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Bob')").run(group, bobId);
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(other, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
  bob = { cookie: await login('bob', 'bobpass'), 'x-hub-group': String(group) };
});

describe('hub activity', () => {
  it('lists syncs that brought something new, bundled per member and kind', async () => {
    // the fixture has no page time: with the clock standing still the same view again is no newer one
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    try {
      await call('POST', '/ingest', carol, { html: fixture('galaxy.html') });
      await call('POST', '/ingest', carol, { html: fixture('galaxy.html') });
    } finally {
      vi.useRealTimers();
    }
    const entries = await activity(bob);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'sync', what: 'galaxy', user_id: carolId, member: 'carol', hidden: false, count: 1, items: ['1:234'] });
    // another group sees none of it
    expect(await activity({ ...carol, 'x-hub-group': String(other) })).toEqual([]);
  });

  it('names no member who hides their syncs, except to themselves', async () => {
    db.prepare('UPDATE users SET share_syncs = 0 WHERE id = ?').run(carolId);
    try {
      expect((await activity(bob))[0]).toMatchObject({ user_id: null, member: null, hidden: true, count: 1 });
      expect((await activity(carol))[0]).toMatchObject({ user_id: carolId, member: 'carol', hidden: false });
    } finally {
      db.prepare('UPDATE users SET share_syncs = 1 WHERE id = ?').run(carolId);
    }
  });

  it('lists comments, raid plans and target claims (not those of a plan, several in a row as one)', async () => {
    const player = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Victim')").run(group).lastInsertRowid);
    await call('POST', '/comments', bob, { player, body: 'Saves  his fleet\nat 3 am' });
    const claim = Number(
      db.prepare("INSERT INTO target_claims (group_id, user_id, g, s, p, planet_type, kind, expires_at) VALUES (?, ?, 2, 3, 4, 'planet', 'attack', unixepoch() + 3600)")
        .run(group, bobId).lastInsertRowid,
    );
    db.prepare("INSERT INTO attack_plans (group_id, user_id, g, s, p, planet_type, target_time, claim_id) VALUES (?, ?, 2, 3, 4, 'planet', unixepoch() + 3600, ?)").run(group, bobId, claim);
    const farm = db.prepare("INSERT INTO target_claims (group_id, user_id, g, s, p, planet_type, kind, expires_at) VALUES (?, ?, 1, 1, ?, 'planet', 'farm', unixepoch() + 3600)");
    farm.run(group, carolId, 5);
    farm.run(group, carolId, 6);

    const entries = await activity(bob);
    expect(entries.find((e) => e.kind === 'comment')).toMatchObject({ what: 'player', member: 'bob', text: 'Saves his fleet at 3 am', player_id: player, player_name: 'Victim' });
    expect(entries.find((e) => e.kind === 'plan')).toMatchObject({ what: 'attack', member: 'bob', g: 2, s: 3, p: 4 });
    const claims = entries.filter((e) => e.kind === 'claim');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ what: 'farm', member: 'carol', count: 2, items: ['1:1:5', '1:1:6'], g: null });
  });

  it('reads syncs saved before their news was kept from their counts', () => {
    const old = JSON.stringify({ counts: { spy_reports: { new: 2, duplicate: 1 }, empire: { new: 1, duplicate: 0 }, player_scores: { new: 0, duplicate: 3 } } });
    expect([...syncNews('html', old)]).toEqual([['spy', { n: 2, items: [] }]]);
    const json = JSON.stringify({ news: { galaxy_systems: { n: 40, items: ['1:1'] } } });
    expect([...syncNews('json', json)]).toEqual([['universe', { n: 40, items: [] }]]);
  });
});
