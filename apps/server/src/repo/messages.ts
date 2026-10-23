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
}

/**
 * Player messages a member may see: their own and those of current members who share theirs, newest first. A message
 * synced by several members (sender and recipient, or twice) is listed once. Applies when served, so a change of the
 * setting counts at once.
 */
export function visibleMessages(db: DB, groupId: number, viewerId: number, limit: number): StoredMessage[] {
  const rows = db
    .prepare(
      `SELECT MIN(pm.id) AS id, pm.time, pm.from_name, pm.from_coords, pm.recipients, pm.subject, pm.body,
         json_group_array(DISTINCT COALESCE(gm.ingame_name, u.username)) AS synced_by
       FROM player_messages pm JOIN users u ON u.id = pm.user_id
       JOIN group_members gm ON gm.group_id = pm.group_id AND gm.user_id = pm.user_id
       WHERE pm.group_id = ? AND (pm.user_id = ? OR u.message_share = 1)
       GROUP BY pm.dedupe_key ORDER BY pm.time DESC, id DESC LIMIT ?`,
    )
    .all(groupId, viewerId, limit) as (Omit<StoredMessage, 'recipients' | 'synced_by'> & { recipients: string; synced_by: string })[];
  return rows.map((r) => ({ ...r, recipients: JSON.parse(r.recipients), synced_by: JSON.parse(r.synced_by) }));
}
