/** Delta windows in seconds. Snapshots up to 15 min "too new" still count (pastes aren't exact). */
export const WINDOWS: Record<string, number> = {
  prev: 0,
  '6h': 6 * 3600,
  '12h': 12 * 3600,
  '18h': 18 * 3600,
  '24h': 86400,
  '48h': 2 * 86400,
  '7d': 7 * 86400,
};

export const TOLERANCE = 900;

/** Statistics interval of pr0game (0, 6, 12 and 18 o'clock) and the number of Δ columns in the planet view. */
export const SLOT = 6 * 3600;

export const SLOTS = 4;

/** An update up to 90 min newer than a grid point still counts for it (daylight saving time, slow updates). */
export const SLOT_TOLERANCE = 90 * 60;

/**
 * FF-Hub style Δ columns: 6 h sections back from the newest synced update. A section shows the change from
 * the update at its start to the update at its end. If updates are missing, the change since the next older
 * synced update goes into the newest section it covers and the sections in between stay empty
 * (synced 18:00 and 06:00, missed 12:00: section 1 = 06:00 → 18:00, section 2 empty).
 */
export function statSlots(updates: number[]): ({ from: number; to: number } | null)[] {
  const slots: ({ from: number; to: number } | null)[] = Array(SLOTS).fill(null);
  if (!updates.length) return slots;
  const newest = Math.max(...updates);
  // Each update belongs to the grid point at or before it (with tolerance), so off-grid updates (test server)
  // still count; per grid point the update closest to it (servers that update more often have several).
  const atPoint = new Map<number, number>();
  for (const t of updates) {
    const k = Math.floor((newest - t + SLOT_TOLERANCE) / SLOT);
    const off = Math.abs(newest - k * SLOT - t);
    if (k > SLOTS) continue;
    const prev = atPoint.get(k);
    if (prev == null || off < Math.abs(newest - k * SLOT - prev)) atPoint.set(k, t);
  }
  const points = [...atPoint.keys()].sort((a, b) => a - b);
  for (let i = 0; i + 1 < points.length; i++) {
    slots[points[i]] = { from: atPoint.get(points[i + 1])!, to: atPoint.get(points[i])! };
  }
  return slots;
}

/** Score categories of the overview (points, fleet, research, buildings, defense). */
export const TYPES = [1, 2, 3, 4, 5] as const;

export type ScoreRow = { points: number; rank: number; rank_change: number | null; stat_time: number };

/**
 * A player's overview entry of one category from their score history (newest first): current points, the change
 * per Δ window (compared with the oldest score, marked partial, while the history is shorter) and per 6 h section.
 */
export function scoreEntry(history: ScoreRow[], sections: ReturnType<typeof statSlots>) {
  const cur = history[0];
  const deltas: Record<string, { delta: number; since: number; partial: boolean }> = {};
  for (const [win, secs] of Object.entries(WINDOWS)) {
    const back = secs === 0 ? 1 : secs - TOLERANCE;
    let ref = history.find((r) => r.stat_time <= cur.stat_time - back);
    // Not enough history yet: compare with the oldest snapshot, marked as partial.
    const partial = !ref && history.length > 1;
    if (partial) ref = history[history.length - 1];
    if (ref) deltas[win] = { delta: cur.points - ref.points, since: ref.stat_time, partial };
  }
  // FF-Hub style 6 h sections, the same for every player (see statSlots)
  const at = (t: number) => history.find((h) => h.stat_time === t);
  const slots = sections.map((sec) => {
    const to = sec && at(sec.to);
    const from = sec && at(sec.from);
    return to && from ? { delta: to.points - from.points, from: from.stat_time, to: to.stat_time } : null;
  });
  return { points: cur.points, rank: cur.rank, rankChange: cur.rank_change, time: cur.stat_time, deltas, slots };
}
