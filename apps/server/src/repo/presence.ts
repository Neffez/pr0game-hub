import type { SessionUser } from '../auth.js';
import type { DB } from '../db.js';
import type { PresenceEvent } from '../events.js';

export function showOnlineEnabled(db: DB, userId: number): boolean {
  return !!db.prepare('SELECT show_online FROM users WHERE id = ?').pluck().get(userId);
}

/** Presence list for one viewer: users who hide their status are omitted unless they are the viewer or the viewer is a global admin. */
export function presenceForViewer(
  db: DB,
  viewer: Pick<SessionUser, 'id' | 'isAdmin'>,
  members: PresenceEvent['members'],
): PresenceEvent['members'] {
  if (viewer.isAdmin || !members.length) return members;
  const ids = members.map((m) => m.userId);
  const hidden = new Set(
    db.prepare(`SELECT id FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND show_online = 0`).pluck().all(...ids) as number[],
  );
  if (!hidden.size) return members;
  return members.filter((m) => m.userId === viewer.id || !hidden.has(m.userId));
}
