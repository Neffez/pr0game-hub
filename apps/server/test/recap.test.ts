import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { addDays, dayOf, periodDays } = await import('../src/repo/achievements.js');
const { previousSpan } = await import('../src/repo/recap.js');
const { countSync } = await import('../src/repo/syncCount.js');
const { isoWeek } = await import('../src/recapText.js');
const { localToEpoch } = await import('@pr0hub/core');

type Message = { embeds: { title: string; description: string; image?: { url: string } }[] };
const sent: { url: string; message: Message; files?: { name: string; data: Buffer }[] }[] = [];
const sender = vi.fn(async (url: string, message: Message, files?: { name: string; data: Buffer }[]) => {
  sent.push({ url, message, files });
  return { status: 204 };
});

const db = openDb(':memory:');
const app = buildApp(db, { logger: false, push: { contact: '', sender: async () => 201 }, discord: { sender } });
const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');
const TZ = 'Europe/Berlin';
const HOOK = `https://discord.com/api/webhooks/100000000000000009/${'T'.repeat(68)}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of a png')]);
let group = 0;
const ids: Record<string, number> = {};
const h: Record<string, Record<string, string>> = {};

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });
const getJson = async (url: string, who = 'carol') => {
  const res = await call('GET', url, h[who]);
  expect(res.statusCode).toBe(200);
  return res.json();
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
  // the group's creator (admin) is a member too
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')").run(group, ids.carol);
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(group, ids.dave);
  h.carol = { cookie: await login('carol'), 'x-hub-group': String(group) };
  h.dave = { cookie: await login('dave'), 'x-hub-group': String(group) };

  // carol: nine empire days long ago, galaxy and empire today (the tenth empire day reaches the imperator badge)
  for (let i = 0; i < 9; i++) db.prepare("INSERT INTO sync_credits (group_id, user_id, day, kind) VALUES (?, ?, ?, 'empire')").run(group, ids.carol, `2026-01-0${i + 1}`);
  await call('POST', '/u8/ingest', h.carol, { html: fixture('galaxy.html') });
  await call('POST', '/u8/ingest', h.carol, { html: fixture('empire.html') });
  // dave: syncs and an empire day in the span before
  const today = dayOf(now(), TZ);
  const before = previousSpan('week', ...(Object.values(periodDays('week', today)) as [string, string])).from;
  db.prepare("INSERT INTO sync_credits (group_id, user_id, day, kind, key, count) VALUES (?, ?, ?, 'sync', 'empire', 3)").run(group, ids.dave, before);
  db.prepare("INSERT INTO sync_credits (group_id, user_id, day, kind) VALUES (?, ?, ?, 'empire')").run(group, ids.dave, before);
});

beforeEach(() => {
  sent.length = 0;
});

describe('recap', () => {
  it('compares a period with the same days before', () => {
    expect(previousSpan('week', '2026-11-16', '2026-11-18')).toEqual({ from: '2026-11-09', to: '2026-11-11' });
    expect(previousSpan('lastWeek', '2026-11-09', '2026-11-15')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(previousSpan('days30', '2026-10-20', '2026-11-18')).toEqual({ from: '2026-09-20', to: '2026-10-19' });
    expect(isoWeek('2026-11-16')).toBe(47);
    expect(isoWeek('2027-01-01')).toBe(53);
  });

  it('counts the syncs with data per member and page', () => {
    const rows = db.prepare("SELECT user_id, key, count FROM sync_credits WHERE group_id = ? AND kind = 'sync' AND user_id = ? ORDER BY key").all(group, ids.carol);
    expect(rows).toEqual([
      { user_id: ids.carol, key: 'empire', count: 1 },
      { user_id: ids.carol, key: 'galaxy', count: 1 },
    ]);
  });

  it('sums up the week: syncs, points, badges, highlights and what is open', async () => {
    const r = await getJson('/u8/recap');
    const ranking = await getJson('/u8/ranking');
    expect(r.period).toBe('week');
    expect(r.members).toBe(3);
    expect(r.syncs).toEqual({ now: 2, before: 3 });
    expect(r.active).toEqual({ now: 1, before: 1 });
    // the same points as the ranking
    expect(r.points.now).toBe(ranking.rows.reduce((n: number, x: { points: number }) => n + x.points, 0));
    expect(r.points.before).toBe(10);
    expect(r.rows.find((x: { userId: number }) => x.userId === ids.carol)).toMatchObject({ syncs: 2, badges: 1, before: 0 });
    expect(r.badges).toEqual([{ userId: ids.carol, name: 'carol', key: 'imperator', level: 1 }]);
    expect(r.newBadges).toBe(1);
    expect(r.highlights.map((x: { key: string }) => x.key)).toEqual(['top', 'riser', 'cartographer', 'badges']);
    expect(r.kinds.find((k: { kind: string }) => k.kind === 'empire')).toEqual({ kind: 'empire', units: 1, points: 10, before: 10 });
    expect(r.days.length).toBeGreaterThan(0);
    expect(r.days.at(-1)).toMatchObject({ day: dayOf(now(), TZ), syncs: 2 });
    expect(r.open).toMatchObject({ idle: 2, noEmpire: 2, galaxy: { total: expect.any(Number), days: 7 } });
    expect(r.open.galaxy.fresh).toBeGreaterThan(0);
    expect((await call('GET', '/u8/recap?period=year', h.carol)).statusCode).toBe(400);
  });

  it('tells the recap as Markdown in either language', async () => {
    const de = (await getJson('/u8/recap/text')).text as string;
    expect(de).toMatch(/^## Recap KW \d+ · /);
    expect(de).toContain('**2** Syncs');
    expect(de).toContain('carol: Imperator 1');
    expect(de).toContain('2 von 3 Mitgliedern ohne Punkte');
    expect(de).toContain('Kartograph: carol (1 System)');
    const en = (await getJson('/u8/recap/text?period=days30&lang=en')).text as string;
    expect(en).toMatch(/^## Recap \w+ \d+ – \w+ \d+/);
    expect(en).toContain('New badges');
  });

  it('posts to the channel for alliance admins, with the image attached', async () => {
    expect((await call('POST', '/u8/recap/discord', h.carol, { period: 'week' })).json().code).toBe('discord_not_configured');
    await call('PUT', `/admin/groups/${group}/discord`, h.carol, { webhook: HOOK });
    expect((await call('POST', '/u8/recap/discord', h.dave, {})).statusCode).toBe(403);
    expect((await call('POST', '/u8/recap/discord', h.carol, { image: Buffer.from('GIF89a').toString('base64') })).json().code).toBe('recap_image_invalid');
    // a body above the server's general limit, within what an image of the allowed size takes as base64
    const big = await call('POST', '/u8/recap/discord', h.carol, { image: 'A'.repeat(9 * 1024 * 1024) });
    expect(big.statusCode).toBe(400);
    expect(big.json().code).toBe('recap_image_invalid');
    const res = await call('POST', '/u8/recap/discord', h.carol, { period: 'week', image: `data:image/png;base64,${PNG.toString('base64')}` });
    expect(res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].message.embeds[0]).toMatchObject({ title: expect.stringMatching(/^Recap KW/), image: { url: 'attachment://recap.png' } });
    expect(sent[0].files?.[0].name).toBe('recap.png');
    expect(sent[0].files?.[0].data.equals(PNG)).toBe(true);
  });

  it('posts last week on Monday mornings once, when the channel wants it', async () => {
    // a Monday in the universe's time zone
    let monday = dayOf(now(), TZ);
    while (new Date(`${monday}T12:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, -1);
    const at = (time: string) => localToEpoch(`${monday} ${time}`, TZ);
    await app.discord.weeklyRecaps(at('10:00:00'));
    expect(sent).toHaveLength(0);
    await call('PUT', `/admin/groups/${group}/discord`, h.carol, { prefs: { recap: true } });
    await app.discord.weeklyRecaps(at('08:59:00'));
    expect(sent).toHaveLength(0);
    await app.discord.weeklyRecaps(at('09:00:00'));
    await app.discord.weeklyRecaps(at('12:00:00'));
    expect(sent).toHaveLength(1);
    expect(sent[0].message.embeds[0].title).toContain(`KW ${isoWeek(addDays(monday, -7))}`);
    expect(sent[0].files).toBeUndefined();
  });

  it('catches up a missed Monday later in the week and posts the last week of an ended round once', async () => {
    let monday = dayOf(now(), TZ);
    while (new Date(`${monday}T12:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, -1);
    const next = addDays(monday, 7);
    const at = (day: string, time: string) => localToEpoch(`${day} ${time}`, TZ);
    sent.length = 0;
    // the server was down on next Monday: Wednesday sends it, once
    await app.discord.weeklyRecaps(at(addDays(next, 2), '07:00:00'));
    await app.discord.weeklyRecaps(at(addDays(next, 3), '07:00:00'));
    expect(sent).toHaveLength(1);
    expect(sent[0].message.embeds[0].title).toContain(`KW ${isoWeek(monday)}`);
    // the round ends on Thursday of the week after: the Monday after it gets that week up to the end, then nothing
    const end = at(addDays(next, 10), '18:00:00');
    db.prepare("UPDATE universes SET ended_at = ? WHERE slug = 'u8'").run(end);
    try {
      sent.length = 0;
      await app.discord.weeklyRecaps(at(addDays(next, 14), '10:00:00'));
      expect(sent).toHaveLength(1);
      expect(sent[0].message.embeds[0].title).toContain(`KW ${isoWeek(addDays(next, 7))}`);
      await app.discord.weeklyRecaps(at(addDays(next, 21), '10:00:00'));
      expect(sent).toHaveLength(1);
    } finally {
      db.prepare("UPDATE universes SET ended_at = NULL WHERE slug = 'u8'").run();
    }
  });

  it('looks back from the start of the universe, without a span before', async () => {
    const start = now() - 3 * 86400;
    db.prepare("UPDATE universes SET starts_at = ? WHERE slug = 'u8'").run(start);
    const r = await getJson('/u8/recap?period=start');
    expect(r).toMatchObject({ period: 'start', from: dayOf(start, TZ), to: dayOf(now(), TZ), previous: null });
    expect(r.days).toHaveLength(4);
    // the empire days of January lie before the start: the imperator badge is reached within it
    expect(r.badges).toEqual([{ userId: ids.carol, name: 'carol', key: 'imperator', level: 1 }]);
    expect(r.syncs.before).toBe(0);
    expect(r.highlights.map((x: { key: string }) => x.key)).not.toContain('riser');
    expect((await getJson('/u8/recap/text?period=start')).text).toMatch(/^## Recap seit Start · /);
    db.prepare("UPDATE universes SET starts_at = NULL WHERE slug = 'u8'").run();
  });

  it('counts only the syncs that brought something new', async () => {
    const count = () => db.prepare("SELECT count FROM sync_credits WHERE group_id = ? AND kind = 'sync' AND user_id = ? AND key = 'messages'").pluck().get(group, ids.dave);
    await call('POST', '/u8/ingest', h.dave, { html: fixture('messages.html') });
    expect(count()).toBe(1);
    // the same messages again: nothing new
    await call('POST', '/u8/ingest', h.dave, { html: fixture('messages.html') });
    expect(count()).toBe(1);
  });

  it('counts each page type by its rule', () => {
    const c = (day: string, page: string, at: number, unit?: string) => countSync(db, group, ids.admin, day, page, at, unit);
    const d = '2030-01-01';
    // reports count every time
    expect([c(d, 'messages', 1000), c(d, 'messages', 1001)]).toEqual([true, true]);
    // the overview every 15 minutes
    expect([c(d, 'overview', 1000), c(d, 'overview', 1899), c(d, 'overview', 1900)]).toEqual([true, false, true]);
    // Imperium, buildings, research, shipyard and fleets once an hour, each page type on its own
    expect([c(d, 'empire', 1000), c(d, 'empire', 4599), c(d, 'buildings', 4599), c(d, 'empire', 4600)]).toEqual([true, false, true, true]);
    // the marketplace once a day
    expect([c(d, 'marketplace', 1000), c(d, 'marketplace', 80000), c('2030-01-02', 'marketplace', 90000)]).toEqual([true, false, true]);
    // a player card once per player, on any day
    expect([c(d, 'playerCard', 1000, '7'), c('2030-01-02', 'playerCard', 90000, '7'), c(d, 'playerCard', 1000, '8')]).toEqual([true, false, true]);
    const rows = db.prepare("SELECT key, SUM(count) AS n FROM sync_credits WHERE group_id = ? AND user_id = ? AND kind = 'sync' GROUP BY key ORDER BY key").all(group, ids.admin);
    expect(rows).toEqual([
      { key: 'buildings', n: 1 },
      { key: 'empire', n: 2 },
      { key: 'marketplace', n: 2 },
      { key: 'messages', n: 2 },
      { key: 'overview', n: 2 },
      { key: 'playerCard:7', n: 1 },
      { key: 'playerCard:8', n: 1 },
    ]);
  });

  it('counts a galaxy page only when a system is new or changed for the group', async () => {
    const galaxy = (who: string) => db.prepare("SELECT SUM(count) FROM sync_credits WHERE group_id = ? AND kind = 'sync' AND user_id = ? AND key = 'galaxy'").pluck().get(group, ids[who]) as number | null;
    // carol synced the system first (beforeAll); the same view again brings nothing new
    const res = await call('POST', '/u8/ingest', h.dave, { html: fixture('galaxy.html') });
    expect(res.statusCode).toBe(200);
    expect(galaxy('dave')).toBeNull();
    // once the system looks different, the next view counts
    db.prepare("UPDATE galaxy_views SET fingerprint = 'old' WHERE group_id = ?").run(group);
    await call('POST', '/u8/ingest', h.dave, { html: fixture('galaxy.html') });
    expect(galaxy('dave')).toBe(1);
  });

  it('counts the Imperium at most once an hour, but stores every sync', async () => {
    const count = () => db.prepare("SELECT SUM(count) FROM sync_credits WHERE group_id = ? AND kind = 'sync' AND user_id = ? AND key = 'empire'").pluck().get(group, ids.dave) as number;
    const stored = () => db.prepare("SELECT COUNT(*) FROM raw_ingests WHERE group_id = ? AND user_id = ? AND page_type = 'empire'").pluck().get(group, ids.dave) as number;
    const before = count();
    // an empire page always brings a new snapshot
    await call('POST', '/u8/ingest', h.dave, { html: fixture('empire.html') });
    await call('POST', '/u8/ingest', h.dave, { html: fixture('empire.html') });
    expect(count()).toBe(before + 1);
    expect(stored()).toBe(2);
    // 15 minutes later still within the hour, an hour later it counts again
    db.prepare("UPDATE sync_credits SET last_at = last_at - 900 WHERE group_id = ? AND user_id = ? AND kind = 'sync' AND key = 'empire'").run(group, ids.dave);
    await call('POST', '/u8/ingest', h.dave, { html: fixture('empire.html') });
    expect(count()).toBe(before + 1);
    db.prepare("UPDATE sync_credits SET last_at = last_at - 3600 WHERE group_id = ? AND user_id = ? AND kind = 'sync' AND key = 'empire'").run(group, ids.dave);
    await call('POST', '/u8/ingest', h.dave, { html: fixture('empire.html') });
    expect(count()).toBe(before + 2);
    expect(stored()).toBe(4);
  });
});
