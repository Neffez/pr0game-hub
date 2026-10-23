import type { FleetMovement } from '@pr0hub/core';
import type { DB } from '../db.js';

/** Missions a user can hide from the other members (game mission ids). */
export const SHARE_MISSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15];

export interface FleetShare {
  enabled: boolean;
  /** mission ids not shared */
  hidden: number[];
}

export function fleetShare(db: DB, userId: number): FleetShare {
  const raw = db.prepare('SELECT fleet_share FROM users WHERE id = ?').pluck().get(userId) as string | null | undefined;
  const s = raw ? (JSON.parse(raw) as Partial<FleetShare>) : {};
  return { enabled: s.enabled ?? true, hidden: s.hidden ?? [] };
}

export type StoredFleet = FleetMovement & { arrival: number };

/** How long fleet lists are kept for the history of past movements (seconds). */
export const FLEET_HISTORY = 12 * 3600;

/** Filter for the fleets of `ownerId` that `viewerId` may see; null: all of them. */
function shareFilter(db: DB, ownerId: number, viewerId: number) {
  if (ownerId === viewerId) return null;
  const share = fleetShare(db, ownerId);
  return { private: !share.enabled, shown: (f: StoredFleet) => f.owner !== 'own' || (share.enabled && (f.mission == null || !share.hidden.includes(f.mission))) };
}

/**
 * Newest fleet movements of a member as another member may see them: all for the member themself, else their own
 * fleets filtered by their sharing setting (`private`: they share none of them). Fleets of others heading for the member
 * (incoming attacks, spying, friendly holds) are always shared. Applies when served, so a change counts at once.
 */
export function sharedFleets(
  db: DB, groupId: number, ownerId: number, viewerId: number,
): { time: number; data: StoredFleet[]; private: boolean } | null {
  const row = db
    .prepare('SELECT page_time AS time, data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC LIMIT 1')
    .get(groupId, ownerId) as { time: number; data: string } | undefined;
  if (!row) return null;
  const data = JSON.parse(row.data) as StoredFleet[];
  const share = shareFilter(db, ownerId, viewerId);
  if (!share) return { time: row.time, data, private: false };
  return { time: row.time, data: data.filter(share.shown), private: share.private };
}

/**
 * Past fleet movements of a member from their older fleet lists (shared like `sharedFleets`), oldest first, arrived
 * after `since`. Each list stands for the fleets arriving until the next one was synced: a fleet missing from the next
 * list although it was due later was recalled and is left out. The arrived fleets of the newest list are not included.
 */
export function fleetHistory(db: DB, groupId: number, ownerId: number, viewerId: number, since: number): StoredFleet[] {
  const rows = db
    .prepare('SELECT page_time AS time, data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time, id')
    .all(groupId, ownerId) as { time: number; data: string }[];
  const share = shareFilter(db, ownerId, viewerId);
  const past: StoredFleet[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const until = rows[i + 1].time;
    for (const f of JSON.parse(rows[i].data) as StoredFleet[]) {
      if (f.arrival > rows[i].time && f.arrival <= until && f.arrival >= since && (!share || share.shown(f))) past.push(f);
    }
  }
  return past.sort((a, b) => a.arrival - b.arrival);
}
