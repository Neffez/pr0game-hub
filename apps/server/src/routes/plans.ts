import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { latestEmpires } from '../repo/empire.js';
import { attackKey, hostileAttacks, type Body, type EnemyFleet } from '../repo/hostile.js';
import { contextOf, DISPLAY, MEMBER } from './util.js';

const STATUSES = ['planning', 'launched', 'done', 'cancelled'];
const PRECISIONS = ['day', 'hour', 'exact'];
const FLEET_STATUSES = ['invited', 'ready', 'launched', 'withdrawn'];
/** Fleet rows per plan (the game takes 16 fleets per ACS; more are planned as separate attacks). */
const MAX_FLEETS = 32;
/** Plans are listed up to a week after their target time. */
const KEEP_SECONDS = 7 * 86400;
/** The target claim lasts until a few minutes after the target time. */
const CLAIM_AFTER = 600;
/** Research ids the flight times need: drives and fuel efficiency. */
const DRIVE_IDS = [115, 117, 118, 134];

interface PlanBody {
  /** coordinates: all three, or null for "not known yet" */
  g?: number | null;
  s?: number | null;
  p?: number | null;
  type?: string;
  player_id?: number | null;
  target_time?: number;
  time_precision?: string;
  note?: string | null;
  status?: string;
}

interface FleetBody {
  user_id?: number;
  g?: number | null;
  s?: number | null;
  p?: number | null;
  type?: string | null;
  ships?: Record<string, unknown>;
  speed?: number;
  status?: string;
}

interface PlanRow {
  id: number;
  user_id: number;
  player_id: number | null;
  g: number | null;
  s: number | null;
  p: number | null;
  planet_type: 'planet' | 'moon';
  target_time: number;
  status: string;
  claim_id: number | null;
}

interface EnemyBody {
  follow?: number;
  /** owner's drive research by id (115, 117, 118) */
  drives?: Record<string, unknown>;
  departure_from?: number | null;
  departure_to?: number | null;
  recall_from?: number | null;
  recall_to?: number | null;
  recall_lead?: boolean;
  percent?: number | null;
  buffer?: number;
  /** plan target time derived by the client (return of the chosen candidate plus the buffer) */
  target_time?: number;
}

interface EnemyRow {
  plan_id: number;
  member_id: number | null;
  member: string | null;
  from_g: number;
  from_s: number;
  from_p: number;
  from_type: Body['type'];
  to_g: number;
  to_s: number;
  to_p: number;
  to_type: Body['type'];
  fleets: string;
  follow: number;
  arrival: number;
  first_seen: number;
  drives: string;
  drives_source: string | null;
  drives_time: number | null;
  departure_from: number | null;
  departure_to: number | null;
  recall_from: number | null;
  recall_to: number | null;
  recall_lead: number;
  percent: number | null;
  buffer: number;
  updated_at: number;
  updated_by: string | null;
}

interface FleetRow {
  id: number;
  plan_id: number;
  user_id: number;
}

export function plansRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const isAdmin = (ctx: GroupContext) => ctx.role === 'admin' || ctx.user.isAdmin;
  const changed = (ctx: GroupContext) => events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans'], userId: ctx.user.id });

  const inRange = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max;
  function coordsOf(ctx: GroupContext, b: { g?: unknown; s?: unknown; p?: unknown }) {
    const { galaxies, systems, positions } = ctx.universe.settings;
    if (!inRange(b.g, galaxies) || !inRange(b.s, systems) || !inRange(b.p, positions)) throw new HttpError(400, 'coords_invalid', 'Invalid coordinates');
    return { g: b.g as number, s: b.s as number, p: b.p as number };
  }
  const noteOf = (v: unknown) => {
    const note = v == null ? '' : String(v).trim();
    if (note.length > 500) throw new HttpError(400, 'note_too_long', 'Note too long');
    return note || null;
  };
  const timeOf = (v: unknown) => {
    if (!Number.isInteger(v) || (v as number) < 1e9 || (v as number) > 4e9) throw new HttpError(400, 'plan_time_invalid', 'Invalid target time');
    return v as number;
  };
  /** Ships as element id (fleet 200-299) -> amount; zero amounts are dropped. */
  function shipsOf(v: unknown) {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'plan_ships_invalid', 'Invalid ships');
    const out: Record<number, number> = {};
    for (const [k, n] of Object.entries(v)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 200 || id > 299 || !Number.isInteger(n) || (n as number) < 0 || (n as number) > 1e12) {
        throw new HttpError(400, 'plan_ships_invalid', 'Invalid ships');
      }
      if (n) out[id] = n as number;
    }
    return out;
  }
  /** Target coordinates: all three given, or none (null/missing: not known yet). */
  function targetOf(ctx: GroupContext, b: PlanBody) {
    if (b.g == null && b.s == null && b.p == null) return null;
    return coordsOf(ctx, b);
  }
  const playerOf = (ctx: GroupContext, v: unknown) => {
    if (v == null) return null;
    if (!db.prepare('SELECT 1 FROM players WHERE id = ? AND group_id = ?').get(v, ctx.groupId)) throw new HttpError(404, 'player_not_found', 'Player not found');
    return v as number;
  };
  const precisionOf = (v: unknown) => {
    if (v == null) return 'exact';
    if (!PRECISIONS.includes(String(v))) throw new HttpError(400, 'plan_time_invalid', 'Invalid time precision');
    return String(v);
  };
  const speedOf = (v: unknown) => {
    if (!Number.isInteger(v) || (v as number) < 10 || (v as number) > 100 || (v as number) % 10) throw new HttpError(400, 'plan_speed_invalid', 'Speed: 10 to 100 %');
    return v as number;
  };

  function planOf(ctx: GroupContext, id: number) {
    const plan = db.prepare('SELECT * FROM attack_plans WHERE id = ? AND group_id = ?').get(id, ctx.groupId) as PlanRow | undefined;
    if (!plan) throw new HttpError(404, 'plan_not_found', 'Plan not found');
    return plan;
  }
  /** Creator and group admins edit the plan itself. */
  function editablePlan(ctx: GroupContext, id: number) {
    const plan = planOf(ctx, id);
    if (plan.user_id !== ctx.user.id && !isAdmin(ctx)) throw new HttpError(403, 'plan_not_yours', 'Only the creator or an admin can change the plan');
    return plan;
  }
  /** A fleet row: its member, the plan's creator or a group admin. */
  function editableFleet(ctx: GroupContext, planId: number, fleetId: number) {
    const plan = planOf(ctx, planId);
    const fleet = db.prepare('SELECT * FROM attack_plan_fleets WHERE id = ? AND plan_id = ?').get(fleetId, plan.id) as FleetRow | undefined;
    if (!fleet) throw new HttpError(404, 'plan_fleet_not_found', 'Fleet not found');
    if (fleet.user_id !== ctx.user.id && plan.user_id !== ctx.user.id && !isAdmin(ctx)) {
      throw new HttpError(403, 'plan_fleet_not_yours', 'Only the member, the creator or an admin can change this fleet');
    }
    return { plan, fleet };
  }
  const isMember = (ctx: GroupContext, userId: number) =>
    !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId);

  /**
   * Claims the target as "attack" for the plan, unless another member holds it (then the plan has no claim). An own
   * claim of the target is replaced.
   */
  function claim(ctx: GroupContext, planId: number, t: { g: number; s: number; p: number; type: string }, targetTime: number) {
    const time = now();
    const held = db
      .prepare(
        `SELECT c.id, c.user_id, ${DISPLAY} AS member FROM target_claims c JOIN users u ON u.id = c.user_id ${MEMBER('c')}
         WHERE c.group_id = ? AND c.g = ? AND c.s = ? AND c.p = ? AND c.planet_type = ? AND c.released_at IS NULL AND c.expires_at > ?`,
      )
      .get(ctx.groupId, t.g, t.s, t.p, t.type, time) as { id: number; user_id: number; member: string } | undefined;
    if (held && held.user_id !== ctx.user.id) return held.member;
    if (held) db.prepare('UPDATE target_claims SET released_at = ? WHERE id = ?').run(time, held.id);
    const id = db
      .prepare(
        `INSERT INTO target_claims (group_id, user_id, g, s, p, planet_type, kind, note, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'attack', ?, ?, ?)`,
      )
      .run(ctx.groupId, ctx.user.id, t.g, t.s, t.p, t.type, `Raid-Planer #${planId}`, time, Math.max(time + 60, targetTime + CLAIM_AFTER)).lastInsertRowid;
    db.prepare('UPDATE attack_plans SET claim_id = ? WHERE id = ?').run(Number(id), planId);
    return null;
  }
  const releaseClaim = (plan: PlanRow) => {
    if (plan.claim_id) db.prepare('UPDATE target_claims SET released_at = ? WHERE id = ? AND released_at IS NULL').run(now(), plan.claim_id);
    db.prepare('UPDATE attack_plans SET claim_id = NULL WHERE id = ?').run(plan.id);
  };

  /** Plans of the group up to a week after their target time, with fleets and the members' drive levels. */
  app.get<{ Params: { uni: string } }>('/api/:uni/plans', async (req) => {
    const ctx = ctxOf(req);
    const plans = db
      .prepare(
        `SELECT a.id, a.user_id, ${DISPLAY} AS creator, a.g, a.s, a.p, a.planet_type, a.target_time, a.time_precision, a.note, a.status,
           a.created_at, a.updated_at, c.user_id AS claim_user_id, COALESCE(a.player_id, pl.player_id) AS player_id, pr.name AS player_name,
           CASE WHEN a.planet_type = 'moon' THEN pl.moon_name ELSE pl.name END AS planet_name
         FROM attack_plans a
         JOIN users u ON u.id = a.user_id ${MEMBER('a')}
         LEFT JOIN target_claims c ON c.id = a.claim_id AND c.released_at IS NULL AND c.expires_at > ?
         LEFT JOIN planets pl ON pl.group_id = a.group_id AND pl.g = a.g AND pl.s = a.s AND pl.p = a.p
         LEFT JOIN players pr ON pr.id = COALESCE(a.player_id, pl.player_id)
         WHERE a.group_id = ? AND a.target_time > ? ORDER BY a.target_time`,
      )
      .all(now(), ctx.groupId, now() - KEEP_SECONDS) as (Record<string, unknown> & { id: number })[];
    if (!plans.length) return [];
    const fleets = db
      .prepare(
        `SELECT f.id, f.plan_id, f.user_id, ${DISPLAY} AS member, f.g, f.s, f.p, f.planet_type, f.ships, f.speed, f.status, f.updated_at
         FROM attack_plan_fleets f JOIN attack_plans a ON a.id = f.plan_id
         JOIN users u ON u.id = f.user_id LEFT JOIN group_members gm ON gm.group_id = a.group_id AND gm.user_id = f.user_id
         WHERE f.plan_id IN (SELECT value FROM json_each(?)) ORDER BY f.id`,
      )
      .all(JSON.stringify(plans.map((p) => p.id))) as (Record<string, unknown> & { plan_id: number; user_id: number; ships: string })[];
    // drive levels from the members' latest empire pages (needed for every fleet's flight time)
    const drives = new Map<number, { time: number; research: Record<number, number> }>();
    for (const e of latestEmpires(db, ctx)) {
      drives.set(e.userId, { time: e.time, research: Object.fromEntries(DRIVE_IDS.map((id) => [id, e.rec.research[id] ?? 0])) });
    }
    const enemies = new Map(enemiesOf(ctx, plans.map((p) => p.id)).map((e) => [e.plan_id, e]));
    return plans.map((p) => ({
      ...p,
      fleets: fleets
        .filter((f) => f.plan_id === p.id)
        .map(({ plan_id, ships, ...f }) => ({ ...f, ships: JSON.parse(ships), drives: drives.get(f.user_id) ?? null })),
      enemy: enemies.has(p.id) ? enemyOut(enemies.get(p.id)!) : null,
    }));
  });

  /** Enemy fleets of plans; a newer overview paste of the same attack updates the arrival as seen (ACS delays). */
  function enemiesOf(ctx: GroupContext, planIds: number[]): EnemyRow[] {
    const rows = db
      .prepare(
        `SELECT e.*, COALESCE(gm.ingame_name, mu.username) AS member, COALESCE(gb.ingame_name, bu.username) AS updated_by
         FROM attack_plan_enemy e JOIN attack_plans a ON a.id = e.plan_id
         LEFT JOIN users mu ON mu.id = e.member_id LEFT JOIN group_members gm ON gm.group_id = a.group_id AND gm.user_id = e.member_id
         LEFT JOIN users bu ON bu.id = e.updated_by LEFT JOIN group_members gb ON gb.group_id = a.group_id AND gb.user_id = e.updated_by
         WHERE e.plan_id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(planIds)) as EnemyRow[];
    if (!rows.length) return rows;
    const seen = new Map(hostileAttacks(db, ctx).map((a) => [a.key, a]));
    for (const e of rows) {
      const fleets = JSON.parse(e.fleets) as EnemyFleet[];
      const latest = seen.get(attackKey(fromOf(e), toOf(e), fleets[0]?.ships ?? {}));
      if (latest && latest.arrival !== e.arrival) {
        db.prepare('UPDATE attack_plan_enemy SET arrival = ? WHERE plan_id = ?').run(latest.arrival, e.plan_id);
        e.arrival = latest.arrival;
      }
    }
    return rows;
  }
  const fromOf = (e: EnemyRow): Body => ({ g: e.from_g, s: e.from_s, p: e.from_p, type: e.from_type });
  const toOf = (e: EnemyRow): Body => ({ g: e.to_g, s: e.to_s, p: e.to_p, type: e.to_type });
  const enemyOut = (e: EnemyRow) => ({
    member_id: e.member_id,
    member: e.member,
    from: fromOf(e),
    to: toOf(e),
    fleets: JSON.parse(e.fleets) as EnemyFleet[],
    follow: e.follow,
    arrival: e.arrival,
    first_seen: e.first_seen,
    drives: JSON.parse(e.drives) as Record<string, number>,
    drives_source: e.drives_source,
    drives_time: e.drives_time,
    departure: e.departure_from != null && e.departure_to != null ? { from: e.departure_from, to: e.departure_to } : null,
    recall: e.recall_from != null && e.recall_to != null ? { from: e.recall_from, to: e.recall_to } : null,
    recall_lead: !!e.recall_lead,
    percent: e.percent,
    buffer: e.buffer,
    updated_at: e.updated_at,
    updated_by: e.updated_by,
  });

  /** Hostile attacks on members (overview pastes), with the plan answering each, if any. */
  app.get<{ Params: { uni: string } }>('/api/:uni/hostile-attacks', async (req) => {
    const ctx = ctxOf(req);
    const rows = db
      .prepare(
        `SELECT e.plan_id, e.from_g, e.from_s, e.from_p, e.from_type, e.to_g, e.to_s, e.to_p, e.to_type, e.fleets FROM attack_plan_enemy e
         JOIN attack_plans a ON a.id = e.plan_id WHERE a.group_id = ? AND a.status <> 'cancelled'`,
      )
      .all(ctx.groupId) as EnemyRow[];
    const planOfKey = new Map(rows.map((e) => [attackKey(fromOf(e), toOf(e), (JSON.parse(e.fleets) as EnemyFleet[])[0]?.ships ?? {}), e.plan_id]));
    return hostileAttacks(db, ctx).map((a) => ({ ...a, planId: planOfKey.get(a.key) ?? null }));
  });

  /**
   * Retime plan for a hostile attack: target is the attack's origin, the enemy fleet is kept with the plan. The
   * client sends the target time it derived (return at full speed plus the buffer, until a candidate is chosen).
   */
  app.post<{ Params: { uni: string }; Body: { key?: string; follow?: number; target_time?: number; buffer?: number } }>(
    '/api/:uni/plans/retime',
    async (req) => {
      const ctx = ctxOf(req);
      const b = req.body ?? {};
      const attack = hostileAttacks(db, ctx).find((a) => a.key === b.key);
      if (!attack) throw new HttpError(404, 'attack_not_found', 'Hostile attack not found (arrived or not pasted)');
      const targetTime = timeOf(b.target_time);
      const follow = followOf(b.follow ?? 0, attack.fleets.length);
      const buffer = bufferOf(b.buffer ?? 5);
      return db.transaction(() => {
        const id = Number(
          db
            .prepare(
              `INSERT INTO attack_plans (group_id, user_id, player_id, g, s, p, planet_type, target_time, time_precision)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'exact')`,
            )
            .run(ctx.groupId, ctx.user.id, attack.player?.id ?? null, attack.from.g, attack.from.s, attack.from.p, attack.from.type, targetTime).lastInsertRowid,
        );
        db.prepare(
          `INSERT INTO attack_plan_enemy (plan_id, member_id, from_g, from_s, from_p, from_type, to_g, to_s, to_p, to_type, fleets, follow,
             arrival, first_seen, drives, drives_source, drives_time, buffer, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, attack.memberId, attack.from.g, attack.from.s, attack.from.p, attack.from.type, attack.to.g, attack.to.s, attack.to.p, attack.to.type,
          JSON.stringify(attack.fleets), follow, attack.arrival, attack.arrival, JSON.stringify(attack.drives?.research ?? {}),
          attack.drives ? 'spy' : null, attack.drives?.time ?? null, buffer, ctx.user.id,
        );
        const claimedBy = claim(ctx, id, attack.from, targetTime);
        events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans', 'target_claims'], userId: ctx.user.id });
        return { id, claimedBy };
      })();
    },
  );

  const followOf = (v: unknown, count: number) => {
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= count) throw new HttpError(400, 'plan_enemy_invalid', 'Invalid fleet');
    return v as number;
  };
  const bufferOf = (v: unknown) => {
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 3600) throw new HttpError(400, 'plan_enemy_invalid', 'Buffer: 0 to 3600 seconds');
    return v as number;
  };
  /** Both ends or none of a time window. */
  function windowOf(from: unknown, to: unknown) {
    if (from == null && to == null) return [null, null];
    const a = timeOf(from);
    const b = timeOf(to);
    if (b < a) throw new HttpError(400, 'plan_enemy_invalid', 'Window ends before it starts');
    return [a, b];
  }

  /**
   * Inputs on the enemy fleet (followed fleet, drives, departure and recall window, candidate, buffer) and the
   * target time derived from them: creator, admins and every member with a fleet in the plan.
   */
  app.put<{ Params: { uni: string; id: string }; Body: EnemyBody }>('/api/:uni/plans/:id/enemy', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    const participant = !!db.prepare('SELECT 1 FROM attack_plan_fleets WHERE plan_id = ? AND user_id = ?').get(plan.id, ctx.user.id);
    if (plan.user_id !== ctx.user.id && !isAdmin(ctx) && !participant) throw new HttpError(403, 'plan_not_yours', 'Only participants can change the enemy fleet');
    const enemy = db.prepare('SELECT fleets FROM attack_plan_enemy WHERE plan_id = ?').get(plan.id) as { fleets: string } | undefined;
    if (!enemy) throw new HttpError(404, 'plan_enemy_not_found', 'The plan has no enemy fleet');
    const b = req.body ?? {};
    const set: Record<string, unknown> = {};
    if (b.follow !== undefined) set.follow = followOf(b.follow, (JSON.parse(enemy.fleets) as unknown[]).length);
    if (b.drives !== undefined) {
      const drives: Record<number, number> = {};
      for (const id of [115, 117, 118]) {
        const v = b.drives?.[id];
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 99) throw new HttpError(400, 'plan_enemy_invalid', 'Invalid drive level');
        drives[id] = v as number;
      }
      Object.assign(set, { drives: JSON.stringify(drives), drives_source: 'manual', drives_time: now() });
    }
    if (b.departure_from !== undefined || b.departure_to !== undefined) [set.departure_from, set.departure_to] = windowOf(b.departure_from, b.departure_to);
    if (b.recall_from !== undefined || b.recall_to !== undefined) [set.recall_from, set.recall_to] = windowOf(b.recall_from, b.recall_to);
    if (b.recall_lead !== undefined) set.recall_lead = b.recall_lead ? 1 : 0;
    if (b.percent !== undefined) {
      const v = b.percent;
      if (v != null && (!Number.isInteger(v) || v < 10 || v > 100 || v % 10)) throw new HttpError(400, 'plan_speed_invalid', 'Speed: 10 to 100 %');
      set.percent = v;
    }
    if (b.buffer !== undefined) set.buffer = bufferOf(b.buffer);
    const targetTime = b.target_time !== undefined ? timeOf(b.target_time) : null;
    db.transaction(() => {
      const cols = Object.keys(set);
      db.prepare(`UPDATE attack_plan_enemy SET ${[...cols.map((k) => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'].join(', ')} WHERE plan_id = ?`).run(
        ...Object.values(set), now(), ctx.user.id, plan.id,
      );
      if (targetTime != null) {
        db.prepare("UPDATE attack_plans SET target_time = ?, time_precision = 'exact', updated_at = ? WHERE id = ?").run(targetTime, now(), plan.id);
        if (plan.claim_id) db.prepare('UPDATE target_claims SET expires_at = ? WHERE id = ? AND released_at IS NULL').run(targetTime + CLAIM_AFTER, plan.claim_id);
      }
    })();
    events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans'], userId: ctx.user.id });
    return { ok: true };
  });

  app.post<{ Params: { uni: string }; Body: PlanBody }>('/api/:uni/plans', async (req) => {
    const ctx = ctxOf(req);
    const b = req.body ?? {};
    const c = targetOf(ctx, b);
    const playerId = playerOf(ctx, b.player_id);
    if (!c && playerId == null) throw new HttpError(400, 'plan_target_missing', 'Target player or coordinates needed');
    const type = b.type === 'moon' ? 'moon' : 'planet';
    const targetTime = timeOf(b.target_time);
    const precision = precisionOf(b.time_precision);
    const note = noteOf(b.note);
    return db.transaction(() => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO attack_plans (group_id, user_id, player_id, g, s, p, planet_type, target_time, time_precision, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(ctx.groupId, ctx.user.id, playerId, c?.g ?? null, c?.s ?? null, c?.p ?? null, type, targetTime, precision, note).lastInsertRowid,
      );
      // claimed once the coordinates are known
      const claimedBy = c ? claim(ctx, id, { ...c, type }, targetTime) : null;
      events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans', 'target_claims'], userId: ctx.user.id });
      return { id, claimedBy };
    })();
  });

  /**
   * Target (player, coordinates added or changed later), time, note and status; creator or admin. New coordinates move
   * the claim to them; cancelling or finishing releases it.
   */
  app.put<{ Params: { uni: string; id: string }; Body: PlanBody }>('/api/:uni/plans/:id', async (req) => {
    const ctx = ctxOf(req);
    const plan = editablePlan(ctx, Number(req.params.id));
    const b = req.body ?? {};
    const set: Record<string, unknown> = {};
    const coordsGiven = b.g !== undefined || b.s !== undefined || b.p !== undefined;
    if (coordsGiven) {
      const c = targetOf(ctx, b);
      Object.assign(set, { g: c?.g ?? null, s: c?.s ?? null, p: c?.p ?? null });
    }
    if (b.type !== undefined) set.planet_type = b.type === 'moon' ? 'moon' : 'planet';
    if (b.player_id !== undefined) set.player_id = playerOf(ctx, b.player_id);
    if (b.target_time !== undefined) set.target_time = timeOf(b.target_time);
    if (b.time_precision !== undefined) set.time_precision = precisionOf(b.time_precision);
    if (b.note !== undefined) set.note = noteOf(b.note);
    if (b.status !== undefined) {
      if (!STATUSES.includes(String(b.status))) throw new HttpError(400, 'plan_status_invalid', 'Invalid status');
      set.status = b.status;
    }
    const next = { ...plan, ...set } as PlanRow & { status: string };
    if (next.g == null && next.player_id == null) throw new HttpError(400, 'plan_target_missing', 'Target player or coordinates needed');
    let claimedBy: string | null = null;
    db.transaction(() => {
      const cols = Object.keys(set);
      if (cols.length) {
        db.prepare(`UPDATE attack_plans SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...Object.values(set), now(), plan.id);
      }
      const moved = next.g !== plan.g || next.s !== plan.s || next.p !== plan.p || next.planet_type !== plan.planet_type;
      if (next.status === 'cancelled' || next.status === 'done' || (moved && plan.claim_id)) releaseClaim(plan);
      const open = next.status === 'planning' || next.status === 'launched';
      if (open && next.g != null && (moved || !plan.claim_id)) {
        claimedBy = claim(ctx, plan.id, { g: next.g, s: next.s!, p: next.p!, type: next.planet_type }, next.target_time);
      } else if (open && set.target_time && plan.claim_id) {
        db.prepare('UPDATE target_claims SET expires_at = ? WHERE id = ? AND released_at IS NULL').run((set.target_time as number) + CLAIM_AFTER, plan.claim_id);
      }
    })();
    events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans', 'target_claims'], userId: ctx.user.id });
    return { ok: true, claimedBy };
  });

  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/plans/:id', async (req) => {
    const ctx = ctxOf(req);
    const plan = editablePlan(ctx, Number(req.params.id));
    db.transaction(() => {
      releaseClaim(plan);
      db.prepare('DELETE FROM attack_plans WHERE id = ?').run(plan.id);
    })();
    events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans', 'target_claims'], userId: ctx.user.id });
    return { ok: true };
  });

  function fleetValues(ctx: GroupContext, b: FleetBody) {
    const set: Record<string, unknown> = {};
    if (b.g !== undefined || b.s !== undefined || b.p !== undefined) {
      if (b.g == null && b.s == null && b.p == null) Object.assign(set, { g: null, s: null, p: null, planet_type: null });
      else Object.assign(set, coordsOf(ctx, b), { planet_type: b.type === 'moon' ? 'moon' : 'planet' });
    } else if (b.type !== undefined) set.planet_type = b.type === 'moon' ? 'moon' : 'planet';
    if (b.ships !== undefined) set.ships = JSON.stringify(shipsOf(b.ships));
    if (b.speed !== undefined) set.speed = speedOf(b.speed);
    if (b.status !== undefined) {
      if (!FLEET_STATUSES.includes(String(b.status))) throw new HttpError(400, 'plan_status_invalid', 'Invalid status');
      set.status = b.status;
    }
    return set;
  }

  /** Adds a fleet: the own one, or (creator/admin) an invitation for another member. */
  app.post<{ Params: { uni: string; id: string }; Body: FleetBody }>('/api/:uni/plans/:id/fleets', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    const b = req.body ?? {};
    const userId = b.user_id ?? ctx.user.id;
    if (userId !== ctx.user.id) {
      if (plan.user_id !== ctx.user.id && !isAdmin(ctx)) throw new HttpError(403, 'plan_not_yours', 'Only the creator or an admin can invite');
      if (!isMember(ctx, userId)) throw new HttpError(404, 'member_not_found', 'Member not found');
    }
    if (plan.status === 'cancelled' || plan.status === 'done') throw new HttpError(409, 'plan_closed', 'The plan is closed');
    const count = db.prepare('SELECT COUNT(*) FROM attack_plan_fleets WHERE plan_id = ?').pluck().get(plan.id) as number;
    if (count >= MAX_FLEETS) throw new HttpError(409, 'plan_full', 'Too many fleets in this plan');
    const set = { status: userId === ctx.user.id ? 'ready' : 'invited', ...fleetValues(ctx, b) };
    const cols = Object.keys(set);
    const id = db
      .prepare(`INSERT INTO attack_plan_fleets (plan_id, user_id, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`)
      .run(plan.id, userId, ...Object.values(set)).lastInsertRowid;
    changed(ctx);
    return { id: Number(id) };
  });

  app.put<{ Params: { uni: string; id: string; fleet: string }; Body: FleetBody }>('/api/:uni/plans/:id/fleets/:fleet', async (req) => {
    const ctx = ctxOf(req);
    const { fleet } = editableFleet(ctx, Number(req.params.id), Number(req.params.fleet));
    const set = fleetValues(ctx, req.body ?? {});
    const cols = Object.keys(set);
    if (cols.length) {
      db.prepare(`UPDATE attack_plan_fleets SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...Object.values(set), now(), fleet.id);
      changed(ctx);
    }
    return { ok: true };
  });

  app.delete<{ Params: { uni: string; id: string; fleet: string } }>('/api/:uni/plans/:id/fleets/:fleet', async (req) => {
    const ctx = ctxOf(req);
    const { fleet } = editableFleet(ctx, Number(req.params.id), Number(req.params.fleet));
    db.prepare('DELETE FROM attack_plan_fleets WHERE id = ?').run(fleet.id);
    changed(ctx);
    return { ok: true };
  });
}
