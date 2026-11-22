// The recap's number of syncs (sync_credits kind 'sync', key: the page type, `count` adds up): which syncs count.
// Used by the ingest and by the data migration that rebuilds the counts (db.ts); imports only types, so db.ts can use
// it without an import cycle.
import type { GalaxyRecord } from '@pr0hub/core';
import type { DB } from '../db.js';

/**
 * What a galaxy view shows of a system, without the activity marks (they change with every look): planets, owners,
 * names, moons, debris, destroyed planets and the players' status. A sync whose fingerprint differs from the
 * group's last one of the system brought something new (galaxy_views.fingerprint).
 */
export function galaxyFingerprint(r: GalaxyRecord): string {
  const rows = r.rows
    .filter((x) => x.playerName || x.playerId || x.destroyed || x.debris)
    .map((x) => [x.position, x.playerId ?? x.playerName, x.planetName || '', x.moon ? 1 : 0, x.destroyed ? 1 : 0, x.debris ? `${x.debris.metal}/${x.debris.crystal}` : '', [...x.status].sort().join('')])
    .sort((a, b) => (a[0] as number) - (b[0] as number));
  return JSON.stringify(rows);
}

/** How often a page type counts per member beyond "brought something new". */
export type SyncRule =
  /** at most once in this many seconds (the member's own state pages: every sync stores a new snapshot of them) */
  | { gap: number }
  /** at most once a day */
  | { daily: true }
  /** once per unit, e.g. a player's card once per player (key `<page type>:<unit>`) */
  | { once: true };

/**
 * Page types with a rule. Not listed (messages with spy, battle and transport reports, galaxy, statistics, battle
 * hall …): they count whenever they bring something new; for galaxy that means a system whose fingerprint changed
 * for the group (`galaxyFingerprint`, Store.galaxyNews), for statistics a stand the hub did not have yet.
 */
export const SYNC_RULES: ReadonlyMap<string, SyncRule> = new Map<string, SyncRule>([
  ['overview', { gap: 15 * 60 }],
  ['empire', { gap: 60 * 60 }],
  ['buildings', { gap: 60 * 60 }],
  ['research', { gap: 60 * 60 }],
  ['shipyard', { gap: 60 * 60 }],
  ['fleets', { gap: 60 * 60 }],
  ['marketplace', { daily: true }],
  ['playerCard', { once: true }],
]);

/**
 * Counts one sync that brought something new for the member who pasted it, unless the page type's rule leaves it out
 * (`unit`: what a `once` page is about, e.g. the player of a card; without one it counts under the page type). The
 * page itself is stored as always, only the count skips it. Returns whether it counted.
 */
export function countSync(db: DB, groupId: number, userId: number, day: string, pageType: string, at: number, unit?: string | null): boolean {
  const rule = SYNC_RULES.get(pageType);
  let key = pageType;
  const has = (sql: string, ...args: unknown[]) => db.prepare(sql).get(groupId, userId, ...args) != null;
  if (rule && 'gap' in rule) {
    const last = db
      .prepare("SELECT MAX(last_at) FROM sync_credits WHERE group_id = ? AND user_id = ? AND kind = 'sync' AND key = ?")
      .pluck()
      .get(groupId, userId, pageType) as number | null;
    if (last != null && at - last < rule.gap) return false;
  } else if (rule && 'daily' in rule) {
    if (has("SELECT 1 FROM sync_credits WHERE group_id = ? AND user_id = ? AND kind = 'sync' AND key = ? AND day = ?", pageType, day)) return false;
  } else if (rule && 'once' in rule && unit) {
    key = `${pageType}:${unit}`;
    if (has("SELECT 1 FROM sync_credits WHERE group_id = ? AND user_id = ? AND kind = 'sync' AND key = ?", key)) return false;
  }
  db.prepare(
    "INSERT INTO sync_credits (group_id, user_id, day, kind, key, count, last_at) VALUES (?, ?, ?, 'sync', ?, 1, ?) ON CONFLICT (group_id, user_id, day, kind, key) DO UPDATE SET count = count + 1, last_at = excluded.last_at",
  ).run(groupId, userId, day, key, at);
  return true;
}
