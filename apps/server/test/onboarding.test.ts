import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');
let group = 0;
let carolId = 0;
let admin: Record<string, string>;
let carol: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const cookie = await login('admin', 'adminpass');
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: { cookie } });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: { cookie } })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  admin = { cookie, 'x-hub-group': String(group) };
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
});

describe('onboarding checklist (D-4)', () => {
  it('ticks a step when the member syncs such a page', async () => {
    let list = (await app.inject({ method: 'GET', url: '/hub/api/u8/onboarding', headers: carol })).json();
    expect(list).toMatchObject({ done: 0, total: 7 });
    expect(list.steps.map((s: any) => s.key)).toEqual(['empire', 'stats', 'overview', 'research', 'galaxy', 'messages', 'buildings']);

    // a dry run counts for nothing
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload: { text: fixture('messages.txt'), dryRun: true } });
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/onboarding', headers: carol })).json().done).toBe(0);

    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload: { text: fixture('messages.txt') } });
    expect(res.json().pageType).toBe('messages');
    list = (await app.inject({ method: 'GET', url: '/hub/api/u8/onboarding', headers: carol })).json();
    expect(list.done).toBe(1);
    expect(list.steps.find((s: any) => s.key === 'messages').time).toBeGreaterThan(0);
  });

  it('shows the alliance admin who did which step', async () => {
    const members = (await app.inject({ method: 'GET', url: `/hub/api/admin/groups/${group}/members`, headers: admin })).json();
    expect(members.find((m: any) => m.id === carolId).onboarding).toEqual(['messages']);
  });
});
