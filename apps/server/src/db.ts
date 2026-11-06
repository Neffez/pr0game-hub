import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
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
};

export const now = () => Math.floor(Date.now() / 1000);
