import type { DB } from '../db.js';

/** Whether the user shares their player messages with the other members of their groups (off by default). */
export function messageShare(db: DB, userId: number): boolean {
  return !!db.prepare('SELECT message_share FROM users WHERE id = ?').pluck().get(userId);
}

export interface StoredMessage {
  id: number;
  time: number;
  from_name: string;
  from_coords: string | null;
  recipients: { name: string; coords: string | null }[];
  subject: string;
  body: string;
  /** members who synced it (visible to the viewer) */
  synced_by: string[];
  /** the viewer synced it themself (and can share it or not) */
  own: boolean;
  /** the viewer's copy is shared */
  own_shared: boolean;
  /** the alliance sees it (the viewer's copy or another member's) */
  shared: boolean;
}

/** A copy is shared by its message choice, else by its member's account setting. */
const SHARED = 'COALESCE(pm.share, u.message_share) = 1';

/**
 * Player messages a member may see: their own and the shared ones of current members, newest first. A message synced
 * by several members (sender and recipient, or twice) is listed once. Applies when served, so a change of a setting
 * counts at once.
 */
export function visibleMessages(db: DB, groupId: number, viewerId: number, limit: number): StoredMessage[] {
  const rows = db
    .prepare(
      `SELECT MIN(pm.id) AS id, pm.time, pm.from_name, pm.from_coords, pm.recipients, pm.subject, pm.body,
         json_group_array(DISTINCT COALESCE(gm.ingame_name, u.username)) AS synced_by,
         MAX(pm.user_id = ?) AS own, MAX(pm.user_id = ? AND ${SHARED}) AS own_shared, MAX(${SHARED}) AS shared
       FROM player_messages pm JOIN users u ON u.id = pm.user_id
       JOIN group_members gm ON gm.group_id = pm.group_id AND gm.user_id = pm.user_id
       WHERE pm.group_id = ? AND (pm.user_id = ? OR ${SHARED})
       GROUP BY pm.dedupe_key ORDER BY pm.time DESC, id DESC LIMIT ?`,
    )
    .all(viewerId, viewerId, groupId, viewerId, limit) as (Omit<StoredMessage, 'recipients' | 'synced_by' | 'own' | 'own_shared' | 'shared'> & {
    recipients: string;
    synced_by: string;
    own: number;
    own_shared: number;
    shared: number;
  })[];
  return rows.map((r) => ({
    ...r,
    recipients: JSON.parse(r.recipients),
    synced_by: JSON.parse(r.synced_by),
    own: !!r.own,
    own_shared: !!r.own_shared,
    shared: !!r.shared,
  }));
}

/** Shares the user's copy of a message (by the id of any copy in the group) or not; false when they have none. */
export function shareMessage(db: DB, groupId: number, userId: number, id: number, shared: boolean): boolean {
  return (
    db
      .prepare(
        `UPDATE player_messages SET share = ? WHERE group_id = ? AND user_id = ?
           AND dedupe_key = (SELECT dedupe_key FROM player_messages WHERE id = ? AND group_id = ?)`,
      )
      .run(shared ? 1 : 0, groupId, userId, id, groupId).changes > 0
  );
}
