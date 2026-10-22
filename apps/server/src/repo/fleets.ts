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
  const share = ownerId === viewerId ? null : fleetShare(db, ownerId);
  if (!share) return { time: row.time, data, private: false };
  const shown = (f: StoredFleet) => f.owner !== 'own' || (share.enabled && (f.mission == null || !share.hidden.includes(f.mission)));
  return { time: row.time, data: data.filter(shown), private: !share.enabled };
}
