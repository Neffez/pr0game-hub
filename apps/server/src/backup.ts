// Online backup of the SQLite database: node dist/backup.js [targetDir] [keep]
// Writes hub-YYYYMMDD-HHMMSS.db and keeps the newest `keep` files (default 7).
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const targetDir = process.argv[2] ?? join(config.dataDir, 'backups');
const keep = Number(process.argv[3] ?? 7);

mkdirSync(targetDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const file = join(targetDir, `hub-${stamp}.db`);

const db = new Database(join(config.dataDir, 'hub.db'), { readonly: true });
await db.backup(file);
db.close();

const old = readdirSync(targetDir).filter((f) => /^hub-\d{8}-\d{6}\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) rmSync(join(targetDir, f));
console.log(file);
