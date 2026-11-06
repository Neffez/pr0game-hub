import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { openDb } = await import('../src/db.js');

/**
 * Group isolation (A-03): every SQL statement on a table with a `group_id` column filters by it, or addresses rows by
 * a key that was looked up within the group before (`WHERE id = ?`, `plan_id`, `player_id`, …). What remains is
 * listed here with its reason; a new statement without a group filter fails this test.
 */
const ALLOWED: Record<string, string> = {
  'src/crawler.ts|UPDATE battle_hall SET report_tries = 0': 'crawler retry reset across all groups',
  'src/db.ts|SELECT rowid, token FROM invites': 'data migration over all rows',
  'src/db.ts|UPDATE invites SET token = ?': 'data migration over all rows',
  'src/monitor.ts|SELECT date(created_at': 'hub monitor statistics (global admins)',
  'src/monitor.ts|SELECT user_id FROM group_members': 'hub monitor statistics (global admins)',
  'src/monitor.ts|DELETE FROM raw_ingests WHERE created_at': 'retention cleanup across all groups',
  'src/monitor.ts|DELETE FROM player_activity WHERE time': 'retention cleanup across all groups',
  'src/monitor.ts|DELETE FROM member_online WHERE slot': 'retention cleanup across all groups',
  'src/routes/admin.ts|SELECT SUM(CASE WHEN report_status': 'crawler statistics (global admins)',
  'src/routes/plans.ts|UPDATE attack_plans SET ${cols': 'dynamic columns, WHERE id = ? of a plan of the group',
  'src/routes/reports.ts|SELECT COUNT(*) FROM battle_hall h WHERE ${where}': '`where` starts with h.group_id = ?',
};

const KEYED = /WHERE\s+(\w+\.)?(id|plan_id|player_id|token|user_id|snapshot_id)\s*(=|IN\b)/i;
const root = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('group isolation', () => {
  it('filters every statement on group tables by group_id (or a key looked up in the group)', () => {
    const db = openDb(':memory:');
    const groupTables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[]).filter((t) =>
        (db.pragma(`table_info(${JSON.stringify(t)})`) as { name: string }[]).some((c) => c.name === 'group_id'),
      ),
    );
    expect(groupTables.size).toBeGreaterThan(20);
    const found: string[] = [];
    const used = new Set<string>();
    for (const file of sources(join(root, 'src'))) {
      const rel = relative(root, file).replaceAll('\\', '/');
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/prepare\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
        const sql = m[1].slice(1, -1).replace(/\s+/g, ' ').trim();
        const tables = [...sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(\w+)/gi)].map((x) => x[1]).filter((t) => groupTables.has(t));
        if (!tables.length || /group_id/.test(sql) || KEYED.test(sql)) continue;
        const allowed = Object.keys(ALLOWED).find((k) => k.startsWith(`${rel}|`) && sql.startsWith(k.slice(rel.length + 1)));
        if (allowed) used.add(allowed);
        else found.push(`${rel}:${src.slice(0, m.index).split('\n').length} ${sql.slice(0, 120)}`);
      }
    }
    expect(found).toEqual([]);
    // entries that match nothing any more are removed from the list
    expect(Object.keys(ALLOWED).filter((k) => !used.has(k))).toEqual([]);
  });
});
