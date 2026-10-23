import { localToEpoch, type HubRecord } from '@pr0hub/core';
import { HttpError } from '../auth.js';
import { UNIVERSE_DEFAULTS } from '../config.js';
import type { DB } from '../db.js';
import { parseRaw, type RawIngest } from '../ingest.js';

export interface UndoResult {
  /** statistics snapshots with their score rows and score events */
  snapshots: number;
  scores: number;
  activity: number;
  /** players/alliances only the snapshots brought in */
  players: string[];
  alliances: string[];
  /** players of the snapshots that stay because other data refers to them */
  kept: string[];
  empires: number;
  overviews: number;
  fleets: number;
  spyReports: number;
  /** record kinds of the sync that can't be taken back (e.g. galaxy views: only the newest state is stored) */
  skipped: string[];
}

/** Score events the statistics produce (Store.scoreEvents). */
const SCORE_KINDS = ['points_loss', 'fleet_loss', 'no_growth'];

/** Rows owned by a player/alliance that go with it; any other reference keeps it. */
const OWNED = new Set(['player_aliases', 'player_status_log', 'activity_log', 'player_scores', 'alliance_scores']);

/** Record kinds whose rows a sync can find again and remove. */
const UNDOABLE = new Set<HubRecord['kind']>(['stats', 'empire', 'overview', 'fleets', 'spy']);

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
 * Takes a stored sync back (e.g. a page of another universe): parses it again and removes what it stored.
 * Statistics take their score events and the players nothing else refers to (no planets, reports, notes, comments,
 * other snapshots …) along, then the group's alliances without any reference left. Empire, overview and fleet pages
 * and spy reports are removed by their page/report time. The sync itself is deleted too. `dryRun` rolls back.
 */
export function undoIngest(db: DB, rawId: number, dryRun: boolean): UndoResult {
  const row = db
    .prepare(
      `SELECT r.*, u.settings FROM raw_ingests r JOIN groups g ON g.id = r.group_id JOIN universes u ON u.id = g.universe_id WHERE r.id = ?`,
    )
    .get(rawId) as (RawIngest & { settings: string }) | undefined;
  if (!row) throw new HttpError(404, 'not_found', 'Not found');
  if (!row.html_gz && !row.text_gz) throw new HttpError(400, 'ingest_no_content', 'The page of this sync is not stored');
  const timezone = JSON.parse(row.settings).timezone ?? UNIVERSE_DEFAULTS.timezone;
  const epoch = (local: string | null) => (local ? localToEpoch(local, timezone) : null);
  const g = row.group_id;
  const user = row.user_id;
  const result: UndoResult = {
    snapshots: 0, scores: 0, activity: 0, players: [], alliances: [], kept: [], empires: 0, overviews: 0, fleets: 0, spyReports: 0, skipped: [],
  };
  const records = parseRaw(row).records;
  result.skipped = [...new Set(records.map((r) => r.kind).filter((k) => !UNDOABLE.has(k)))];

  const rollback = new Error('dry run');
  try {
    db.transaction(() => {
      const snapshotIds: number[] = [];
      const snapshot = db.prepare('SELECT id FROM stat_snapshots WHERE group_id = ? AND who = ? AND stat_time = ? AND (? IS NULL OR type = ?)').pluck();
      for (const r of records) {
        if (r.kind === 'stats') {
          const time = epoch(r.statTime);
          if (time) snapshotIds.push(...(snapshot.all(g, r.who, time, r.type, r.type) as number[]));
        } else if (r.kind === 'empire') {
          result.empires += db
            .prepare('DELETE FROM empire_snapshots WHERE group_id = ? AND user_id IS ? AND (data = ? OR created_at = ?)')
            .run(g, user, JSON.stringify(r), epoch(r.pageTime ?? null)).changes;
        } else if (r.kind === 'overview') {
          result.overviews += db
            .prepare('DELETE FROM overview_snapshots WHERE group_id = ? AND user_id IS ? AND (data = ? OR page_time = ?)')
            .run(g, user, JSON.stringify(r), epoch(r.pageTime)).changes;
        } else if (r.kind === 'fleets') {
          result.fleets += db
            .prepare('DELETE FROM fleet_snapshots WHERE group_id = ? AND user_id IS ? AND page_time = ?')
            .run(g, user, epoch(r.pageTime)).changes;
        } else if (r.kind === 'spy') {
          result.spyReports += db
            .prepare('DELETE FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ? AND report_time = ?')
            .run(g, r.coords.g, r.coords.s, r.coords.p, r.planetType, epoch(r.reportTime)).changes;
        }
      }
      if (snapshotIds.length) removeSnapshots(db, g, [...new Set(snapshotIds)], result);
      db.prepare('DELETE FROM raw_ingests WHERE id = ?').run(rawId);
      if (dryRun) throw rollback;
    })();
  } catch (e) {
    if (e !== rollback) throw e;
  }
  return result;
}

function removeSnapshots(db: DB, groupId: number, ids: number[], result: UndoResult) {
  const own = JSON.stringify(ids);
  const snaps = db.prepare('SELECT id, stat_time FROM stat_snapshots WHERE id IN (SELECT value FROM json_each(?))').all(own) as { id: number; stat_time: number }[];
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
}
