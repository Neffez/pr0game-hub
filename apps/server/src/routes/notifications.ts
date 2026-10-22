import type { FastifyInstance } from 'fastify';
import { now, type DB } from '../db.js';
import { sharedFleets, type StoredFleet } from '../repo/fleets.js';
import { contextOf } from './util.js';

/** Something the members should notice; for now hostile fleets heading for a member (attack, spying, …). */
export interface Notification {
  /** stable while the event lasts (the web app remembers which ones were seen) */
  id: string;
  kind: 'attack';
  userId: number;
  member: string;
  /** when it happens (arrival of the fleet) */
  time: number;
  fleet: StoredFleet;
}

export function notificationRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /** Current notifications of the group, the next first; members' fleets as they share them. */
  app.get<{ Params: { uni: string } }>('/api/:uni/notifications', async (req) => {
    const ctx = ctxOf(req);
    const members = db
      .prepare('SELECT m.user_id, COALESCE(m.ingame_name, u.username) AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
      .all(ctx.groupId) as { user_id: number; name: string }[];
    const t = now();
    const list: Notification[] = [];
    for (const m of members) {
      const fleets = sharedFleets(db, ctx.groupId, m.user_id, ctx.user.id);
      if (!fleets || fleets === 'private') continue;
      for (const f of fleets.data) {
        if (f.owner !== 'hostile' || f.arrival <= t) continue;
        const c = f.from.coords;
        list.push({ id: `attack:${m.user_id}:${f.arrival}:${c.g}:${c.s}:${c.p}`, kind: 'attack', userId: m.user_id, member: m.name, time: f.arrival, fleet: f });
      }
    }
    return list.sort((a, b) => a.time - b.time);
  });
}
