import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { isPhalanxText, localToEpoch, nearestClock, parseFleetsText } from '@pr0hub/core';
import { CLASS_RESEARCH } from '@pr0hub/core/tech';
import { attackKey, hostileAttacks, PHALANX_KEEP, type Body, type EnemyFleet, type HostileAttack } from '../repo/hostile.js';
import { latestEmpire, spyEmpire } from '../repo/empire.js';
import { enemiesOf, followEnemies, fromOf, launchedOf, planDrives, toOf, type EnemyRow, type LaunchFleet, type LaunchPlan, type PlanRow } from '../repo/plans.js';
import { contextOf, DISPLAY, MEMBER } from './util.js';

const STATUSES = ['planning', 'launched', 'done', 'cancelled'];
/** Plan fields a participant may change: the target coordinates. */
const COORD_KEYS = ['g', 's', 'p', 'type'];
const PRECISIONS = ['day', 'hour', 'exact'];
const FLEET_STATUSES = ['invited', 'ready', 'launched', 'withdrawn'];
/** Fleet rows per plan (the game takes 16 fleets per ACS; more are planned as separate attacks). */
const MAX_FLEETS = 32;
/** Plans are listed up to a week after their target time. */
const KEEP_SECONDS = 7 * 86400;
/** The target claim lasts until a few minutes after the target time. */
const CLAIM_AFTER = 600;
/** Drive research a plan fleet may get by hand (combustion, impulse, hyperspace). */
const DRIVE_IDS = [115, 117, 118];
/** Hold fleets land by default 1 s before the impact (a hold must be there before the fight). */
const HOLD_OFFSET = -1;
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
  /** drive levels by hand (115, 117, 118), null = from the empire page or spy reports again */
  drives?: Record<string, unknown> | null;
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
  /** hold plans: seconds from the impact the fleets land */
  hold_offset?: number;
  /** hold plans: ships on the attacked planet for the simulators, null = from the empire page or spy report again */
  planet_ships?: Record<string, unknown> | null;
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
  /** Member with a fleet row in the plan (also only invited or withdrawn). */
  const isParticipant = (ctx: GroupContext, planId: number) =>
    !!db.prepare('SELECT 1 FROM attack_plan_fleets WHERE plan_id = ? AND user_id = ?').get(planId, ctx.user.id);
  /**
   * A fleet row: its member, the plan's creator or a group admin; with `participants` also every member with a fleet in
   * the plan (to plan for members who are away or have no account).
   */
  function editableFleet(ctx: GroupContext, planId: number, fleetId: number, participants = false) {
    const plan = planOf(ctx, planId);
    const fleet = db.prepare('SELECT * FROM attack_plan_fleets WHERE id = ? AND plan_id = ?').get(fleetId, plan.id) as FleetRow | undefined;
    if (!fleet) throw new HttpError(404, 'plan_fleet_not_found', 'Fleet not found');
    if (fleet.user_id !== ctx.user.id && plan.user_id !== ctx.user.id && !isAdmin(ctx) && !(participants && isParticipant(ctx, plan.id))) {
      throw new HttpError(403, 'plan_fleet_not_yours', participants ? 'Only participants of the plan can change this fleet' : 'Only the member, the creator or an admin can remove this fleet');
    }
    return { plan, fleet };
  }
  const isMember = (ctx: GroupContext, userId: number) =>
    !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId);

  /**
   * Claims the target as "attack" for the plan in the name of `userId` (default: the acting member), unless another
   * member holds it (then the plan has no claim). An own claim of the target is replaced.
   */
  function claim(ctx: GroupContext, planId: number, t: { g: number; s: number; p: number; type: string }, targetTime: number, userId = ctx.user.id) {
    const time = now();
    const held = db
      .prepare(
        `SELECT c.id, c.user_id, ${DISPLAY} AS member FROM target_claims c JOIN users u ON u.id = c.user_id ${MEMBER('c')}
         WHERE c.group_id = ? AND c.g = ? AND c.s = ? AND c.p = ? AND c.planet_type = ? AND c.released_at IS NULL AND c.expires_at > ?`,
      )
      .get(ctx.groupId, t.g, t.s, t.p, t.type, time) as { id: number; user_id: number; member: string } | undefined;
    if (held && held.user_id !== userId) return held.member;
    if (held) db.prepare('UPDATE target_claims SET released_at = ? WHERE id = ?').run(time, held.id);
    const id = db
      .prepare(
        `INSERT INTO target_claims (group_id, user_id, g, s, p, planet_type, kind, note, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'attack', ?, ?, ?)`,
      )
      .run(ctx.groupId, userId, t.g, t.s, t.p, t.type, `Raid-Planer #${planId}`, time, Math.max(time + 60, targetTime + CLAIM_AFTER)).lastInsertRowid;
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
           a.mission, a.created_at, a.updated_at, c.user_id AS claim_user_id, COALESCE(a.player_id, pl.player_id) AS player_id, pr.name AS player_name,
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
        `SELECT f.id, f.plan_id, f.user_id, ${DISPLAY} AS member, f.g, f.s, f.p, f.planet_type, f.ships, f.speed, f.status, f.updated_at,
           f.drives AS manual, f.drives_time
         FROM attack_plan_fleets f JOIN attack_plans a ON a.id = f.plan_id
         JOIN users u ON u.id = f.user_id LEFT JOIN group_members gm ON gm.group_id = a.group_id AND gm.user_id = f.user_id
         WHERE f.plan_id IN (SELECT value FROM json_each(?)) ORDER BY f.id`,
      )
      .all(JSON.stringify(plans.map((p) => p.id))) as (LaunchFleet & Record<string, unknown> & { ships: string; manual: string | null; drives_time: number | null })[];
    const fleetDrives = planDrives(db, ctx);
    const enemies = new Map(enemiesOf(db, ctx, plans.map((p) => p.id)).map((e) => [e.plan_id, e]));
    followEnemies(db, plans as unknown as PlanRow[], enemies);
    const launched = launchedOf(db, ctx, plans as unknown as LaunchPlan[], fleets);
    const spies = new Map(
      plans.map((p) => [p.id, p.mission === 'hold' ? holdSpy(ctx, p as unknown as SpyPlan, enemies.get(p.id)) : targetSpy(ctx, p as unknown as SpyPlan)]),
    );
    return plans.map((p) => ({
      ...p,
      fleets: fleets
        .filter((f) => f.plan_id === p.id)
        .map(({ plan_id, ships, manual, drives_time, ...f }) => ({
          ...f,
          ships: JSON.parse(ships),
          drives: fleetDrives({ user_id: f.user_id, manual, drives_time }),
          seen: launched.get(f.id) ?? null,
        })),
      enemy: enemies.has(p.id) ? { ...enemyOut(enemies.get(p.id)!), ...(p.mission === 'hold' ? attackerResearch(ctx, enemies.get(p.id)!) : {}) } : null,
      spy: spies.get(p.id) ?? null,
    }));
  });

  type SpyPlan = Pick<PlanRow, 'g' | 's' | 'p' | 'planet_type' | 'player_id'>;
  /**
   * Newest spy report of a plan's target for the combat simulators: all its values (resources, ships, defense,
   * buildings, research) by element id; research missing in it comes from the owner's newest report showing research.
   */
  function targetSpy(ctx: GroupContext, p: SpyPlan): { time: number; values: Record<string, number> } | null {
    if (p.g == null) return null;
    const row = db
      .prepare(
        `SELECT report_time, sections, player_id FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ?
         ORDER BY report_time DESC LIMIT 1`,
      )
      .get(ctx.groupId, p.g, p.s, p.p, p.planet_type) as { report_time: number; sections: string; player_id: number | null } | undefined;
    if (!row) return null;
    const sections = JSON.parse(row.sections) as Record<string, Record<string, number>>;
    const owner = row.player_id ?? p.player_id;
    if (!sections[CLASS_RESEARCH] && owner != null) {
      const older = db
        .prepare(
          `SELECT sections FROM spy_reports WHERE group_id = ? AND player_id = ? AND json_extract(sections, '$."${CLASS_RESEARCH}"') IS NOT NULL
           ORDER BY report_time DESC LIMIT 1`,
        )
        .pluck()
        .get(ctx.groupId, owner) as string | undefined;
      if (older) sections[CLASS_RESEARCH] = (JSON.parse(older) as Record<string, Record<string, number>>)[CLASS_RESEARCH];
    }
    return { time: row.report_time, values: Object.assign({}, ...Object.values(sections)) };
  }

  /**
   * Defended planet of a hold plan for the combat simulators: the planet (fleet, defense, buildings, resources) and the
   * research from the attacked member's newest empire page, else the newest spy report of the planet.
   */
  function holdSpy(ctx: GroupContext, p: SpyPlan, e: EnemyRow | undefined): { time: number; values: Record<string, number> } | null {
    const empire = e?.member_id != null ? latestEmpire(db, ctx, e.member_id) : null;
    const planet = empire?.rec.planets.find((pl) => pl.coords.g === p.g && pl.coords.s === p.s && pl.coords.p === p.p && pl.type === p.planet_type);
    if (!empire || !planet) return targetSpy(ctx, p);
    const resources = Object.fromEntries([901, 902, 903].map((id) => [id, planet.resources?.[id] ?? 0]));
    return { time: empire.time, values: { ...planet.values, ...resources, ...empire.rec.research } };
  }

  /** Research of the attacking player of a hold plan (newest spy report showing it) for the combat simulators. */
  function attackerResearch(ctx: GroupContext, e: EnemyRow): { research: Record<string, number> | null; research_time: number | null } {
    const from = fromOf(e);
    const owner = db
      .prepare('SELECT pr.id, pr.name FROM planets pl JOIN players pr ON pr.id = pl.player_id WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ?')
      .get(ctx.groupId, from.g, from.s, from.p) as { id: number; name: string } | undefined;
    const spy = owner ? spyEmpire(db, ctx, owner.id, owner.name) : null;
    return spy?.researchTime != null ? { research: spy.research, research_time: spy.researchTime } : { research: null, research_time: null };
  }

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
    recall_seen: e.recall_seen ?? null,
    hold_offset: e.hold_offset,
    planet_ships: e.planet_ships != null ? (JSON.parse(e.planet_ships) as Record<string, number>) : null,
    phalanx: e.phalanx_home != null ? { home: e.phalanx_home, time: e.phalanx_time } : null,
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
        `SELECT e.plan_id, e.from_g, e.from_s, e.from_p, e.from_type, e.to_g, e.to_s, e.to_p, e.to_type, e.fleets, a.mission FROM attack_plan_enemy e
         JOIN attack_plans a ON a.id = e.plan_id WHERE a.group_id = ? AND a.status <> 'cancelled'`,
      )
      .all(ctx.groupId) as (EnemyRow & { mission: string })[];
    const keyOf = (e: EnemyRow) => attackKey(fromOf(e), toOf(e), (JSON.parse(e.fleets) as EnemyFleet[])[0]?.ships ?? {});
    const retimes = new Map(rows.filter((e) => e.mission !== 'hold').map((e) => [keyOf(e), e.plan_id]));
    const holds = new Map(rows.filter((e) => e.mission === 'hold').map((e) => [keyOf(e), e.plan_id]));
    return hostileAttacks(db, ctx).map((a) => ({ ...a, planId: retimes.get(a.key) ?? null, holdPlanId: holds.get(a.key) ?? null }));
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
      const follow = followOf(b.follow ?? 0, attack.fleets.length);
      // a good retime lands right after the return: 0-1 s
      const buffer = bufferOf(b.buffer ?? 1);
      // the return shown by a phalanx counts directly
      const targetTime = attack.home != null ? attack.home + buffer : timeOf(b.target_time);
      return db.transaction(() => {
        const id = planFromAttack(ctx, attack, 'attack', attack.from, attack.player?.id ?? null, targetTime, { follow, buffer });
        const claimedBy = claim(ctx, id, attack.from, targetTime);
        events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans', 'target_claims'], userId: ctx.user.id });
        return { id, claimedBy };
      })();
    },
  );

  /**
   * Hold plan for a hostile attack: own fleets hold on the attacked planet, each landing on its own `hold_offset`
   * seconds from the impact (default 1 s before it). The target is a member's planet: no claim.
   */
  app.post<{ Params: { uni: string }; Body: { key?: string } }>('/api/:uni/plans/hold', async (req) => {
    const ctx = ctxOf(req);
    const attack = hostileAttacks(db, ctx).find((a) => a.key === req.body?.key);
    if (!attack) throw new HttpError(404, 'attack_not_found', 'Hostile attack not found (arrived or not pasted)');
    if (attack.arrival <= now()) throw new HttpError(400, 'attack_arrived', 'The attack has already arrived: nothing left to hold');
    const id = db.transaction(() => planFromAttack(ctx, attack, 'hold', attack.to, null, attack.arrival + HOLD_OFFSET, { follow: 0, buffer: 1 }))();
    events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans'], userId: ctx.user.id });
    return { id };
  });

  /** New plan on `target` answering a hostile attack, which is kept with it (`attack_plan_enemy`). */
  function planFromAttack(
    ctx: GroupContext, attack: HostileAttack, mission: 'attack' | 'hold', target: Body, playerId: number | null, targetTime: number,
    o: { follow: number; buffer: number },
  ): number {
    const id = Number(
      db
        .prepare(
          `INSERT INTO attack_plans (group_id, user_id, player_id, g, s, p, planet_type, target_time, time_precision, mission)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'exact', ?)`,
        )
        .run(ctx.groupId, ctx.user.id, playerId, target.g, target.s, target.p, target.type, targetTime, mission).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO attack_plan_enemy (plan_id, member_id, from_g, from_s, from_p, from_type, to_g, to_s, to_p, to_type, fleets, follow,
         arrival, first_seen, drives, drives_source, drives_time, buffer, hold_offset, phalanx_home, phalanx_time, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, attack.memberId, attack.from.g, attack.from.s, attack.from.p, attack.from.type, attack.to.g, attack.to.s, attack.to.p, attack.to.type,
      JSON.stringify(attack.fleets), o.follow, attack.arrival, attack.arrival, JSON.stringify(attack.drives?.research ?? {}),
      attack.drives ? 'spy' : null, attack.drives?.time ?? null, o.buffer, HOLD_OFFSET, attack.home, attack.home != null ? attack.seen : null, ctx.user.id,
    );
    return id;
  }

  /** Creator, admins and every member with a fleet in the plan may change the enemy side of a plan. */
  function enemyOfPlan(ctx: GroupContext, planId: number) {
    const plan = planOf(ctx, planId);
    const enemy = db.prepare('SELECT * FROM attack_plan_enemy WHERE plan_id = ?').get(plan.id) as EnemyRow | undefined;
    // a hold is also the attacked member's business (the ships on their planet)
    const attacked = plan.mission === 'hold' && enemy?.member_id === ctx.user.id;
    if (plan.user_id !== ctx.user.id && !isAdmin(ctx) && !isParticipant(ctx, plan.id) && !attacked) {
      throw new HttpError(403, 'plan_not_yours', 'Only participants can change the enemy fleet');
    }
    if (!enemy) throw new HttpError(404, 'plan_enemy_not_found', 'The plan has no enemy fleet');
    return { plan, enemy };
  }
  /** New target time of a plan (exact), the claim follows. */
  function setTargetTime(plan: PlanRow, targetTime: number) {
    db.prepare("UPDATE attack_plans SET target_time = ?, time_precision = 'exact', updated_at = ? WHERE id = ?").run(targetTime, now(), plan.id);
    if (plan.claim_id) db.prepare('UPDATE target_claims SET expires_at = ? WHERE id = ? AND released_at IS NULL').run(targetTime + CLAIM_AFTER, plan.claim_id);
  }

  /**
   * Phalanx result pasted into the raid planner (copied like the overview): its attacks join the hostile attacks
   * (`hostileAttacks`). The game writes the scanned player's fleets as "yours": their own attacks from the planet come
   * with the return home; attacks on the planet only with their arrival, the return follows from the speed candidates.
   */
  app.post<{ Params: { uni: string }; Body: { text?: string } }>('/api/:uni/phalanx', async (req) => {
    const ctx = ctxOf(req);
    const tz = ctx.universe.settings.timezone;
    const text = String(req.body?.text ?? '');
    // an own overview here would list the member's own attacks as hostile ones
    if (!isPhalanxText(text)) throw new HttpError(400, 'phalanx_not_phalanx', 'Not a phalanx result (no "Scan Position" line)');
    const rec = parseFleetsText(text);
    if (!rec?.fleets.length) throw new HttpError(400, 'phalanx_empty', 'No fleet movements in the text');
    const pageTime = (rec.pageTime ? localToEpoch(rec.pageTime, tz) : null) ?? now();
    const fleets = rec.fleets.map((f) => ({ ...f, arrival: f.clock ? nearestClock(pageTime + f.seconds, f.clock, tz) : pageTime + f.seconds }));
    db.prepare('INSERT INTO phalanx_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)').run(ctx.groupId, ctx.user.id, pageTime, JSON.stringify(fleets));
    db.prepare('DELETE FROM phalanx_snapshots WHERE group_id = ? AND page_time < ?').run(ctx.groupId, now() - PHALANX_KEEP);
    events.publish(ctx.groupId, { type: 'data', tables: ['fleets'], userId: ctx.user.id });
    const keys = new Set(hostileAttacks(db, ctx).filter((x) => x.source === 'phalanx').map((x) => x.key));
    return { attacks: keys.size };
  });

  /** Drops the landing home from a phalanx: the speed candidates count again. */
  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/plans/:id/phalanx', async (req) => {
    const ctx = ctxOf(req);
    const { plan } = enemyOfPlan(ctx, Number(req.params.id));
    db.prepare('UPDATE attack_plan_enemy SET phalanx_home = NULL, phalanx_time = NULL, updated_at = ?, updated_by = ? WHERE plan_id = ?').run(now(), ctx.user.id, plan.id);
    events.publish(ctx.groupId, { type: 'data', tables: ['attack_plans'], userId: ctx.user.id });
    return { ok: true };
  });

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
   * Inputs on the enemy fleet (followed fleet, drives, departure and recall window, candidate, buffer; hold offset and
   * the ships on the attacked planet) and the target time derived from them (a hold's from the impact): creator, admins,
   * every member with a fleet in the plan and, on a hold, the attacked member.
   */
  app.put<{ Params: { uni: string; id: string }; Body: EnemyBody }>('/api/:uni/plans/:id/enemy', async (req) => {
    const ctx = ctxOf(req);
    const { plan, enemy } = enemyOfPlan(ctx, Number(req.params.id));
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
    if (b.hold_offset !== undefined) {
      const v = b.hold_offset;
      if (!Number.isInteger(v) || v < -3600 || v > 3600) throw new HttpError(400, 'plan_enemy_invalid', 'Hold offset: -3600 to 3600 seconds');
      set.hold_offset = v;
    }
    if (b.planet_ships !== undefined) {
      if (plan.mission !== 'hold') throw new HttpError(400, 'plan_enemy_invalid', 'Planet ships only for hold plans');
      set.planet_ships = b.planet_ships === null ? null : JSON.stringify(shipsOf(b.planet_ships));
    }
    const targetTime =
      plan.mission === 'hold' ? enemy.arrival + ((set.hold_offset as number | undefined) ?? enemy.hold_offset)
      : b.target_time !== undefined ? timeOf(b.target_time) : null;
    db.transaction(() => {
      const cols = Object.keys(set);
      db.prepare(`UPDATE attack_plan_enemy SET ${[...cols.map((k) => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'].join(', ')} WHERE plan_id = ?`).run(
        ...Object.values(set), now(), ctx.user.id, plan.id,
      );
      if (targetTime != null) setTargetTime(plan, targetTime);
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
   * Target (player, coordinates added or changed later), time, note and status; creator or admin. Participants (also
   * only invited) may set the coordinates alone. New coordinates move the claim to them, held by the creator;
   * cancelling or finishing releases it.
   */
  app.put<{ Params: { uni: string; id: string }; Body: PlanBody }>('/api/:uni/plans/:id', async (req) => {
    const ctx = ctxOf(req);
    const b = req.body ?? {};
    const plan = planOf(ctx, Number(req.params.id));
    if (plan.user_id !== ctx.user.id && !isAdmin(ctx)) {
      const coordsOnly = Object.keys(b).every((k) => COORD_KEYS.includes(k));
      if (!coordsOnly || !isParticipant(ctx, plan.id)) throw new HttpError(403, 'plan_not_yours', 'Only the creator or an admin can change the plan');
    }
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
        claimedBy = claim(ctx, plan.id, { g: next.g, s: next.s!, p: next.p!, type: next.planet_type }, next.target_time, plan.user_id);
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
    if (b.drives !== undefined) {
      if (b.drives === null) Object.assign(set, { drives: null, drives_time: null });
      else {
        if (typeof b.drives !== 'object' || Array.isArray(b.drives)) throw new HttpError(400, 'plan_drives_invalid', 'Invalid drive levels');
        const levels: Record<number, number> = {};
        for (const [id, v] of Object.entries(b.drives)) {
          if (!DRIVE_IDS.includes(Number(id)) || !Number.isInteger(v) || (v as number) < 0 || (v as number) > 99) {
            throw new HttpError(400, 'plan_drives_invalid', 'Invalid drive levels');
          }
          levels[Number(id)] = v as number;
        }
        Object.assign(set, { drives: JSON.stringify(levels), drives_time: now() });
      }
    }
    return set;
  }

  /** Adds a fleet: the own one, or an invitation for another member (by any member). */
  app.post<{ Params: { uni: string; id: string }; Body: FleetBody }>('/api/:uni/plans/:id/fleets', async (req) => {
    const ctx = ctxOf(req);
    const plan = planOf(ctx, Number(req.params.id));
    const b = req.body ?? {};
    const userId = b.user_id ?? ctx.user.id;
    if (userId !== ctx.user.id && !isMember(ctx, userId)) throw new HttpError(404, 'member_not_found', 'Member not found');
    if (plan.status === 'cancelled' || plan.status === 'done') throw new HttpError(409, 'plan_closed', 'The plan is closed');
    const count = db.prepare('SELECT COUNT(*) FROM attack_plan_fleets WHERE plan_id = ?').pluck().get(plan.id) as number;
    if (count >= MAX_FLEETS) throw new HttpError(409, 'plan_full', 'Too many fleets in this plan');
    const set = { ...(userId === ctx.user.id ? { status: 'ready' } : { status: 'invited', invited_by: ctx.user.id }), ...fleetValues(ctx, b) };
    const cols = Object.keys(set);
    const id = db
      .prepare(`INSERT INTO attack_plan_fleets (plan_id, user_id, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`)
      .run(plan.id, userId, ...Object.values(set)).lastInsertRowid;
    changed(ctx);
    return { id: Number(id) };
  });

  app.put<{ Params: { uni: string; id: string; fleet: string }; Body: FleetBody }>('/api/:uni/plans/:id/fleets/:fleet', async (req) => {
    const ctx = ctxOf(req);
    const { fleet } = editableFleet(ctx, Number(req.params.id), Number(req.params.fleet), true);
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
