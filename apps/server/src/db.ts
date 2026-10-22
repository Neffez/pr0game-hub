import Database from 'better-sqlite3';
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
  migrate(db);
  cacheStatements(db);
  return db;
}

/** Upper bound of cached statements (SQL with generated `IN (?, …)` lists varies with the input). */
const STATEMENT_CACHE = 1000;

/**
 * better-sqlite3 compiles the SQL on every `prepare()`, and the code prepares inline, also in loops
 * (per planet of a universe.json). Caches statements by their SQL instead. A cached statement is
 * handed out with `pluck` reset, since `.pluck()` changes the statement itself.
 */
function cacheStatements(db: DB) {
  const cache = new Map<string, Database.Statement>();
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    let stmt = cache.get(sql);
    if (stmt) {
      if (stmt.reader) stmt.pluck(false);
      return stmt;
    }
    stmt = prepare(sql);
    if (cache.size >= STATEMENT_CACHE) cache.clear();
    cache.set(sql, stmt);
    return stmt;
  }) as DB['prepare'];
}

function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').pluck().all() as string[]);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));
  if (!pending.length) return;
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

export const now = () => Math.floor(Date.now() / 1000);
