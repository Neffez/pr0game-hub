import type { DB } from '../db.js';

export interface SnapshotRow {
  id: number;
  who: 'player' | 'alliance';
  type: number;
  stat_time: number;
  created_at: number;
  rows: number;
  /** best ranked names, to tell a foreign snapshot apart */
  top: string[];
}

/** Statistics snapshots of a group, newest first, for the admin cleanup. */
export function listSnapshots(db: DB, groupId: number, limit = 200): SnapshotRow[] {
  const rows = db
    .prepare('SELECT id, who, type, stat_time, created_at FROM stat_snapshots WHERE group_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(groupId, limit) as Omit<SnapshotRow, 'rows' | 'top'>[];
  const players = db.prepare(
    'SELECT p.name FROM player_scores s JOIN players p ON p.id = s.player_id WHERE s.snapshot_id = ? ORDER BY s.rank',
  ).pluck();
  const alliances = db.prepare(
    'SELECT a.name FROM alliance_scores s JOIN alliances a ON a.id = s.alliance_id WHERE s.snapshot_id = ? ORDER BY s.rank',
  ).pluck();
  return rows.map((r) => {
    const names = (r.who === 'player' ? players : alliances).all(r.id) as string[];
    return { ...r, rows: names.length, top: names.slice(0, 3) };
  });
}

export interface CleanupResult {
  snapshots: number;
  scores: number;
  activity: number;
  players: string[];
  alliances: string[];
  /** players of the snapshots that stay because other data refers to them */
  kept: string[];
}

/** Score events the statistics produce (Store.scoreEvents). */
const SCORE_KINDS = ['points_loss', 'fleet_loss', 'no_growth'];

/** Rows owned by a player/alliance that go with it; any other reference keeps it. */
const OWNED = new Set(['player_aliases', 'player_status_log', 'activity_log', 'player_scores', 'alliance_scores']);

/** Tables (and columns) with a foreign key to `table`. */
function references(db: DB, table: string): { table: string; column: string }[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
  return tables.flatMap((t) =>
    (db.pragma(`foreign_key_list(${JSON.stringify(t)})`) as { table: string; from: string }[])
      .filter((fk) => fk.table === table)
      .map((fk) => ({ table: t, column: fk.from })),
  );
}

/**
 * Removes statistics snapshots of a group (e.g. pasted into the wrong universe) and everything they alone brought
 * in: their score events and players that nothing else refers to (no planets, reports, notes, comments, other
 * snapshots …), then the group's alliances without any reference left. Players that stay are listed as `kept`. `dryRun` rolls everything back.
 */
export function cleanupSnapshots(db: DB, groupId: number, snapshotIds: number[], dryRun: boolean): CleanupResult {
  const result: CleanupResult = { snapshots: 0, scores: 0, activity: 0, players: [], alliances: [], kept: [] };
  const rollback = new Error('dry run');
  try {
    db.transaction(() => {
      const ids = JSON.stringify(snapshotIds);
      const snaps = db
        .prepare('SELECT id, stat_time FROM stat_snapshots WHERE group_id = ? AND id IN (SELECT value FROM json_each(?))')
        .all(groupId, ids) as { id: number; stat_time: number }[];
      const own = JSON.stringify(snaps.map((s) => s.id));
      const playerIds = db.prepare('SELECT DISTINCT player_id FROM player_scores WHERE snapshot_id IN (SELECT value FROM json_each(?))').pluck().all(own) as number[];
      result.scores =
        (db.prepare('SELECT COUNT(*) FROM player_scores WHERE snapshot_id IN (SELECT value FROM json_each(?))').pluck().get(own) as number) +
        (db.prepare('SELECT COUNT(*) FROM alliance_scores WHERE snapshot_id IN (SELECT value FROM json_each(?))').pluck().get(own) as number);

      // score events computed from these snapshots
      const events = db.prepare(
        `DELETE FROM activity_log WHERE group_id = ? AND time = ? AND kind IN (SELECT value FROM json_each(?))
           AND player_id IN (SELECT value FROM json_each(?))`,
      );
      for (const s of snaps) result.activity += events.run(groupId, s.stat_time, JSON.stringify(SCORE_KINDS), JSON.stringify(playerIds)).changes;
      result.snapshots = db.prepare('DELETE FROM stat_snapshots WHERE id IN (SELECT value FROM json_each(?))').run(own).changes;

      const referenced = (refs: { table: string; column: string }[], id: number) =>
        refs.some((r) => !OWNED.has(r.table) && db.prepare(`SELECT 1 FROM "${r.table}" WHERE "${r.column}" = ? LIMIT 1`).get(id));
      const playerRefs = references(db, 'players');
      const name = db.prepare('SELECT name, note FROM players WHERE id = ?');
      const remainingScores = db.prepare('SELECT 1 FROM player_scores WHERE player_id = ? LIMIT 1');
      for (const id of playerIds) {
        const p = name.get(id) as { name: string; note: string | null };
        if (p.note || remainingScores.get(id) || referenced(playerRefs, id)) {
          result.kept.push(p.name);
          continue;
        }
        result.activity += db.prepare('DELETE FROM activity_log WHERE player_id = ?').run(id).changes;
        db.prepare('DELETE FROM players WHERE id = ?').run(id);
        result.players.push(p.name);
      }

      // the snapshot rows don't keep which alliances they named: every alliance nothing refers to any more goes
      const allyRefs = references(db, 'alliances');
      const allyScores = db.prepare('SELECT 1 FROM alliance_scores WHERE alliance_id = ? LIMIT 1');
      const alliances = db.prepare('SELECT id, name FROM alliances WHERE group_id = ?').all(groupId) as { id: number; name: string }[];
      for (const a of alliances) {
        if (allyScores.get(a.id) || referenced(allyRefs, a.id)) continue;
        result.alliances.push(a.name);
        db.prepare('DELETE FROM alliances WHERE id = ?').run(a.id);
      }
      if (dryRun) throw rollback;
    })();
  } catch (e) {
    if (e !== rollback) throw e;
  }
  return result;
}
