import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');
let group = 0;
let carolId = 0;
let carol: Record<string, string>;
const DAY = 86400;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const sync = async (payload: Record<string, unknown>) => {
  const res = await app.inject({ method: 'POST', url: '/hub/api/u8/ingest', headers: carol, payload });
  expect(res.statusCode).toBe(200);
  return res.json();
};

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const cookie = await login('admin', 'adminpass');
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, headers: { cookie } });
  group = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, headers: { cookie } })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(group, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(group) };
});

describe('impact of a sync', () => {
  it('tells nothing on a dry run', async () => {
    expect((await sync({ html: fixture('galaxy.html'), dryRun: true })).impact).toBeUndefined();
  });

  it('counts galaxy systems seen for the first time and the age of the views they replace', async () => {
    // the fixture has no page time, so a view counts as seen when it is synced: the clock stands still, or the same
    // view synced a second later would be a newer one
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    try {
      expect((await sync({ html: fixture('galaxy.html') })).impact.galaxy).toEqual({ systems: 1, first: 1, age: null });
      // the same view again is no news
      expect((await sync({ html: fixture('galaxy.html') })).impact.galaxy).toBeUndefined();
      db.prepare('UPDATE galaxy_views SET seen_at = seen_at - ? WHERE group_id = ?').run(2 * DAY, group);
      expect((await sync({ html: fixture('galaxy.html') })).impact.galaxy).toEqual({ systems: 1, first: 0, age: 2 * DAY });
    } finally {
      vi.useRealTimers();
    }
  });

  it('dates an old copied galaxy page by its server clock: pasted again later it is no news', async () => {
    // the copy's header clock three days ago (no year, German month), in the universe's time zone
    const at = new Date(Date.now() - 3 * DAY * 1000);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    const month = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][Number(parts.month) - 1];
    const text = fixture('galaxy.txt').replace(/Serverzeit : .*/, `Serverzeit : ${month} Mo ${Number(parts.day)} ${parts.hour}:${parts.minute}:${parts.second}`);
    const paste = async () => (await sync({ text, system: '2:7' })).impact.galaxy;
    expect(await paste()).toMatchObject({ systems: 1, first: 1 });
    const seen = db.prepare('SELECT seen_at FROM galaxy_views WHERE group_id = ? AND g = 2 AND s = 7').pluck().get(group) as number;
    expect(Math.abs(seen - Math.floor(at.getTime() / 1000))).toBeLessThanOrEqual(1);
    expect(await paste()).toBeUndefined();
  });

  it('counts targets spied for the first time and older reports replaced', async () => {
    const first = (await sync({ text: fixture('messages.txt') })).impact.spy;
    expect(first.first).toBeGreaterThan(0);
    expect(first).toMatchObject({ replaced: 0, age: null });
    // the same reports again: nothing new
    expect((await sync({ text: fixture('messages.txt') })).impact.spy).toBeUndefined();
    // the stored reports a day older (other messages): the pasted ones replace them
    db.prepare("UPDATE spy_reports SET report_time = report_time - ?, msg_id = msg_id || 'x' WHERE group_id = ?").run(DAY, group);
    const again = (await sync({ text: fixture('messages.txt') })).impact.spy;
    expect(again).toEqual({ first: 0, replaced: first.first, age: DAY });
  });

  it('tells who pasted a statistics update first and which categories a sync added', async () => {
    const stats = (await sync({ html: fixture('stats-player.html') })).impact.stats;
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ first: true, types: [2] });
    expect((await sync({ html: fixture('stats-player.html') })).impact.stats).toBeUndefined();
  });

  it('names the own pages that are newer and the sync hints done with them', async () => {
    const impact = (await sync({ html: fixture('empire.html') })).impact;
    expect(impact.own).toEqual([{ page: 'empire', before: null }]);
    expect(impact.hintsDone).toContain('empire');
    // the same page within the hour is no news
    expect((await sync({ html: fixture('empire.html') })).impact.own).toBeUndefined();
    db.prepare('UPDATE empire_snapshots SET created_at = created_at - ? WHERE group_id = ?').run(3 * DAY, group);
    const old = (await sync({ html: fixture('empire.html') })).impact;
    expect(old.own[0].page).toBe('empire');
    expect(old.own[0].before).toBeLessThan(Date.now() / 1000 - 3 * DAY + 60);
  });

  it('counts an own page with the game clock that is only minutes newer (a script syncing it around the clock)', async () => {
    const html = fixture('empire-real-source.html');
    // the page minutes ago on the game's clock (the universe's time zone, month 0-based like the page's script)
    const at = (minutes: number) => {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
          .formatToParts(new Date(Date.now() - minutes * 60_000))
          .map((x) => [x.type, Number(x.value)]),
      );
      const page = html.replace(/serverTimeDelta\s*=\s*new Date\([^)]*\)/, `serverTimeDelta = new Date(${p.year}, ${p.month - 1}, ${p.day}, ${p.hour}, ${p.minute}, ${p.second})`);
      expect(page).not.toBe(html);
      return { html: page };
    };
    db.prepare('DELETE FROM empire_snapshots WHERE group_id = ?').run(group);
    expect((await sync(at(20))).impact.own).toEqual([{ page: 'empire', before: null }]);
    // the same page again is no news, one ten minutes newer is
    expect((await sync(at(20))).impact.own).toBeUndefined();
    expect((await sync(at(10))).impact.own).toEqual([{ page: 'empire', before: expect.any(Number) }]);
  });
});

describe('contributors of a page', () => {
  const get = async (query: string) => app.inject({ method: 'GET', url: `/hub/api/u8/contributors?${query}`, headers: carol });

  it('counts the members who synced the data, names those who show their syncs', async () => {
    // carol synced the galaxy, spy reports and statistics above
    expect((await get('scope=stats')).json()).toEqual({ scope: 'stats', days: 7, members: 1, me: true, names: [], hidden: 0 });
    const user = (name: string, share: number) =>
      Number(db.prepare('INSERT INTO users (username, password_hash, share_syncs) VALUES (?, ?, ?)').run(name, 'x', share).lastInsertRowid);
    const bob = user('bob', 1);
    const dave = user('dave', 0);
    const eve = user('eve', 1);
    for (const id of [bob, dave]) db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(group, id);
    // eve left the group: her view is not counted
    for (const [s, id] of [[1, bob], [2, dave], [3, eve]]) db.prepare('INSERT INTO galaxy_views (group_id, g, s, seen_at, user_id) VALUES (?, 9, ?, 1, ?)').run(group, s, id);
    expect((await get('scope=galaxy')).json()).toEqual({ scope: 'galaxy', days: null, members: 3, me: true, names: ['bob'], hidden: 1 });
    // spy reports of the window only
    db.prepare("UPDATE spy_reports SET report_time = report_time - ? WHERE group_id = ?").run(400 * DAY, group);
    expect((await get('scope=farm&days=3')).json()).toMatchObject({ days: 3, members: 0, me: false });
  });

  it('refuses an unknown scope', async () => {
    expect((await get('scope=nope')).statusCode).toBe(400);
  });
});

describe('universe.json upload', () => {
  it('tells the systems it refreshed but gives no galaxy credits', async () => {
    const galaxyCredits = () => db.prepare("SELECT COUNT(*) FROM sync_credits WHERE group_id = ? AND kind = 'galaxy'").pluck().get(group) as number;
    const before = galaxyCredits();
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers: carol, payload: { text: fixture('universe.json') } });
    expect(res.statusCode).toBe(200);
    expect(res.json().impact.galaxy.systems).toBeGreaterThan(0);
    expect(galaxyCredits()).toBe(before);
  });

  it('earns a point per percent of the systems it refreshed, at most 100 a week', async () => {
    const credits = () => db.prepare("SELECT day, count FROM sync_credits WHERE group_id = ? AND kind = 'universe'").all(group) as { day: string; count: number }[];
    const points = async () => (await app.inject({ method: 'GET', url: '/hub/api/u8/ranking?period=week', headers: carol })).json().rows.find((r: any) => r.userId === carolId).parts.universe ?? 0;
    // the upload above refreshed a few systems of the universe's 9 × 499: 1 point (at least 1), not 100
    expect(credits()).toEqual([{ day: expect.any(String), count: 1 }]);
    expect(await points()).toBe(1);
    // the same file again refreshes nothing
    const res = await app.inject({ method: 'POST', url: '/hub/api/u8/universe-json', headers: carol, payload: { text: fixture('universe.json') } });
    expect(res.statusCode).toBe(200);
    expect(credits()).toHaveLength(1);
    // a whole fresh universe would be 100: the week holds at most 100 altogether, the next week starts again
    const { addCredits, addDays } = await import('../src/repo/achievements.js');
    const [{ day }] = credits();
    const monday = addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
    addCredits(db, group, carolId, addDays(monday, 6), [{ kind: 'universe', count: 60 }]);
    addCredits(db, group, carolId, addDays(monday, 6), [{ kind: 'universe', count: 60 }]);
    const week = (d: string) => credits().filter((c) => c.day >= monday && c.day <= d).reduce((n, c) => n + c.count, 0);
    expect(week(addDays(monday, 6))).toBe(100);
    addCredits(db, group, carolId, addDays(monday, 7), [{ kind: 'universe', count: 100 }]);
    expect(credits().find((c) => c.day === addDays(monday, 7))?.count).toBe(100);
  });
});
