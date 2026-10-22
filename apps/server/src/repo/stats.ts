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
