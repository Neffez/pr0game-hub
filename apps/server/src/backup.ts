// Online backup of the SQLite database: node dist/backup.js [targetDir] [keep]
// Writes hub-YYYYMMDD-HHMMSS.db and keeps the newest `keep` files (default 7).
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config } from './config.js';

const targetDir = process.argv[2] ?? join(config.dataDir, 'backups');
const keepArg = process.argv[3] ?? '7';
// a typo (`7d`) or 0 would remove every backup, the new one included
if (!/^[1-9]\d*$/.test(keepArg)) {
  console.error(`backup: keep must be a whole number of at least 1, got "${keepArg}"`);
  process.exit(2);
}
const keep = Number(keepArg);

mkdirSync(targetDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const file = join(targetDir, `hub-${stamp}.db`);

const db = new Database(join(config.dataDir, 'hub.db'), { readonly: true });
await db.backup(file);
db.close();

// the file just written always stays (a newer name from a clock set back would push it out otherwise)
const name = basename(file);
const old = readdirSync(targetDir).filter((f) => /^hub-\d{8}-\d{6}\.db$/.test(f) && f !== name).sort().reverse().slice(keep - 1);
for (const f of old) rmSync(join(targetDir, f));
console.error(JSON.stringify({ msg: 'backup', file, keep, removed: old.length }));
console.log(file);
