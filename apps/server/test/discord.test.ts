import { distance, flightDuration, slowestShip, drivesFromResearch } from '@pr0hub/flight';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { UNIVERSE_DEFAULTS } = await import('../src/config.js');

type Message = { content?: string; embeds: { title: string; description: string; color: number }[]; allowed_mentions: { parse: []; users: string[] } };
const sent: { url: string; message: Message }[] = [];
const sender = vi.fn(async (url: string, message: Message) => {
  if (url.includes('/404')) return { status: 404 };
  sent.push({ url, message });
  return { status: 204 };
});

const hook = (id: string) => `https://discord.com/api/webhooks/${id}/${'T'.repeat(68)}`;
const HOOK = { carol: hook('100000000000000001'), dave: hook('100000000000000002'), groupA: hook('100000000000000003'), groupB: hook('100000000000000004') };

const db = openDb(':memory:');
const app = buildApp(db, { logger: false, push: { contact: '', sender: async () => 201 }, discord: { sender } });
let groupA = 0;
let groupB = 0;
const ids: Record<string, number> = {};
const h: Record<string, Record<string, string>> = {};
const t = Math.floor(Date.now() / 1000);

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });
const to = (url: string) => sent.filter((s) => s.url === url).flatMap((s) => s.message.embeds.map((e) => e.title));

beforeAll(async () => {
  await app.ready();
  for (const name of ['admin', 'carol', 'dave', 'erin']) {
    db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)').run(name, hashPassword(`${name}pass`), name === 'admin' ? 1 : 0);
    ids[name] = db.prepare('SELECT id FROM users WHERE username = ?').pluck().get(name) as number;
  }
  h.admin = { cookie: await login('admin') };
  await call('POST', '/admin/universes', h.admin, { slug: 'u8', name: 'Universum 8' });
  groupA = (await call('POST', '/admin/groups', h.admin, { universe: 'u8', name: 'A' })).json().id;
  groupB = (await call('POST', '/admin/groups', h.admin, { universe: 'u8', name: 'B' })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name, role) VALUES (?, ?, 'Carol', 'admin')").run(groupA, ids.carol);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Dave')").run(groupA, ids.dave);
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Erin')").run(groupB, ids.erin);
  h.carol = { cookie: await login('carol'), 'x-hub-group': String(groupA) };
  h.dave = { cookie: await login('dave'), 'x-hub-group': String(groupA) };
  h.erin = { cookie: await login('erin'), 'x-hub-group': String(groupB) };
});

beforeEach(() => {
  sent.length = 0;
});

describe('discord settings', () => {
  it('takes only Discord webhooks and never hands the URL out again', async () => {
    for (const webhook of ['https://example.com/api/webhooks/100000000000000001/abc', 'http://discord.com/api/webhooks/100000000000000001/' + 'T'.repeat(68), 'https://discord.com.evil.org/api/webhooks/1/x']) {
      const res = await call('POST', '/auth/discord', h.carol, { webhook });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('discord_webhook_invalid');
    }
    const res = await call('POST', '/auth/discord', h.carol, { webhook: HOOK.carol, userId: '200000000000000001' });
    expect(res.json()).toEqual({
      webhook: 'discord.com/api/webhooks/100000…', userId: '200000000000000001',
      prefs: { attackSelf: true, attackOthers: false, invites: true, comments: true, launch: true, leadMinutes: 5 },
    });
    expect(JSON.stringify((await call('GET', '/auth/discord', h.carol)).json())).not.toContain('TTTT');
    expect((await call('POST', '/auth/discord', h.carol, { userId: '@carol' })).json().code).toBe('discord_user_id_invalid');
    expect((await call('POST', '/auth/discord', h.carol, { prefs: { leadMinutes: 7 } })).json().code).toBe('discord_settings_invalid');
    // own settings, independent from push
    await call('POST', '/auth/discord', h.dave, { webhook: HOOK.dave, prefs: { attackOthers: true } });
    expect((await call('GET', '/auth/push-settings', h.dave)).json().attackOthers).toBe(false);
  });

  it('lets only group admins set the channel', async () => {
    expect((await call('GET', `/admin/groups/${groupA}/discord`, h.dave)).statusCode).toBe(403);
    expect((await call('PUT', `/admin/groups/${groupA}/discord`, h.carol, { webhook: 'https://x.org' })).statusCode).toBe(400);
    expect((await call('PUT', `/admin/groups/${groupA}/discord`, h.carol, { prefs: { lang: 'fr' } })).statusCode).toBe(400);
    const res = await call('PUT', `/admin/groups/${groupA}/discord`, h.carol, { webhook: HOOK.groupA });
    expect(res.json()).toEqual({ webhook: 'discord.com/api/webhooks/100000…', prefs: { attacks: true, plans: true, launch: true, leadMinutes: 5, lang: 'de' } });
    await call('PUT', `/admin/groups/${groupB}/discord`, h.admin, { webhook: HOOK.groupB });
  });

  it('sends tests and reports a missing webhook', async () => {
    expect((await call('POST', '/auth/discord/test', h.carol)).json()).toEqual({ ok: true });
    expect((await call('POST', '/auth/discord/test', h.erin)).statusCode).toBe(409);
    expect((await call('POST', `/admin/groups/${groupA}/discord/test`, h.carol)).json()).toEqual({ ok: true });
    expect(to(HOOK.carol)).toEqual(['pr0game Hub']);
    expect(to(HOOK.groupA)).toEqual(['pr0game Hub']);
  });
});

describe('discord delivery', () => {
  it('sends an attack once to the member, to members who want others, and to the channel with a mention', async () => {
    const hostile = {
      owner: 'hostile', player: 'Raider', mission: 1, missionName: 'Angreifen', phase: 'out', ships: { 204: 50 }, resources: null, arrival: t + 3600,
      from: { coords: { g: 2, s: 100, p: 4 }, type: 'planet', name: null }, to: { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: null },
    };
    const own = { ...hostile, owner: 'own', player: null, mission: 1, arrival: t + 1800, from: { coords: { g: 1, s: 1, p: 1 }, type: 'planet', name: null }, to: { coords: { g: 3, s: 3, p: 3 }, type: 'planet', name: null } };
    db.prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(groupA, ids.carol, t, JSON.stringify([hostile, own]));

    await app.discord.deliver(groupA, t);
    expect(to(HOOK.carol)).toEqual(['⚔ Angriff auf Carol']);
    expect(to(HOOK.dave)).toEqual(['⚔ Angriff auf Carol']);
    const channel = sent.filter((s) => s.url === HOOK.groupA);
    expect(channel).toHaveLength(1);
    expect(channel[0].message).toMatchObject({ content: '<@200000000000000001>', allowed_mentions: { parse: [], users: ['200000000000000001'] } });
    expect(channel[0].message.embeds.map((e) => e.title)).toEqual(['⚔ Angriff auf Carol']);
    expect(channel[0].message.embeds[0].description).toContain('von Raider [2:100:4]');

    sent.length = 0;
    await app.discord.deliver(groupA, t);
    await app.discord.deliver(groupB, t);
    expect(sent).toEqual([]);
  });

  it('posts new plans and the launch reminders of the members to the channel', async () => {
    const ships = { 202: 3 };
    const duration = flightDuration(UNIVERSE_DEFAULTS, distance(UNIVERSE_DEFAULTS, [1, 10, 3], [1, 20, 8]), slowestShip(ships, drivesFromResearch({}))!.speed, 100);
    const launch = t + 1800;
    const plan = Number(
      db.prepare("INSERT INTO attack_plans (group_id, user_id, g, s, p, planet_type, target_time, time_precision, created_at) VALUES (?, ?, 1, 20, 8, 'planet', ?, 'exact', ?)")
        .run(groupA, ids.dave, launch + Math.floor(duration), t).lastInsertRowid,
    );
    db.prepare("INSERT INTO attack_plan_fleets (plan_id, user_id, g, s, p, planet_type, ships, speed, status) VALUES (?, ?, 1, 10, 3, 'planet', ?, 100, 'invited')")
      .run(plan, ids.carol, JSON.stringify(ships));

    await app.discord.deliver(groupA, t);
    expect(to(HOOK.groupA)).toEqual(['📋 Neuer Plan von Dave']);
    expect(to(HOOK.carol)).toEqual(['✉ Einladung von Dave']);
    expect(sent.find((s) => s.url === HOOK.groupA)!.message.content).toBeUndefined();

    sent.length = 0;
    await app.discord.tick(launch - 301);
    expect(sent).toEqual([]);
    await app.discord.tick(launch - 300);
    expect(to(HOOK.groupA)).toEqual(['🚀 Carol: Start in 5 Min']);
    expect(to(HOOK.carol)).toEqual(['🚀 Start in 5 Min']);
    expect(sent.find((s) => s.url === HOOK.groupA)!.message.content).toBe('<@200000000000000001>');

    // switched off for the channel: nothing new there
    await call('PUT', `/admin/groups/${groupA}/discord`, h.carol, { prefs: { plans: false } });
    db.prepare("INSERT INTO attack_plans (group_id, user_id, g, s, p, planet_type, target_time, time_precision, created_at) VALUES (?, ?, 1, 21, 8, 'planet', ?, 'day', ?)").run(groupA, ids.dave, t + 86400, t);
    sent.length = 0;
    await app.discord.deliver(groupA, t);
    expect(to(HOOK.groupA)).toEqual([]);
  });

  it('removes a webhook Discord no longer knows', async () => {
    // set directly: the sender stub answers 404 for this URL
    db.prepare('UPDATE users SET discord_webhook = ? WHERE id = ?').run('https://discord.com/api/webhooks/404/x', ids.erin);
    expect((await call('POST', '/auth/discord/test', h.erin)).statusCode).toBe(502);
    expect(db.prepare('SELECT discord_webhook FROM users WHERE id = ?').pluck().get(ids.erin)).toBeNull();
  });
});
