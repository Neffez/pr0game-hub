import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';

/** The migrated schema: checks that catch a migration copied from an older one (N-02 of the 2026-11-15 review). */
describe('schema', () => {
  const db = openDb(':memory:');

  it('has no two indexes on the same columns of a table (UNIQUE constraints included)', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
    const duplicates: string[] = [];
    for (const table of tables) {
      const seen = new Map<string, string>();
      for (const idx of db.pragma(`index_list(${JSON.stringify(table)})`) as { name: string; partial: number }[]) {
        if (idx.partial) continue;
        const columns = (db.pragma(`index_info(${JSON.stringify(idx.name)})`) as { seqno: number; name: string }[])
          .sort((a, b) => a.seqno - b.seqno)
          .map((c) => c.name)
          .join(',');
        const other = seen.get(columns);
        if (other) duplicates.push(`${table}: ${idx.name} = ${other} (${columns})`);
        else seen.set(columns, idx.name);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('keeps the triggers that clean up held notifications', () => {
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").pluck().all();
    expect(triggers).toEqual(expect.arrayContaining(['push_subscriptions_held_delete', 'push_subscriptions_held_owner', 'users_held_delete']));
  });
});
