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
