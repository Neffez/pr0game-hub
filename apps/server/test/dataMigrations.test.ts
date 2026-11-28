import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { openDb } = await import('../src/db.js');
const dir = mkdtempSync(join(tmpdir(), 'hub-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('data migrations', () => {
  it('hashes invite links stored in plain text once, so open links keep working', () => {
    const file = join(dir, 'hub.db');
    let db = openDb(file);
    // an invite of a version before the hashing
    db.prepare("INSERT INTO invites (token, role, expires_at) VALUES ('plain-token', 'member', 9999999999)").run();
    db.prepare("DELETE FROM schema_migrations WHERE name = 'js:hash_invite_tokens'").run();
    db.close();
    db = openDb(file);
    const sha = createHash('sha256').update('plain-token').digest('hex');
    expect(db.prepare('SELECT token FROM invites').pluck().all()).toEqual([sha]);
    db.close();
    // recorded: not hashed a second time
    db = openDb(file);
    expect(db.prepare('SELECT token FROM invites').pluck().all()).toEqual([sha]);
    db.close();
  });

  it('rebuilds the syncs from the raw syncs: only those that brought something new, own state pages throttled', () => {
    const file = join(dir, 'syncs.db');
    let db = openDb(file);
    db.prepare("INSERT INTO universes (slug, name, settings) VALUES ('u1', 'U1', '{}')").run();
    const uni = db.prepare("SELECT id FROM universes WHERE slug = 'u1'").pluck().get();
    const group = Number(db.prepare("INSERT INTO groups (universe_id, name) VALUES (?, 'A')").run(uni).lastInsertRowid);
    const user = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('rolf', 'x')").run().lastInsertRowid);
    const at = Math.floor(Date.UTC(2026, 10, 19, 10) / 1000);
    const raw = (page: string, counts: object, t: number) =>
      db.prepare('INSERT INTO raw_ingests (group_id, user_id, source, page_type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(group, user, 'paste', page, JSON.stringify({ counts }), t);
    const credit = (day: string, key: string, count: number) =>
      db.prepare("INSERT INTO sync_credits (group_id, user_id, day, kind, key, count) VALUES (?, ?, ?, 'sync', ?, ?)").run(group, user, day, key, count);
    // the earliest raw sync's day may be cut off: it and the days before keep their counts
    raw('messages', { spy: { new: 1, duplicate: 0 } }, at - 2 * 86400);
    credit('2026-11-16', 'galaxy', 4);
    credit('2026-11-17', 'messages', 5);
    raw('messages', { spy: { new: 3, duplicate: 0 } }, at - 86400);
    raw('messages', { spy: { new: 0, duplicate: 2 } }, at - 86400 + 60);
    credit('2026-11-18', 'messages', 2);
    raw('galaxy', {}, at - 3600);
    raw('empire', { empire: { new: 1, duplicate: 0 } }, at + 60);
    credit('2026-11-19', 'empire', 1);
    // the Imperium once an hour, the overview every 15 minutes, messages with new reports every time
    raw('empire', { empire: { new: 1, duplicate: 0 } }, at + 600);
    raw('empire', { empire: { new: 1, duplicate: 0 } }, at + 3660);
    raw('overview', { overview: { new: 1, duplicate: 0 } }, at + 100);
    raw('overview', { overview: { new: 1, duplicate: 0 } }, at + 500);
    raw('overview', { overview: { new: 1, duplicate: 0 } }, at + 1000);
    raw('messages', { spy: { new: 1, duplicate: 0 } }, at + 120);
    raw('messages', { battle_reports: { new: 1, duplicate: 0 } }, at + 130);
    // a galaxy page counts when the system changed, a player card once a day per player, the marketplace once a day
    const fixture = (name: string) => gzipSync(readFileSync(new URL(`../../../packages/parser/test/fixtures/${name}`, import.meta.url)));
    const page = (type: string, html: Buffer, counts: object, t: number) =>
      db.prepare('INSERT INTO raw_ingests (group_id, user_id, source, page_type, html_gz, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(group, user, 'paste', type, html, JSON.stringify({ counts }), t);
    page('galaxy', fixture('galaxy.html'), { galaxy_systems: { new: 1, duplicate: 0 } }, at + 200);
    page('galaxy', fixture('galaxy.html'), { galaxy_systems: { new: 1, duplicate: 0 } }, at + 300);
    page('playerCard', fixture('playercard.html'), { player_cards: { new: 1, duplicate: 0 } }, at + 400);
    page('playerCard', fixture('playercard.html'), { player_cards: { new: 1, duplicate: 0 } }, at + 500);
    raw('marketplace', { market_rates: { new: 1, duplicate: 0 } }, at + 600);
    raw('marketplace', { market_rates: { new: 1, duplicate: 0 } }, at + 7200);
    db.prepare("DELETE FROM schema_migrations WHERE name = 'js:sync_counts_throttled'").run();
    db.close();
    const expected = [
      { day: '2026-11-16', key: 'galaxy', count: 4 },
      { day: '2026-11-17', key: 'messages', count: 5 },
      { day: '2026-11-18', key: 'messages', count: 1 },
      { day: '2026-11-19', key: 'empire', count: 2 },
      { day: '2026-11-19', key: 'galaxy', count: 1 },
      { day: '2026-11-19', key: 'marketplace', count: 1 },
      { day: '2026-11-19', key: 'messages', count: 2 },
      { day: '2026-11-19', key: 'overview', count: 2 },
      { day: '2026-11-19', key: expect.stringMatching(/^playerCard:./), count: 1 },
    ];
    db = openDb(file);
    expect(db.prepare("SELECT day, key, count FROM sync_credits WHERE kind = 'sync' ORDER BY day, key").all()).toEqual(expected);
    db.close();
    db = openDb(file);
    expect(db.prepare("SELECT day, key, count FROM sync_credits WHERE kind = 'sync' ORDER BY day, key").all()).toEqual(expected);
    db.close();
  });

  it('credits the imperator badge back for every day with a counted empire sync', () => {
    const db = openDb(join(dir, 'imperator.db'));
    db.prepare("INSERT INTO universes (slug, name, settings) VALUES ('u1', 'U1', '{}')").run();
    const uni = db.prepare("SELECT id FROM universes WHERE slug = 'u1'").pluck().get();
    const group = Number(db.prepare("INSERT INTO groups (universe_id, name) VALUES (?, 'A')").run(uni).lastInsertRowid);
    const user = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES ('ares', 'x')").run().lastInsertRowid);
    const put = db.prepare('INSERT INTO sync_credits (group_id, user_id, day, kind, key, count, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    // days with empire syncs (several a day); only the first one was credited, the 20th by an earlier page
    for (const day of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) put.run(group, user, day, 'sync', 'empire', 12, 1);
    put.run(group, user, '2026-11-18', 'empire', '', 1, 7);
    put.run(group, user, '2026-11-22', 'sync', 'overview', 3, 1);
    db.exec(readFileSync(new URL('../migrations/105_imperator_backfill.sql', import.meta.url), 'utf8'));
    expect(db.prepare("SELECT day, count, last_at FROM sync_credits WHERE kind = 'empire' ORDER BY day").all()).toEqual([
      { day: '2026-11-18', count: 1, last_at: 7 },
      { day: '2026-11-19', count: 1, last_at: null },
      { day: '2026-11-20', count: 1, last_at: null },
      { day: '2026-11-21', count: 1, last_at: null },
    ]);
    db.close();
  });

  it('drops stored universe settings that are no setting, and keeps the rest', () => {
    const file = join(dir, 'settings.db');
    let db = openDb(file);
    db.prepare("INSERT INTO universes (slug, name, settings) VALUES ('u1', 'U1', ?)").run(JSON.stringify({ galaxies: 4, oldSetting: true, positionBonus: { 8: [1, 0, 0] } }));
    db.prepare("DELETE FROM schema_migrations WHERE name = 'js:drop_unknown_universe_settings'").run();
    db.close();
    db = openDb(file);
    expect(JSON.parse(db.prepare("SELECT settings FROM universes WHERE slug = 'u1'").pluck().get() as string)).toEqual({ galaxies: 4, positionBonus: { 8: [1, 0, 0] } });
    db.close();
  });
});
