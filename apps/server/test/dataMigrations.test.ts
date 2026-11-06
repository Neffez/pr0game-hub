import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
