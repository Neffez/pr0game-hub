import type { FastifyInstance } from 'fastify';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { sharedFleets, type StoredFleet } from '../repo/fleets.js';
import { alliance } from '../repo/members.js';
import { contextOf, DISPLAY, MEMBER } from './util.js';

/**
 * Something the members should notice: hostile fleets heading for a member (attack, spying, …) from outside the
 * alliance, and the viewer's open invitations to a raid planner plan.
 */
export type Notification = AttackNotification | InviteNotification;

interface Base {
  /** stable while the event lasts (the web app remembers which ones were seen) */
  id: string;
  userId: number;
  member: string;
  /** when it happens (arrival of the fleet, target time of the plan) */
  time: number;
}

export interface AttackNotification extends Base {
  kind: 'attack';
  /** for an ACS: the lead fleet with the ships of all its fleets */
  fleet: StoredFleet;
  /** number of fleets of an ACS, 1 for a single fleet */
  fleets: number;
}

/** The viewer is invited to a plan (`userId`/`member`: the plan's creator). */
export interface InviteNotification extends Base {
  kind: 'invite';
  plan: {
    id: number; g: number | null; s: number | null; p: number | null; planet_type: 'planet' | 'moon'; mission: 'attack' | 'hold';
    /** 'day' and 'hour': the time is the start of that day or hour; the invitation lasts until its end */
    time_precision: 'day' | 'hour' | 'exact';
  };
}

/** How long a plan's target time lasts by its precision. */
const PRECISION_SPAN = { day: 86400, hour: 3600, exact: 0 };

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
      const acs = new Map<number, AttackNotification>();
      for (const f of fleets.data) {
        if (f.owner !== 'hostile' || f.arrival <= t || friendly(f)) continue;
        const lead = f.acs != null ? acs.get(f.acs) : undefined;
        if (lead) {
          lead.fleets++;
          for (const [id, n] of Object.entries(f.ships)) lead.fleet.ships[Number(id)] = (lead.fleet.ships[Number(id)] ?? 0) + n;
          continue;
        }
        const c = f.from.coords;
        const n: AttackNotification = {
          id: `attack:${m.user_id}:${f.arrival}:${c.g}:${c.s}:${c.p}`, kind: 'attack', userId: m.user_id, member: m.name, time: f.arrival,
          fleet: { ...f, ships: { ...f.ships } }, fleets: 1,
        };
        if (f.acs != null) acs.set(f.acs, n);
        list.push(n);
      }
    }
    // the viewer's invitations: one per plan, also with several invited fleets
    const invites = db
      .prepare(
        `SELECT DISTINCT a.id, a.user_id, ${DISPLAY} AS creator, a.g, a.s, a.p, a.planet_type, a.mission, a.target_time, a.time_precision
         FROM attack_plan_fleets f JOIN attack_plans a ON a.id = f.plan_id
         JOIN users u ON u.id = a.user_id ${MEMBER('a')}
         WHERE a.group_id = ? AND f.user_id = ? AND f.status = 'invited' AND a.status = 'planning'
           AND a.target_time + CASE a.time_precision WHEN 'day' THEN ${PRECISION_SPAN.day} WHEN 'hour' THEN ${PRECISION_SPAN.hour} ELSE 0 END > ?`,
      )
      .all(ctx.groupId, ctx.user.id, t) as (InviteNotification['plan'] & { user_id: number; creator: string; target_time: number })[];
    for (const { user_id, creator, target_time, ...plan } of invites) {
      list.push({ id: `invite:${plan.id}`, kind: 'invite', userId: user_id, member: creator, time: target_time, plan });
    }
    return list.sort((a, b) => a.time - b.time);
  });
}
