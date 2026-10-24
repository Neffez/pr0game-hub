import type { DB } from '../db.js';

export type Score = { points: number; rank: number; time: number };

/** Newest synced score per category (1 total … 5 defense) of the given players: player id → type → score. */
export function latestScores(db: DB, groupId: number, playerIds: number[], types: number[] = [1, 2, 3, 4, 5]): Map<number, Record<number, Score>> {
  const out = new Map<number, Record<number, Score>>();
  if (!playerIds.length) return out;
  const rows = db
    .prepare(
      // SQLite takes the bare columns from the row with the MAX()
      `SELECT ps.player_id, st.type, ps.points, ps.rank, MAX(st.stat_time) AS time FROM player_scores ps JOIN stat_snapshots st ON st.id = ps.snapshot_id
       WHERE st.group_id = ? AND st.who = 'player' AND st.type IN (${types.map(() => '?').join(',')})
         AND ps.player_id IN (${playerIds.map(() => '?').join(',')})
       GROUP BY ps.player_id, st.type`,
    )
    .all(groupId, ...types, ...playerIds) as ({ player_id: number; type: number } & Score)[];
  for (const r of rows) out.set(r.player_id, { ...out.get(r.player_id), [r.type]: { points: r.points, rank: r.rank, time: r.time } });
  return out;
}

/** Statistics categories of the catch-up bonus and their weight (game: buildings ×1, research ×0.8, fleet ×0.6). */
export const CATCH_UP_WEIGHTS: Record<number, number> = { 4: 1, 3: 0.8, 2: 0.6 };

/**
 * The player with the most catch-up points in the latest statistics of each category (the game compares with the best
 * player of the universe); `time`: the oldest of those three updates.
 */
export function catchUpLeader(db: DB, groupId: number) {
  return db
    .prepare(
      `WITH latest AS (SELECT type, MAX(stat_time) AS t FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type IN (2, 3, 4) GROUP BY type)
       SELECT p.name, SUM(CASE st.type WHEN 4 THEN ps.points END) AS buildings, SUM(CASE st.type WHEN 3 THEN ps.points END) AS research,
              SUM(CASE st.type WHEN 2 THEN ps.points END) AS fleet,
              SUM(ps.points * CASE st.type WHEN 4 THEN 1 WHEN 3 THEN 0.8 ELSE 0.6 END) AS weighted,
              (SELECT MIN(t) FROM latest) AS time, (SELECT COUNT(*) FROM latest) AS types
       FROM stat_snapshots st JOIN latest l ON l.type = st.type AND l.t = st.stat_time
       JOIN player_scores ps ON ps.snapshot_id = st.id JOIN players p ON p.id = ps.player_id
       WHERE st.group_id = ? AND st.who = 'player' GROUP BY ps.player_id ORDER BY weighted DESC LIMIT 1`,
    )
    .get(groupId, groupId) as
    | { name: string; buildings: number | null; research: number | null; fleet: number | null; weighted: number; time: number; types: number }
    | undefined;
}
