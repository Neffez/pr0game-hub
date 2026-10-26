import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { EventBus, TAB_TTL_MS } = await import('../src/events.js');

const fixture = (name: string) =>
  readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let base = '';
let cookie = '';
let groupA = 0;
let groupB = 0;

/** Live stream of a group: collected events, `next()` waits for the next one. */
async function stream(group: number, as = cookie) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/hub/api/u8/events?group=${group}`, { headers: { cookie: as }, signal: ctrl.signal });
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
  const next = (ms = 2000): Promise<any> =>
    received.length
      ? Promise.resolve(received.shift())
      : new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no event')), ms);
          waiting.push((e) => (clearTimeout(timer), resolve(e)));
        });
  return {
    res,
    received,
    /** next event of a type (others are skipped) */
    nextOf: async (type: string) => {
      for (;;) {
        const e = await next();
        if (e.type === type) return e;
      }
    },
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

// fetch keeps a spare connection open that never sends a request: closing would wait for it
afterAll(async () => {
  const closing = app.close();
  app.server.closeAllConnections();
  await closing;
});

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
    const event = await a.nextOf('data');
    expect(event).toMatchObject({ type: 'data', tables: ['galaxy_systems'], systems: ['1:234'], counts: { galaxy_systems: 1 } });
    expect(event.userId).toBeGreaterThan(0);

    // dry runs and pastes without anything new: no event
    await app.inject({
      method: 'POST', url: '/hub/api/u8/ingest', headers: { cookie, 'x-hub-group': String(groupA) }, payload: { html: fixture('stats-player.html'), dryRun: true },
    });
    await ingest(fixture('stats-player.html'));
    expect((await a.nextOf('data')).tables).toEqual(['player_scores']);
    await ingest(fixture('stats-player.html'));
    // other changes than syncs: player notes
    const player = db.prepare('SELECT id FROM players WHERE group_id = ? LIMIT 1').pluck().get(groupA);
    await app.inject({ method: 'PUT', url: `/hub/api/u8/players/${player}/note`, headers: { cookie, 'x-hub-group': String(groupA) }, payload: { note: 'farm' } });
    expect((await a.nextOf('data')).tables).toEqual(['players']);
    await new Promise((r) => setTimeout(r, 100));
    expect(a.received.filter((e) => e.type === 'data')).toEqual([]);
    expect(b.received.filter((e) => e.type === 'data')).toEqual([]);
    a.close();
    b.close();
  });

  it('leaves out who synced when the member does not share it', async () => {
    const headers = { cookie, 'x-hub-group': String(groupA) };
    const a = await stream(groupA);
    expect((await app.inject({ method: 'POST', url: '/hub/api/auth/share-syncs', headers: { cookie }, payload: { enabled: false } })).json()).toEqual({ enabled: false });
    expect((await app.inject({ method: 'GET', url: '/hub/api/auth/share-syncs', headers: { cookie } })).json()).toEqual({ enabled: false });
    await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers, payload: { html: fixture('stats-alliance.html') } });
    const event = await a.nextOf('data');
    expect(event.tables).toEqual(['alliance_scores']);
    expect(event.userId).toBeUndefined();
    await app.inject({ method: 'POST', url: '/hub/api/auth/share-syncs', headers: { cookie }, payload: { enabled: true } });
    a.close();
  });

  it('shows who is online and where, and when a member was last online', async () => {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass'));
    const carolId = db.prepare("SELECT id FROM users WHERE username = 'carol'").pluck().get() as number;
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupA, carolId);
    const login = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'carol', password: 'carolpass' } });
    const carol = `hub_session=${login.cookies.find((c) => c.name === 'hub_session')!.value}`;

    const a = await stream(groupA);
    const online = async () => (await a.nextOf('presence')).members.map((m: any) => m.userId).sort();
    const adminId = (await online())[0];
    const c = await stream(groupA, carol);
    expect(await online()).toEqual([adminId, carolId].sort());

    await app.inject({
      method: 'POST', url: '/hub/api/u8/presence', headers: { cookie: carol, 'x-hub-group': String(groupA) },
      payload: { page: 'browse', g: 1, s: 234, player: 'x', active: false },
    });
    const moved = (await a.nextOf('presence')).members.find((m: any) => m.userId === carolId);
    expect(moved).toEqual({ userId: carolId, page: 'browse', g: 1, s: 234, active: false });
    const list = await app.inject({ method: 'GET', url: '/hub/api/u8/presence', headers: { cookie, 'x-hub-group': String(groupA) } });
    expect(list.json()).toHaveLength(2);
    // another group doesn't learn about it
    expect((await app.inject({ method: 'GET', url: '/hub/api/u8/presence', headers: { cookie, 'x-hub-group': String(groupB) } })).json()).toEqual([]);

    c.close();
    expect(await online()).toEqual([adminId]);
    const ctx = (await app.inject({ method: 'GET', url: '/hub/api/u8/context', headers: { cookie, 'x-hub-group': String(groupA) } })).json();
    expect(ctx.members.find((m: any) => m.id === carolId).last_seen_at).toBeGreaterThan(0);
    a.close();
  });

  it('hides online status from other members when disabled', async () => {
    if (!db.prepare("SELECT 1 FROM users WHERE username = 'carol'").get()) {
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass'));
      const carolId = db.prepare("SELECT id FROM users WHERE username = 'carol'").pluck().get() as number;
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupA, carolId);
    }
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dave', hashPassword('davepass'));
    const daveId = db.prepare("SELECT id FROM users WHERE username = 'dave'").pluck().get() as number;
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupA, daveId);
    const daveLogin = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'dave', password: 'davepass' } });
    const dave = { cookie: `hub_session=${daveLogin.cookies.find((c) => c.name === 'hub_session')!.value}`, 'x-hub-group': String(groupA) };

    const carolLogin = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username: 'carol', password: 'carolpass' } });
    const carol = { cookie: `hub_session=${carolLogin.cookies.find((c) => c.name === 'hub_session')!.value}`, 'x-hub-group': String(groupA) };
    const carolId = db.prepare("SELECT id FROM users WHERE username = 'carol'").pluck().get() as number;

    const daveStream = await stream(groupA, dave.cookie);
    const carolStream = await stream(groupA, carol.cookie);
    await daveStream.nextOf('presence');
    await carolStream.nextOf('presence');

    await app.inject({
      method: 'POST', url: '/hub/api/auth/show-online', headers: carol,
      payload: { enabled: false },
    });
    const daveList = (await app.inject({ method: 'GET', url: '/hub/api/u8/presence', headers: dave })).json();
    expect(daveList.map((m: any) => m.userId)).not.toContain(carolId);

    const carolList = (await app.inject({ method: 'GET', url: '/hub/api/u8/presence', headers: carol })).json();
    expect(carolList.map((m: any) => m.userId)).toContain(carolId);

    const adminList = (await app.inject({ method: 'GET', url: '/hub/api/u8/presence', headers: { cookie, 'x-hub-group': String(groupA) } })).json();
    expect(adminList.map((m: any) => m.userId)).toContain(carolId);

    // visible but not sharing the activity: others lose the page, carol and the admin keep it
    await app.inject({ method: 'POST', url: '/hub/api/auth/show-online', headers: carol, payload: { enabled: true } });
    await app.inject({ method: 'POST', url: '/hub/api/u8/presence', headers: { cookie: carol.cookie, 'x-hub-group': String(groupA) }, payload: { page: 'browse', active: true } });
    await app.inject({ method: 'POST', url: '/hub/api/auth/share-activity', headers: carol, payload: { enabled: false } });
    const pageOf = async (h: object) =>
      (await app.inject({ method: 'GET', url: '/hub/api/u8/presence', headers: h })).json().find((m: any) => m.userId === carolId)?.page;
    expect(await pageOf(dave)).toBeNull();
    expect(await pageOf(carol)).toBe('browse');
    expect(await pageOf({ cookie, 'x-hub-group': String(groupA) })).toBe('browse');

    daveStream.close();
    carolStream.close();
  });

  it('lists synced systems only up to a limit', () => {
    const bus = new EventBus();
    const got: any[] = [];
    bus.subscribe(1, { userId: 1, isAdmin: false, send: (e) => got.push(e) });
    const many = Array.from({ length: 51 }, (_, i) => `1:${i + 1}`);
    bus.publishIngest(1, 1, { galaxy_systems: { new: 51 } }, many);
    bus.publishIngest(1, 1, { galaxy_systems: { new: 1 } }, null);
    bus.publishIngest(1, 1, { spy_reports: { new: 0 } }, []);
    expect(got.filter((e) => e.type === 'data').map((e) => e.systems)).toEqual([undefined, undefined]);
  });

  it('keeps a bounded number of tabs per member', () => {
    const bus = new EventBus();
    bus.subscribe(1, { userId: 7, isAdmin: false, send: () => {} });
    bus.setWhereabouts(1, 7, { page: 'overview', active: true }, { id: 'real', focused: true });
    for (let i = 0; i < 1000; i++) bus.setWhereabouts(1, 7, { page: 'browse', active: false }, { id: `fake-${i}` });
    const tabs = (bus as any).tabs.get(1).get(7) as Map<string, unknown>;
    expect(tabs.size).toBe(20);
    expect(tabs.has('real')).toBe(false);
    expect(bus.stats()).toEqual({ connections: 1, users: [7] });
  });

  it('shows the tab in use of a member with several tabs or devices', () => {
    let clock = 1_000_000;
    const bus = new EventBus(() => clock);
    const got: any[] = [];
    bus.subscribe(1, { userId: 7, isAdmin: false, send: (e) => got.push(e) });
    const page = () => bus.presence(1)[0];

    bus.setWhereabouts(1, 7, { page: 'overview', active: true }, { id: 'b', focused: true });
    // the raid planner tab goes to the background after the other got the focus: it doesn't take over
    bus.setWhereabouts(1, 7, { page: 'raid-planner', active: false }, { id: 'a' });
    expect(page()).toMatchObject({ page: 'overview', active: true });

    // visible but not focused (second window): the focused tab stays, whatever reported last
    bus.setWhereabouts(1, 7, { page: 'raid-planner', active: true }, { id: 'a', focused: false });
    expect(page().page).toBe('overview');
    // the user turns to it
    bus.setWhereabouts(1, 7, { page: 'raid-planner', active: true }, { id: 'a', focused: true });
    expect(page().page).toBe('raid-planner');
    // and back: the latest focus wins
    bus.setWhereabouts(1, 7, { page: 'overview', active: true }, { id: 'b', focused: true });
    expect(page().page).toBe('overview');

    // idle in every tab: away, at the latest report
    bus.setWhereabouts(1, 7, { page: 'raid-planner', active: false }, { id: 'a' });
    bus.setWhereabouts(1, 7, { page: 'overview', active: false }, { id: 'b' });
    expect(page()).toMatchObject({ page: 'overview', active: false });

    // closed: the other tab again
    bus.closeTab(1, 7, 'b');
    expect(page().page).toBe('raid-planner');
    const events = got.filter((e) => e.type === 'presence').length;
    // the same place again: no event
    bus.setWhereabouts(1, 7, { page: 'raid-planner', active: false }, { id: 'a' });
    expect(got.filter((e) => e.type === 'presence').length).toBe(events);

    // a tab gone silent (closed without saying so) drops out
    clock += TAB_TTL_MS - 1;
    bus.setWhereabouts(1, 7, { page: 'stats', active: false }, { id: 'c' });
    clock += 2;
    expect(page().page).toBe('stats');
    clock += TAB_TTL_MS;
    expect(page()).toMatchObject({ page: null, active: true });
  });

  it('takes tab, focus and closing from the reports of a tab', async () => {
    const a = await stream(groupA);
    await a.nextOf('presence');
    const report = (payload: object) =>
      app.inject({ method: 'POST', url: '/hub/api/u8/presence', headers: { cookie, 'x-hub-group': String(groupA) }, payload });
    const mine = async () => (await app.inject({ method: 'GET', url: '/hub/api/u8/presence', headers: { cookie, 'x-hub-group': String(groupA) } })).json()[0];

    await report({ page: 'stats', active: true, tab: 'tab-1', focused: true });
    await report({ page: 'raid-planner', active: true, tab: 'tab-2', focused: false });
    expect(await mine()).toEqual({ userId: expect.any(Number), page: 'stats', active: true });
    expect((await report({ tab: 'tab-1', closed: true })).json()).toEqual({ ok: true });
    expect((await mine()).page).toBe('raid-planner');
    a.close();
  });
});
