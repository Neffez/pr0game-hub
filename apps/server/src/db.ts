import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parsePage, type HubRecord } from '@pr0hub/core';
import { SETTING_KEYS } from '@pr0hub/core/universe';
import { backfillDisplayNamesFromIngame } from './displayName.js';
import { countSync, galaxyFingerprint } from './repo/syncCount.js';

export { backfillDisplayNamesFromIngame } from './displayName.js';

export type DB = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  // With WAL, NORMAL syncs at checkpoints instead of every commit and keeps the database consistent; a power loss can
  // only drop the last commits. Every sync is a transaction, so FULL paid an fsync per pasted page.
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // A big transaction (universe.json, migrations) grows the WAL file; without a limit it keeps that size for good.
  db.pragma(`journal_size_limit = ${64 * 1024 * 1024}`);
  migrate(db);
  cacheStatements(db);
  return db;
}

/** Upper bound of cached statements (SQL with generated `IN (?, …)` lists varies with the input). */
const STATEMENT_CACHE = 1000;

/**
 * better-sqlite3 compiles the SQL on every `prepare()`, and the code prepares inline, also in loops
 * (per planet of a universe.json). Caches statements by their SQL instead. `.pluck()` changes a statement itself, so
 * a cached reader never gets plucked: its `pluck(true)` hands out a second cached statement of the same SQL that
 * always plucks, and `pluck(false)` on that one the plain one. A plucked statement kept by one caller stays plucked
 * whatever others prepare.
 */
function cacheStatements(db: DB) {
  const plain = new Map<string, Database.Statement>();
  const plucked = new Map<string, Database.Statement>();
  const prepare = db.prepare.bind(db);
  const pair = (sql: string, stmt: Database.Statement) => {
    if (!stmt.reader) return stmt;
    const pluckedOf = () => {
      let p = plucked.get(sql);
      if (!p) {
        p = prepare(sql);
        p.pluck(true);
        // the plucked one never turns back either
        p.pluck = ((on = true) => (on ? p! : stmt)) as Database.Statement['pluck'];
        plucked.set(sql, p);
      }
      return p;
    };
    stmt.pluck = ((on = true) => (on ? pluckedOf() : stmt)) as Database.Statement['pluck'];
    return stmt;
  };
  db.prepare = ((sql: string) => {
    let stmt = plain.get(sql);
    if (stmt) return stmt;
    stmt = pair(sql, prepare(sql));
    if (plain.size >= STATEMENT_CACHE) {
      plain.clear();
      plucked.clear();
    }
    plain.set(sql, stmt);
    return stmt;
  }) as DB['prepare'];
}

function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').pluck().all() as string[]);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));
  if (pending.length) runSqlMigrations(db, pending);
  for (const [name, run] of Object.entries(DATA_MIGRATIONS)) {
    if (applied.has(name)) continue;
    db.transaction(() => {
      run(db);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, unixepoch())').run(name);
    })();
  }
}

function runSqlMigrations(db: DB, pending: string[]) {
  // Foreign keys off while migrating so tables can be rebuilt (SQLite's way to change constraints)
  // without cascading deletes; checked again before each commit. Cannot change inside a transaction.
  db.pragma('foreign_keys = OFF');
  try {
    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        const broken = db.pragma('foreign_key_check') as unknown[];
        if (broken.length) throw new Error(`migration ${file}: ${broken.length} foreign key violations`);
        db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, unixepoch())').run(file);
      })();
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/** Data changes SQL can't do (run once after the SQL migrations, recorded like them). */
const DATA_MIGRATIONS: Record<string, (db: DB) => void> = {
  // invite links are stored as SHA-256 like sessions and API tokens; open links keep working
  'js:hash_invite_tokens': (db) => {
    const rows = db.prepare('SELECT rowid, token FROM invites').all() as { rowid: number; token: string }[];
    const set = db.prepare('UPDATE invites SET token = ? WHERE rowid = ?');
    for (const r of rows) set.run(createHash('sha256').update(r.token).digest('hex'), r.rowid);
  },
  // login usernames are ASCII; umlauts in the in-game name became `_` and showed in the online list
  'js:display_name_from_sanitized_ingame': backfillDisplayNamesFromIngame,
  // unknown setting keys are refused from now on; drop the ones stored before, so the admin form saves again
  'js:drop_unknown_universe_settings': (db) => {
    const known = new Set(SETTING_KEYS);
    const set = db.prepare('UPDATE universes SET settings = ? WHERE id = ?');
    for (const u of db.prepare('SELECT id, settings FROM universes').all() as { id: number; settings: string }[]) {
      const stored = JSON.parse(u.settings) as Record<string, unknown>;
      const kept = Object.fromEntries(Object.entries(stored).filter(([k]) => known.has(k)));
      if (Object.keys(kept).length !== Object.keys(stored).length) set.run(JSON.stringify(kept), u.id);
    }
  },
  // superseded by the next one (it read the summary's counts as numbers and so filled in nothing)
  'js:sync_counts_from_raw_ingests': () => {},
  // superseded by the next one (it also counted syncs that brought nothing new)
  'js:sync_counts_from_raw_ingests_2': () => {},
  // superseded by the next one (it counted every sync with something new, also the same page many times an hour)
  'js:sync_counts_new_only': () => {},
  // the recap counts syncs that brought something new (sync_credits kind 'sync') within the rule of their page type
  // (repo/syncCount.ts): rebuilt from the raw syncs for the whole days they still cover (a record of the summary new
  // or changed), the days before them stay as they are. Galaxy and player card pages are parsed again: a galaxy page
  // counts when a system's fingerprint differs from the group's view before it in the raw syncs (the first one in
  // them counts), a card once per player; the fingerprints become the systems' current ones.
  'js:sync_counts_throttled': (db) => {
    const zones = new Map<number, Intl.DateTimeFormat>();
    const dayOf = (groupId: number, settings: string, epoch: number) => {
      let f = zones.get(groupId);
      if (!f) {
        const tz = (JSON.parse(settings) as { timezone?: string }).timezone || 'Europe/Berlin';
        zones.set(groupId, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })));
      }
      return f.format(new Date(epoch * 1000));
    };
    const rows = db
      .prepare(
        `SELECT r.id, r.group_id, COALESCE(r.synced_by, r.user_id) AS user_id, r.page_type, r.summary, r.created_at, u.settings
         FROM raw_ingests r JOIN groups g ON g.id = r.group_id JOIN universes u ON u.id = g.universe_id
         ORDER BY r.created_at, r.id`,
      )
      .all() as { id: number; group_id: number; user_id: number | null; page_type: string; summary: string | null; created_at: number; settings: string }[];
    const page = db.prepare('SELECT url, html_gz, text_gz FROM raw_ingests WHERE id = ?');
    const parse = (id: number): HubRecord[] => {
      const raw = page.get(id) as { url: string | null; html_gz: Buffer | null; text_gz: Buffer | null };
      try {
        return parsePage({
          html: raw.html_gz ? gunzipSync(raw.html_gz).toString('utf8') : null,
          text: raw.text_gz ? gunzipSync(raw.text_gz).toString('utf8') : null,
          url: raw.url,
        }).records;
      } catch {
        return [];
      }
    };
    // group:g:s -> fingerprint of the last view in the raw syncs
    const fingerprints = new Map<string, string>();
    // per group the first day the raw syncs cover whole: the day after their earliest one (older ones are deleted)
    const firstDay = new Map<number, string>();
    for (const r of rows) {
      if (firstDay.has(r.group_id)) continue;
      const d = new Date(`${dayOf(r.group_id, r.settings, r.created_at)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      firstDay.set(r.group_id, d.toISOString().slice(0, 10));
    }
    const clear = db.prepare("DELETE FROM sync_credits WHERE group_id = ? AND kind = 'sync' AND day >= ?");
    for (const [group, day] of firstDay) clear.run(group, day);
    for (const r of rows) {
      if (r.page_type === 'unknown') continue;
      const day = dayOf(r.group_id, r.settings, r.created_at);
      const counting = r.user_id != null && day >= firstDay.get(r.group_id)!;
      if (r.page_type === 'galaxy') {
        // every galaxy page moves the fingerprints on, also those before the first whole day
        let news = false;
        for (const rec of parse(r.id)) {
          if (rec.kind !== 'galaxy') continue;
          const key = `${r.group_id}:${rec.g}:${rec.s}`;
          const fp = galaxyFingerprint(rec);
          if (fingerprints.get(key) !== fp) news = true;
          fingerprints.set(key, fp);
        }
        if (counting && news) countSync(db, r.group_id, r.user_id!, day, r.page_type, r.created_at);
        continue;
      }
      if (!counting) continue;
      let counts: Record<string, { new?: number }> = {};
      try {
        counts = (JSON.parse(r.summary ?? '{}') as { counts?: typeof counts }).counts ?? {};
      } catch {
        /* no summary */
      }
      if (!Object.values(counts).some((c) => (c?.new ?? 0) > 0)) continue;
      let unit: string | null = null;
      if (r.page_type === 'playerCard') {
        const card = parse(r.id).find((x) => x.kind === 'playerCard');
        unit = card ? String(card.ingameId ?? card.name) : null;
      }
      countSync(db, r.group_id, r.user_id!, day, r.page_type, r.created_at, unit);
    }
    const setFingerprint = db.prepare('UPDATE galaxy_views SET fingerprint = ? WHERE group_id = ? AND g = ? AND s = ?');
    for (const [key, fp] of fingerprints) {
      const [group, g, s] = key.split(':').map(Number);
      setFingerprint.run(fp, group, g, s);
    }
  },
};

export const now = () => Math.floor(Date.now() / 1000);
