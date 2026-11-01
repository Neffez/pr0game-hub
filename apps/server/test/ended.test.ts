import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { step } = await import('../src/crawler.js');
const { pollBattleHall } = await import('../src/hallPoller.js');

const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let headers: Record<string, string>;

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'admin', password: 'adminpass' } });
  headers = { cookie: `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}` };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', headers, payload: { slug: 'u8', name: 'Universum 8' } });
  const group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', headers, payload: { universe: 'u8', name: 'A' } })).json().id;
  headers['x-hub-group'] = String(group);
});

const end = (ended: boolean) => app.inject({ method: 'PUT', url: '/hub/api/admin/universes/u8', headers, payload: { ended } });
const ingest = (html: string) => app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html } });

describe('ended universe', () => {
  it('is frozen at its end: readable, but nothing is written', async () => {
    const html = fixture('stats-player.html');
    expect((await ingest(html.replace('12:00:03', '06:00:03'))).statusCode).toBe(200);

    expect((await end(true)).statusCode).toBe(200);
    const ctx = (await app.inject({ method: 'GET', url: '/hub/api/u8/context', headers })).json();
    expect(ctx.universe.endedAt).toBeGreaterThan(0);
    const me = (await app.inject({ method: 'GET', url: '/hub/api/auth/me', headers })).json();
    expect(me.groups[0].universe_ended_at).toBe(ctx.universe.endedAt);

    // syncs and changes are refused, reads go on
    const refused = await ingest(html);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('universe_ended');
    const note = await app.inject({ method: 'PUT', url: '/hub/api/u8/players/1/note', headers, payload: { note: 'x' } });
    expect(note.json().code).toBe('universe_ended');
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/overview', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/stats?type=1', headers })).statusCode).toBe(200);
    // nothing is due any more; presence still works
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/notifications', headers })).json()).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/hub/api/u8/presence', headers, payload: { page: 'overview' } })).statusCode).toBe(200);

    // ending again keeps the original end
    await end(true);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/context', headers })).json().universe.endedAt).toBe(ctx.universe.endedAt);

    // reopened, it runs again
    expect((await end(false)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/context', headers })).json().universe.endedAt).toBeNull();
    expect((await ingest(html)).statusCode).toBe(200);
  });

  it('still archives the battle hall reports, but polls no new entries', async () => {
    const group = Number(headers['x-hub-group']);
    await app.inject({ method: 'PUT', url: '/hub/api/admin/universes/u8', headers, payload: { settings: { gameUrl: 'https://pr0game.com/uni8/' } } });
    db.prepare(`INSERT INTO battle_hall (group_id, report_id, time, attackers, defenders, units) VALUES (?, 'r1', 1, '[]', '[]', 1)`).run(group);
    await end(true);
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return { ok: true, text: async () => '<title>Info - Universum 8</title> Contact with the attacking fleet was lost (i.e. it was shot down in the first round).' };
    }) as unknown as typeof fetch;
    const log = { info() {}, warn() {}, error() {} } as never;
    expect(await step(db, log, fetcher)).toBe('done');
    expect(urls[0]).toContain('raport=r1');
    expect(await pollBattleHall(db, log, fetcher)).toEqual({});
    expect(urls).toHaveLength(1);
    await end(false);
  });
});
