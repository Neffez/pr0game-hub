import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { Store } = await import('../src/store.js');
const { localToEpoch, parsePage } = await import('@pr0hub/core');

const fixture = (name: string) => readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url), 'utf8');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
let groupA = 0;
let carolId = 0;
let carol: Record<string, string>;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api/u8${url}`, headers, payload });
const offers = () => db.prepare('SELECT offer_id, give_amount, want_res, ends_at FROM market_offers WHERE group_id = ? ORDER BY ends_at').all(groupA) as any[];
const logged = () => db.prepare("SELECT data FROM activity_log WHERE group_id = ? AND kind = 'market_offer' ORDER BY id").all(groupA) as { data: string }[];
const rates = () => db.prepare('SELECT metal, crystal, source FROM market_rates WHERE group_id = ? ORDER BY time, id').all(groupA) as any[];

// the page source shows the server time 2026-10-27 21:04:11; the text copy was taken 199 s later
const htmlSeen = localToEpoch('2026-10-27 21:04:11', 'Europe/Berlin');

beforeAll(async () => {
  await app.ready();
  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hashPassword('adminpass'));
  carolId = Number(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('carol', hashPassword('carolpass')).lastInsertRowid);
  const h = { headers: { cookie: await login('admin', 'adminpass') } };
  await app.inject({ method: 'POST', url: '/hub/api/admin/universes', payload: { slug: 'u8', name: 'Universum 8' }, ...h });
  groupA = (await app.inject({ method: 'POST', url: '/hub/api/admin/groups', payload: { universe: 'u8', name: 'A' }, ...h })).json().id;
  db.prepare("INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, 'Carol')").run(groupA, carolId);
  carol = { cookie: await login('carol', 'carolpass'), 'x-hub-group': String(groupA) };
});

describe('marketplace', () => {
  it('stores the offers of a text copy and logs each one once', () => {
    const rec = parsePage({ text: fixture('marketplace-de.txt') }).records[0];
    if (rec.kind !== 'marketplace') throw new Error('expected marketplace');
    for (let i = 0; i < 2; i++) {
      const summary = { pageType: 'marketplace' as const, source: 'text' as const, lang: 'de' as const, warnings: [], counts: {}, preview: [] };
      new Store(db, { groupId: groupA, userId: carolId, timezone: 'Europe/Berlin' }, summary).record({ ...rec, seenAt: htmlSeen + 199 + i * 20 });
      expect(summary.counts).toMatchObject({ market_offers: { new: i ? 0 : 5, duplicate: i ? 5 : 0 }, market_trades: { new: i ? 0 : 3, duplicate: i ? 3 : 0 } });
    }
    // the twin offers (350.000 crystal for 999.000 metal, 29 s apart) stay two
    expect(offers().filter((o) => o.give_amount === 350_000)).toHaveLength(2);
    expect(logged()).toHaveLength(5);
    expect(JSON.parse(logged()[0].data)).toMatchObject({ give: { res: 'k', amount: 1_000_000 }, want: { res: 'd', amount: 650_000 }, ratio: 1.07, ally: false });
    // the same estimate again moves the row on instead of adding one
    expect(rates().map((r) => r.source)).toEqual(['text']);
  });

  it('recognises the offers in the page source, takes their ids and the exact rate', async () => {
    const res = await call('POST', '/ingest', carol, { html: fixture('marketplace-real-source.html') });
    expect(res.statusCode).toBe(200);
    // the history dates of the copy (Berlin time) are the source's epoch seconds
    expect(res.json().counts).toMatchObject({ market_rates: { new: 1, duplicate: 0 }, market_offers: { new: 0, duplicate: 5 }, market_trades: { new: 0, duplicate: 2 } });
    expect(offers().map((o) => o.offer_id)).toEqual([16395715, 16395717, 16395236, 16395238, 16395539]);
    expect(offers()[0].ends_at).toBe(htmlSeen + 4610);
    expect(logged()).toHaveLength(5);
    // the estimates of the text copy minutes later give way to it
    expect(rates()).toEqual([{ metal: 4.055148796006, crystal: 1.43283508019, source: 'source' }]);

    const market = (await call('GET', '/market', carol)).json();
    expect(market.rate).toMatchObject({ m: 4.055148796006, k: 1.43283508019, source: 'source', by: 'Carol' });
    // the text copy is the later view of the market
    expect(market.syncedAt).toBe(htmlSeen + 219);
    expect(market.syncedBy).toBe('Carol');
    expect(market.trades.map((x: any) => x.time)).toEqual([1793112911, localToEpoch('2026-10-27 10:17:53', 'Europe/Berlin'), 1792997617]);
    expect(market.trades[0]).toMatchObject({ give: { res: 'k', amount: 2_000_000 }, want: { res: 'd', amount: 1_300_000 } });
    expect((await call('GET', '/context', carol)).json().marketRate).toMatchObject({ m: 4.055148796006, source: 'source' });
  });

  it('keeps an exact rate within an hour against an estimate', () => {
    const rec = parsePage({ text: fixture('marketplace-de.txt') }).records[0];
    if (rec.kind !== 'marketplace') throw new Error('expected marketplace');
    const sync = () => {
      const summary = { pageType: 'marketplace' as const, source: 'text' as const, lang: 'de' as const, warnings: [], counts: {} as any, preview: [] };
      new Store(db, { groupId: groupA, userId: carolId, timezone: 'Europe/Berlin' }, summary).record({ ...rec, seenAt: now() });
      return summary.counts.market_rates;
    };
    db.prepare("UPDATE market_rates SET time = ? WHERE source = 'source'").run(now() - 600);
    expect(sync()).toEqual({ new: 0, duplicate: 1 });
    db.prepare("UPDATE market_rates SET time = ? WHERE source = 'source'").run(now() - 7200);
    expect(sync()).toEqual({ new: 1, duplicate: 0 });
    expect(rates().at(-1).source).toBe('text');
  });

  it('sets the rate by hand', async () => {
    expect((await call('PUT', '/market/rate', carol, { m: 0, k: 1.5 })).statusCode).toBe(400);
    expect((await call('PUT', '/market/rate', carol, { m: 'x', k: 1.5 })).statusCode).toBe(400);
    const res = await call('PUT', '/market/rate', carol, { m: 3.5, k: 1.5 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ m: 3.5, k: 1.5, source: 'manual', by: 'Carol' });
    expect((await call('GET', '/market', carol)).json().rate).toMatchObject({ m: 3.5, k: 1.5, source: 'manual' });
  });
});
