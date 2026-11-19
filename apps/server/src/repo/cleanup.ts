import { localToEpoch, type HubRecord, type StatsRecord } from '@pr0hub/core';
import { HttpError } from '../auth.js';
import { UNIVERSE_DEFAULTS } from '../config.js';
import type { DB } from '../db.js';
import { catalogOfGroup } from '../context.js';
import { parseRaw, type RawIngest } from '../ingest.js';

export interface UndoResult {
  /** statistics snapshots left without score rows, removed */
  snapshots: number;
  /** score rows the sync brought */
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
const OWNED = new Set(['player_aliases', 'player_status_log', 'activity_log', 'player_activity', 'player_scores', 'alliance_scores']);

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
  // the repeated autumn hour resolved like the sync did (Store takes the instant already past when it stored it)
  const epoch = (local: string | null) => (local ? localToEpoch(local, timezone, row.created_at) : null);
  const g = row.group_id;
  const user = row.user_id;
  const result: UndoResult = {
    snapshots: 0, scores: 0, activity: 0, players: [], alliances: [], kept: [], empires: 0, overviews: 0, fleets: 0, spyReports: 0, skipped: [],
  };
  const records = parseRaw(row, catalogOfGroup(db, g)).records;
  result.skipped = [...new Set(records.map((r) => r.kind).filter((k) => !UNDOABLE.has(k)))];

  const rollback = new Error('dry run');
  try {
    db.transaction(() => {
      const stats: StatsRecord[] = [];
      for (const r of records) {
        if (r.kind === 'stats') {
          stats.push(r);
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
      if (stats.length) removeScores(db, g, stats, epoch, result);
      db.prepare('DELETE FROM raw_ingests WHERE id = ?').run(rawId);
      if (dryRun) throw rollback;
    })();
  } catch (e) {
    if (e !== rollback) throw e;
  }
  return result;
}

/**
 * Removes the score rows the statistics records brought: a snapshot is shared by every paste of one statistics update
 * (other pages, other members), so only the rows matching a line of the records go (same rank and points, the same
 * in-game id when the line has one), and a snapshot only once no rows are left. Rows the same lines of another sync
 * brought are the same rows and go too. Then the score events of the removed rows and the players and alliances
 * nothing refers to any more.
 */
function removeScores(db: DB, groupId: number, records: StatsRecord[], epoch: (local: string | null) => number | null, result: UndoResult) {
  const snapshotsOf = db.prepare('SELECT id, stat_time FROM stat_snapshots WHERE group_id = ? AND who = ? AND stat_time = ? AND (? IS NULL OR type = ?)');
  const playerRow = db.prepare(
    `SELECT s.player_id FROM player_scores s JOIN players p ON p.id = s.player_id
     WHERE s.snapshot_id = ? AND s.rank = ? AND s.points = ? AND (? IS NULL OR p.ingame_id IS NULL OR p.ingame_id = ?)`,
  ).pluck();
  const allyRow = db.prepare(
    `SELECT s.alliance_id FROM alliance_scores s JOIN alliances a ON a.id = s.alliance_id
     WHERE s.snapshot_id = ? AND s.rank = ? AND s.points = ? AND (? IS NULL OR a.ingame_id IS NULL OR a.ingame_id = ?)`,
  ).pluck();
  const dropPlayer = db.prepare('DELETE FROM player_scores WHERE snapshot_id = ? AND player_id = ?');
  const dropAlly = db.prepare('DELETE FROM alliance_scores WHERE snapshot_id = ? AND alliance_id = ?');
  // score events computed from the removed rows
  const events = db.prepare(
    `DELETE FROM activity_log WHERE group_id = ? AND time = ? AND player_id = ? AND kind IN (SELECT value FROM json_each(?))`,
  );
  const playerIds = new Set<number>();
  const touched = new Set<number>();
  for (const r of records) {
    const time = epoch(r.statTime);
    if (!time) continue;
    for (const snap of snapshotsOf.all(groupId, r.who, time, r.type, r.type) as { id: number; stat_time: number }[]) {
      touched.add(snap.id);
      for (const row of r.rows) {
        if (r.who === 'alliance') {
          for (const id of allyRow.all(snap.id, row.rank, row.points, row.ingameId, row.ingameId) as number[]) {
            result.scores += dropAlly.run(snap.id, id).changes;
          }
          continue;
        }
        for (const id of playerRow.all(snap.id, row.rank, row.points, row.ingameId, row.ingameId) as number[]) {
          result.scores += dropPlayer.run(snap.id, id).changes;
          result.activity += events.run(groupId, snap.stat_time, id, JSON.stringify(SCORE_KINDS)).changes;
          playerIds.add(id);
        }
      }
    }
  }
  const empty = db.prepare(
    `DELETE FROM stat_snapshots WHERE id = ? AND NOT EXISTS (SELECT 1 FROM player_scores WHERE snapshot_id = ?)
       AND NOT EXISTS (SELECT 1 FROM alliance_scores WHERE snapshot_id = ?)`,
  );
  for (const id of touched) result.snapshots += empty.run(id, id, id).changes;

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
