import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { inQuiet, parseQuiet } = await import('../src/notify.js');

/** Notification rules (G-4): quiet hours per push device and Discord webhook, rules per kind, muted storages. */
type Push = { endpoint: string; payload: { title: string; body: string; url: string; tag: string } };
const pushed: Push[] = [];
const pushSender = vi.fn(async (target: { endpoint: string }, payload: string) => {
  pushed.push({ endpoint: target.endpoint, payload: JSON.parse(payload) });
  return 201;
});
type Message = { embeds: { title: string }[] };
const posted: { url: string; message: Message }[] = [];
const discordSender = vi.fn(async (url: string, message: Message) => {
  posted.push({ url, message });
  return { status: 204 };
});

const hook = (id: string) => `https://discord.com/api/webhooks/${id}/${'T'.repeat(68)}`;
const HOOK = { carol: hook('100000000000000001'), group: hook('100000000000000003') };
const PHONE = 'https://fcm.googleapis.com/fcm/send/phone';
const DESK = 'https://fcm.googleapis.com/fcm/send/desk';
const DAVE = 'https://fcm.googleapis.com/fcm/send/dave';

const db = openDb(':memory:');
const app = buildApp(db, { logger: false, push: { contact: 'mailto:hub@example.com', sender: pushSender, debounceMs: 50 }, discord: { sender: discordSender } });
let group = 0;
const ids: Record<string, number> = {};
const h: Record<string, Record<string, string>> = {};
/** 12:00 UTC of a fixed day for the clock checks */
const noon = Date.UTC(2031, 0, 15, 12, 0, 0) / 1000;
/** deliveries run now (comments carry the real time), with quiet hours around it */
const t = Math.floor(Date.now() / 1000);
const clock = (time: number) => new Date(time * 1000).toISOString().slice(11, 16);
const AROUND = { from: clock(t - 3600), to: clock(t + 3600), tz: 'UTC' };
const OVER = t + 3700;

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });
const subscribe = (who: string, endpoint: string) =>
  call('POST', '/push/subscriptions', h[who], { endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
const titles = (endpoint: string) => pushed.filter((s) => s.endpoint === endpoint).map((s) => s.payload.title);
const embeds = (url: string) => posted.filter((s) => s.url === url).flatMap((s) => s.message.embeds.map((e) => e.title));
const hostile = (mission: number, arrival: number, player = 'Raider', from = { g: 2, s: 100, p: 4 }) => ({
  owner: 'hostile', player, mission, missionName: mission === 6 ? 'Spionage' : 'Angreifen', phase: 'out', ships: { 204: 50 }, resources: null, arrival,
  from: { coords: from, type: 'planet', name: null }, to: { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: null },
});
const fleets = (who: string, time: number, list: object[]) => {
  db.prepare('DELETE FROM fleet_snapshots WHERE group_id = ? AND user_id = ?').run(group, ids[who]);
  db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(group, ids[who], time, JSON.stringify(list));
};

beforeAll(async () => {
  await app.ready();
  for (const name of ['admin', 'carol', 'dave']) {
    db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)').run(name, hashPassword(`${name}pass`), name === 'admin' ? 1 : 0);
    ids[name] = db.prepare('SELECT id FROM users WHERE username = ?').pluck().get(name) as number;
  }
  h.admin = { cookie: await login('admin') };
  await call('POST', '/admin/universes', h.admin, { slug: 'u8', name: 'Universum 8' });
  group = (await call('POST', '/admin/groups', h.admin, { universe: 'u8', name: 'A' })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name, role) VALUES (?, ?, 'Carol', 'admin')").run(group, ids.carol);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Dave')").run(group, ids.dave);
  h.carol = { cookie: await login('carol'), 'x-hub-group': String(group) };
  h.dave = { cookie: await login('dave'), 'x-hub-group': String(group) };
  await subscribe('carol', PHONE);
  await subscribe('carol', DESK);
  await subscribe('dave', DAVE);
});

beforeEach(() => {
  pushed.length = 0;
  posted.length = 0;
  db.prepare('DELETE FROM fleet_snapshots WHERE group_id = ?').run(group);
});

describe('quiet hours', () => {
  it('validates them and knows when they apply, also over midnight and in the device time zone', () => {
    expect(parseQuiet(null)).toBeNull();
    expect(parseQuiet({ from: '23:00', to: '07:00', tz: 'Europe/Berlin' })).toEqual({ from: '23:00', to: '07:00', tz: 'Europe/Berlin', except: ['attackSelf', 'launch', 'fleets'] });
    expect(parseQuiet({ from: '23:00', to: '23:00', tz: 'UTC' })).toBeUndefined();
    expect(parseQuiet({ from: '25:00', to: '07:00', tz: 'UTC' })).toBeUndefined();
    expect(parseQuiet({ from: '23:00', to: '07:00', tz: 'Mars/Olympus' })).toBeUndefined();
    expect(parseQuiet({ from: '23:00', to: '07:00', tz: 'UTC', except: ['comments'] })).toBeUndefined();
    const night = { from: '23:00', to: '07:00', tz: 'UTC', except: [] };
    expect(inQuiet(night, noon)).toBe(false);
    expect(inQuiet(night, noon + 11 * 3600)).toBe(true);
    expect(inQuiet(night, noon + 19 * 3600 - 1)).toBe(true);
    expect(inQuiet(night, noon + 19 * 3600)).toBe(false);
    // 12:00 UTC is 13:00 in Berlin in winter
    expect(inQuiet({ from: '13:00', to: '14:00', tz: 'Europe/Berlin', except: [] }, noon)).toBe(true);
    expect(inQuiet({ from: '12:00', to: '13:00', tz: 'Europe/Berlin', except: [] }, noon)).toBe(false);
  });

  it('keeps them per device, only for the own browsers, and over a re-registration', async () => {
    const quiet = { ...AROUND, except: ['attackSelf'] };
    expect((await call('PUT', '/push/subscriptions/quiet', h.carol, { endpoint: PHONE, quiet: { from: 'x', to: '13:00', tz: 'UTC' } })).statusCode).toBe(400);
    expect((await call('PUT', '/push/subscriptions/quiet', h.dave, { endpoint: PHONE, quiet })).statusCode).toBe(404);
    expect((await call('PUT', '/push/subscriptions/quiet', h.carol, { endpoint: PHONE, quiet })).json()).toEqual({ quiet });
    expect((await subscribe('carol', PHONE)).json()).toEqual({ ok: true, quiet });
    expect((await subscribe('carol', DESK)).json()).toEqual({ ok: true, quiet: null });
  });

  it('holds a push back on the quiet device and sends it when the quiet hours end', async () => {
    await call('POST', '/u8/comments', h.carol, { c: '1:50:7', type: 'planet', body: 'Farm' });
    await call('POST', '/u8/comments', h.dave, { c: '1:50:7', type: 'planet', body: 'Mine now' });
    await app.push.deliver(group, t);
    expect(titles(DESK)).toHaveLength(1);
    expect(titles(PHONE)).toEqual([]);
    // still quiet: nothing; over: the phone gets it once
    await app.push.flushHeld(t + 1800);
    expect(titles(PHONE)).toEqual([]);
    await app.push.flushHeld(OVER);
    expect(titles(PHONE)).toEqual(titles(DESK));
    await app.push.flushHeld(OVER + 100);
    expect(titles(PHONE)).toHaveLength(1);
  });

  it('lets attacks on the user through and drops what expired while quiet', async () => {
    fleets('carol', t, [hostile(1, t + 600)]);
    fleets('dave', t, [hostile(1, t + 900, 'Raider', { g: 2, s: 101, p: 4 })]);
    await call('POST', '/auth/push-settings', h.carol, { attackOthers: true });
    await app.push.deliver(group, t);
    // the attack on Carol breaks the quiet hours, the one on Dave is held on the phone
    expect(titles(PHONE)).toEqual(['⚔ Angriff auf carol']);
    expect(titles(DESK).sort()).toEqual(['⚔ Angriff auf carol', '⚔ Angriff auf dave']);
    // it landed before the quiet hours ended: not sent late
    await app.push.flushHeld(OVER);
    expect(titles(PHONE)).toEqual(['⚔ Angriff auf carol']);
    expect(db.prepare('SELECT COUNT(*) FROM notify_held').pluck().get()).toBe(0);
    await call('POST', '/auth/push-settings', h.carol, { attackOthers: false });
  });

  it('sends held notifications at once when the quiet hours are switched off', async () => {
    await call('POST', '/u8/comments', h.dave, { c: '1:50:7', type: 'planet', body: 'Again' });
    await app.push.deliver(group, t);
    expect(titles(PHONE)).toEqual([]);
    await call('PUT', '/push/subscriptions/quiet', h.carol, { endpoint: PHONE, quiet: null });
    await app.push.flushHeld(t + 60);
    expect(titles(PHONE)).toHaveLength(1);
  });

  it('holds and sends for a Discord webhook too', async () => {
    const quiet = { ...AROUND, except: [] };
    expect((await call('POST', '/auth/discord', h.carol, { webhook: HOOK.carol, prefs: { quiet } })).json().prefs.quiet).toEqual(quiet);
    // push settings never carry quiet hours (they are per device there)
    expect((await call('POST', '/auth/push-settings', h.carol, { quiet })).json().quiet).toBeNull();
    await call('POST', '/u8/comments', h.dave, { c: '1:50:7', type: 'planet', body: 'Discord' });
    fleets('carol', t, [hostile(1, t + 7200, 'Raider', { g: 2, s: 102, p: 4 })]);
    await app.discord.deliver(group, t);
    expect(embeds(HOOK.carol)).toEqual([]);
    await app.discord.flushHeld(t + 1800);
    expect(embeds(HOOK.carol)).toEqual([]);
    await app.discord.flushHeld(OVER);
    expect(embeds(HOOK.carol).sort()).toEqual(['⚔ Angriff auf carol', '💬 dave zu [1:50:7]']);
    await call('POST', '/auth/discord', h.carol, { prefs: { quiet: null } });
  });
});

describe('rules per kind', () => {
  it('leaves espionage out when the user does not count it as an attack', async () => {
    await call('POST', '/auth/push-settings', h.dave, { spying: false });
    fleets('dave', t, [hostile(6, t + 300, 'Spy', { g: 3, s: 1, p: 1 })]);
    await app.push.deliver(group, t);
    expect(titles(DAVE)).toEqual([]);
    fleets('dave', t, [hostile(6, t + 300, 'Spy', { g: 3, s: 1, p: 1 }), hostile(1, t + 400, 'Spy', { g: 3, s: 1, p: 2 })]);
    await app.push.deliver(group, t);
    expect(titles(DAVE)).toEqual(['⚔ Angriff auf dave']);
    await call('POST', '/auth/push-settings', h.dave, { spying: true });
  });

  it('carries the fleet points of the attacker with the attack, without filtering by them', async () => {
    const small = Number(db.prepare("INSERT INTO players (group_id, name) VALUES (?, 'Small')").run(group).lastInsertRowid);
    const snap = Number(db.prepare("INSERT INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, 'player', 2, ?)").run(group, t - 3600).lastInsertRowid);
    db.prepare('INSERT INTO player_scores (snapshot_id, player_id, points, rank) VALUES (?, ?, 500, 1)').run(snap, small);
    await call('POST', '/auth/push-settings', h.dave, { attackOthers: true });
    fleets('carol', t, [hostile(1, t + 5001, 'Small', { g: 4, s: 1, p: 2 }), hostile(1, t + 5002, 'Nobody', { g: 4, s: 1, p: 3 })]);
    await app.push.deliver(group, t);
    // a weak attacker is reported like any other
    expect(titles(DAVE)).toEqual(['⚔ Angriff auf carol', '⚔ Angriff auf carol']);
    const bell = (await call('GET', '/u8/notifications', h.dave)).json().filter((n: any) => n.kind === 'attack' && n.userId === ids.carol);
    expect(bell.map((n: any) => n.attackerFleetPoints)).toEqual([500, null]);
    await call('POST', '/auth/push-settings', h.dave, { attackOthers: false });
  });

  it('leaves espionage out of the alliance channel when it is switched off there', async () => {
    expect((await call('PUT', `/admin/groups/${group}/discord`, h.carol, { webhook: HOOK.group, prefs: { spying: false } })).json().prefs).toMatchObject({ spying: false });
    fleets('carol', t, [hostile(6, t + 6000, 'Big', { g: 5, s: 1, p: 1 }), hostile(1, t + 6001, 'Small', { g: 5, s: 1, p: 2 })]);
    await app.discord.deliver(group, t);
    expect(embeds(HOOK.group)).toEqual(['⚔ Angriff auf carol']);
    expect(posted.find((s) => s.url === HOOK.group)!.message.embeds).toHaveLength(1);
  });

  it('pushes comments only when they mention the user, if they want that', async () => {
    await call('POST', '/auth/push-settings', h.carol, { mentionsOnly: true });
    await call('POST', '/u8/comments', h.carol, { c: '1:60:7', type: 'planet', body: 'Mine' });
    await call('POST', '/u8/comments', h.dave, { c: '1:60:7', type: 'planet', body: 'No, mine' });
    await app.push.deliver(group, t);
    expect(titles(DESK)).toEqual([]);
    await call('POST', '/u8/comments', h.dave, { c: '1:60:7', type: 'planet', body: '@Carol look' });
    await app.push.deliver(group, t);
    expect(titles(DESK)).toEqual(['📣 dave erwähnt dich zu [1:60:7]']);
    await call('POST', '/auth/push-settings', h.carol, { mentionsOnly: false });
  });
});

describe('parser samples', () => {
  it('tells the hub admins by push about a page a member sent as a sample', async () => {
    const ADMIN = 'https://fcm.googleapis.com/fcm/send/admin';
    await call('POST', '/push/subscriptions', h.admin, { endpoint: ADMIN, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
    const res = await call('POST', '/u8/ingest/sample', h.carol, { text: 'Some page of another site with enough text to be looked at. '.repeat(5), note: 'new page?' });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(titles(ADMIN)).toEqual(['🧩 Parser-Beispiel von carol']));
    expect(pushed.find((s) => s.endpoint === ADMIN)!.payload).toMatchObject({ url: '/hub/admin', tag: `sample:${res.json().id}` });
    expect(pushed.find((s) => s.endpoint === ADMIN)!.payload.body).toContain('new page?');
    // members hear nothing, and admins who switched it off neither
    expect(titles(DESK)).toEqual([]);
    pushed.length = 0;
    await call('POST', '/auth/push-settings', h.admin, { parserSamples: false });
    await call('POST', '/u8/ingest/sample', h.carol, { text: 'Another page of another site with enough text to be looked at. '.repeat(5) });
    await new Promise((r) => setTimeout(r, 50));
    expect(titles(ADMIN)).toEqual([]);
  });
});

describe('muted storages', () => {
  it('stores the muted planets per member and alliance and validates the coordinates', async () => {
    expect((await call('GET', '/u8/storage-alerts', h.carol)).json()).toEqual({ planets: [] });
    expect((await call('PUT', '/u8/storage-alerts', h.carol, { muted: ['1:2'] })).statusCode).toBe(400);
    expect((await call('PUT', '/u8/storage-alerts', h.carol, { muted: ['1:2:3', '1:2:3'] })).statusCode).toBe(200);
    expect(db.prepare('SELECT g, s, p FROM storage_muted WHERE group_id = ? AND user_id = ?').all(group, ids.carol)).toEqual([{ g: 1, s: 2, p: 3 }]);
    expect(db.prepare('SELECT COUNT(*) FROM storage_muted WHERE user_id = ?').pluck().get(ids.dave)).toBe(0);
  });

  it('does not push a full storage of a muted planet', async () => {
    const { wanted, PUSH_DEFAULTS } = await import('../src/push.js');
    const n = { id: 'storage:1:2:3:901:1', kind: 'storage', userId: ids.carol, member: 'Carol', time: t, planet: { g: 1, s: 2, p: 3, name: 'Main' }, resource: 901 } as const;
    expect(wanted(n, PUSH_DEFAULTS, ids.carol, t)).toBe(true);
    expect(wanted(n, PUSH_DEFAULTS, ids.carol, t, { storageMuted: new Set(['1:2:3']) })).toBe(false);
    expect(wanted(n, PUSH_DEFAULTS, ids.carol, t, { storageMuted: new Set(['1:2:4']) })).toBe(true);
  });
});
