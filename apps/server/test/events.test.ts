import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { EventBus } = await import('../src/events.js');

const fixture = (name: string) =>
  readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let base = '';
let cookie = '';
let groupA = 0;
let groupB = 0;

/** Live stream of a group: collected events, `next()` waits for the next one. */
async function stream(group: number) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/hub/api/u8/events?group=${group}`, { headers: { cookie }, signal: ctrl.signal });
  const received: any[] = [];
  const waiting: ((e: any) => void)[] = [];
  (async () => {
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body!) {
        buf += decoder.decode(chunk as Uint8Array, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (!data) continue;
          const event = JSON.parse(data.slice(6));
          const w = waiting.shift();
          if (w) w(event);
          else received.push(event);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return {
    res,
    received,
    next: (ms = 2000) =>
      received.length
        ? Promise.resolve(received.shift())
        : new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('no event')), ms);
            waiting.push((e) => (clearTimeout(timer), resolve(e)));
          }),
    close: () => ctrl.abort(),
  };
}

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  const login = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'admin', password: 'adminpass' } });
  cookie = `hub_session=${login.cookies.find((c) => c.name === 'hub_session')!.value}`;
  const h = { headers: { cookie } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  groupB = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'B' }, ...h })).json().id;
});

afterAll(() => app.close());

describe('live events', () => {
  it('needs a session and a group membership', async () => {
    expect((await fetch(`${base}/hub/api/u8/events?group=${groupA}`)).status).toBe(401);
    const bus = new EventBus();
    expect(bus.connections(groupA, 1)).toBe(0);
  });

  it('pushes new data to the open streams of the group only', async () => {
    const a = await stream(groupA);
    const b = await stream(groupB);
    expect(a.res.headers.get('content-type')).toContain('text/event-stream');

    const ingest = (html: string) =>
      app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: { cookie, 'x-hub-group': String(groupA) }, payload: { html } });
    await ingest(fixture('galaxy.html'));
    const event = await a.next();
    expect(event).toMatchObject({ type: 'data', tables: ['galaxy_systems'], systems: ['1:234'], counts: { galaxy_systems: 1 } });
    expect(event.userId).toBeGreaterThan(0);

    // dry runs and pastes without anything new: no event
    await app.inject({
      method: 'POST', url: '/hub/api/u8/ingest', headers: { cookie, 'x-hub-group': String(groupA) }, payload: { html: fixture('stats-player.html'), dryRun: true },
    });
    await ingest(fixture('stats-player.html'));
    expect((await a.next()).tables).toEqual(['player_scores']);
    await ingest(fixture('stats-player.html'));
    await new Promise((r) => setTimeout(r, 100));
    expect(a.received).toEqual([]);
    expect(b.received).toEqual([]);
    a.close();
    b.close();
  });

  it('lists synced systems only up to a limit', () => {
    const bus = new EventBus();
    const got: any[] = [];
    bus.subscribe(1, { userId: 1, send: (e) => got.push(e) });
    const many = Array.from({ length: 51 }, (_, i) => `1:${i + 1}`);
    bus.publishIngest(1, 1, { galaxy_systems: { new: 51 } }, many);
    bus.publishIngest(1, 1, { galaxy_systems: { new: 1 } }, null);
    bus.publishIngest(1, 1, { spy_reports: { new: 0 } }, []);
    expect(got.map((e) => e.systems)).toEqual([undefined, undefined]);
  });
});
