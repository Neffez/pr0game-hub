import type { SessionUser } from '../auth.js';
import type { DB } from '../db.js';
import type { PresenceEvent } from '../events.js';

export function showOnlineEnabled(db: DB, userId: number): boolean {
  return !!db.prepare('SELECT show_online FROM users WHERE id = ?').pluck().get(userId);
}

export function shareActivityEnabled(db: DB, userId: number): boolean {
  return !!db.prepare('SELECT share_activity FROM users WHERE id = ?').pluck().get(userId);
}

/** Whether the live events of this user's syncs name the user (the other members' hints "X synced …"). */
export function shareSyncsEnabled(db: DB, userId: number): boolean {
  return !!db.prepare('SELECT share_syncs FROM users WHERE id = ?').pluck().get(userId);
}

/**
 * Presence list for one viewer: users who hide their status are omitted and users who do not share their activity
 * lose their whereabouts (page, system, player), unless they are the viewer or the viewer is a global admin.
 */
export function presenceForViewer(
  db: DB,
  viewer: Pick<SessionUser, 'id' | 'isAdmin'>,
  members: PresenceEvent['members'],
): PresenceEvent['members'] {
  if (viewer.isAdmin || !members.length) return members;
  const ids = members.map((m) => m.userId);
  const rows = db
    .prepare(`SELECT id, show_online, share_activity FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND (show_online = 0 OR share_activity = 0)`)
    .all(...ids) as { id: number; show_online: number; share_activity: number }[];
  if (!rows.length) return members;
  const hidden = new Set(rows.filter((r) => !r.show_online).map((r) => r.id));
  const quiet = new Set(rows.filter((r) => !r.share_activity).map((r) => r.id));
  return members
    .filter((m) => m.userId === viewer.id || !hidden.has(m.userId))
    .map((m) => (m.userId === viewer.id || !quiet.has(m.userId) ? m : { userId: m.userId, page: null, active: m.active }));
}
