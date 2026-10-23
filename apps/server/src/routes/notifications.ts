import type { FastifyInstance } from 'fastify';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { sharedFleets, type StoredFleet } from '../repo/fleets.js';
import { alliance } from '../repo/members.js';
import { contextOf } from './util.js';

/** Something the members should notice; for now hostile fleets heading for a member (attack, spying, …) from outside the alliance. */
export interface Notification {
  /** stable while the event lasts (the web app remembers which ones were seen) */
  id: string;
  kind: 'attack';
  userId: number;
  member: string;
  /** when it happens (arrival of the fleet) */
  time: number;
  /** for an ACS: the lead fleet with the ships of all its fleets */
  fleet: StoredFleet;
  /** number of fleets of an ACS, 1 for a single fleet */
  fleets: number;
}

/** Fleets of the own alliance's players (by name or planet): their "attacks" on a member are moon attempts or shooting
 * debris for saving, no alarm. */
function friends(db: DB, ctx: GroupContext) {
  const ally = alliance(db, ctx);
  return (f: StoredFleet) => (!!f.player && ally.names.has(f.player.toLowerCase())) || ally.coords.has(`${f.from.coords.g}:${f.from.coords.s}:${f.from.coords.p}`);
}

export function notificationRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /** Current notifications of the group, the next first; members' fleets as they share them. */
  app.get<{ Params: { uni: string } }>('/api/:uni/notifications', async (req) => {
    const ctx = ctxOf(req);
    const members = db
      .prepare('SELECT m.user_id, m.ingame_name, COALESCE(m.ingame_name, u.username) AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
      .all(ctx.groupId) as { user_id: number; ingame_name: string | null; name: string }[];
    const friendly = friends(db, ctx);
    const t = now();
    const list: Notification[] = [];
    for (const m of members) {
      const fleets = sharedFleets(db, ctx.groupId, m.user_id, ctx.user.id);
      if (!fleets) continue;
      const acs = new Map<number, Notification>();
      for (const f of fleets.data) {
        if (f.owner !== 'hostile' || f.arrival <= t || friendly(f)) continue;
        const lead = f.acs != null ? acs.get(f.acs) : undefined;
        if (lead) {
          lead.fleets++;
          for (const [id, n] of Object.entries(f.ships)) lead.fleet.ships[Number(id)] = (lead.fleet.ships[Number(id)] ?? 0) + n;
          continue;
        }
        const c = f.from.coords;
        const n: Notification = {
          id: `attack:${m.user_id}:${f.arrival}:${c.g}:${c.s}:${c.p}`, kind: 'attack', userId: m.user_id, member: m.name, time: f.arrival,
          fleet: { ...f, ships: { ...f.ships } }, fleets: 1,
        };
        if (f.acs != null) acs.set(f.acs, n);
        list.push(n);
      }
    }
    return list.sort((a, b) => a.time - b.time);
  });
}
