import { recordLevel, type CatchUpRecords, type RecordHint } from '@pr0hub/core/buildings';
import type { DB } from '../db.js';

/**
 * Record levels of the universe for the catch-up bonus (`catchUpAt`): the game rebuilds its records with each
 * statistics update, and they only grow. Known from the records page (exact) and from the costs of buildings and
 * research pages (`recordHints`: exact, at most or at least). Per element the bounds are kept: an upper bound holds
 * until a lower bound above it shows that the record has grown since.
 */

type Row = { element_id: number; min_level: number | null; max_level: number | null; updated_at: number };

/** Takes what a page tells about record levels in (`time`: when it was seen). */
export function noteRecordHints(db: DB, groupId: number, hints: RecordHint[], time: number): void {
  if (!hints.length) return;
  const get = db.prepare('SELECT element_id, min_level, max_level, updated_at FROM catchup_records WHERE group_id = ? AND element_id = ?');
  const put = db.prepare(
    `INSERT INTO catchup_records (group_id, element_id, min_level, max_level, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (group_id, element_id) DO UPDATE SET min_level = excluded.min_level, max_level = excluded.max_level, updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    for (const h of hints) {
      const row = get.get(groupId, h.id) as Row | undefined;
      const next = merge(row ?? null, h, time);
      if (next) put.run(groupId, h.id, next.min, next.max, next.time);
    }
  })();
}

/** The bounds after a new hint; null when it tells nothing new (an older page). */
function merge(row: Row | null, h: RecordHint, time: number): { min: number | null; max: number | null; time: number } | null {
  if (!row) return { min: h.min, max: h.max, time };
  const newer = time >= row.updated_at;
  let { min_level: min, max_level: max } = row;
  if (h.min != null && h.max != null) {
    // exact: the newer one wins; an older one is still a lower bound (records only grow)
    if (newer) {
      min = h.min;
      max = h.max;
    } else min = Math.max(min ?? h.min, h.min);
  } else if (h.max != null) {
    // at most: tighter than what is known, or what is known is out of date
    const valid = max != null && (min == null || min <= max);
    if (!valid || h.max < max!) max = h.max;
    // newer and below the lower bound: the record went down (a planet given up), the lower bound is out of date
    if (newer && min != null && h.max < min) min = null;
  } else if (h.min != null) {
    min = Math.max(min ?? h.min, h.min);
  }
  if (min === row.min_level && max === row.max_level && !newer) return null;
  return { min, max, time: Math.max(time, row.updated_at) };
}

/** The record level to reckon with per element (`recordLevel`); elements without an upper bound are left out. */
export function catchUpRecords(db: DB, groupId: number): CatchUpRecords {
  const rows = db.prepare('SELECT element_id, min_level, max_level, updated_at FROM catchup_records WHERE group_id = ?').all(groupId) as Row[];
  const out: CatchUpRecords = {};
  for (const r of rows) {
    const level = recordLevel({ min: r.min_level, max: r.max_level });
    if (level != null) out[r.element_id] = level;
  }
  return out;
}
