import { drivesFromResearch, retimeCandidates } from '@pr0hub/flight';
import type { UniverseSettings } from '../config.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { latestEmpires, spyEmpire } from './empire.js';
import { sharedFleets, type StoredFleet } from './fleets.js';
import { attackKey, hostileAttacks, recallWindow, type Body, type EnemyFleet } from './hostile.js';
import { memberPlayers } from './members.js';

/** Research ids of the plan fleets: drives and fuel efficiency (flight times), weapons, shields, armour (simulator). */
export const RESEARCH_IDS = [115, 117, 118, 134, 109, 110, 111];
/** Missions of an own fleet that count as launched for a plan: attack, ACS attack, destroy; hold for hold plans. */
const LAUNCH_MISSIONS = [1, 2, 9];
const HOLD_MISSION = 5;
/** An own fleet in flight counts for a plan when it lands from an hour before its time until an hour after its end. */
const LAUNCH_SLACK = 3600;

export interface PlanRow {
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
  mission: 'attack' | 'hold';
}

export interface EnemyRow {
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
  /** recall window suggested by the overview pastes (the attack vanished before its arrival) */
  recall_seen?: { from: number; to: number } | null;
  hold_offset: number;
  /** hold plans: ships on the attacked planet changed by hand (JSON), null: from the empire page or spy report */
  planet_ships: string | null;
  phalanx_home: number | null;
  phalanx_time: number | null;
  /** seconds the impact moved since the last read (a newer overview paste), set by `enemiesOf` */
  moved?: number;
}

export const fromOf = (e: EnemyRow): Body => ({ g: e.from_g, s: e.from_s, p: e.from_p, type: e.from_type });
export const toOf = (e: EnemyRow): Body => ({ g: e.to_g, s: e.to_s, p: e.to_p, type: e.to_type });

export type Drives = { time: number; research: Record<number, number>; source: 'empire' | 'spy' | 'manual' };

/**
 * Drive research of plan fleets: from the members' latest empire pages (drives for every fleet's flight time, combat
 * techs for the simulator), without one from the newest spy report showing the member's research; drives entered by
 * hand count when newer than that.
 */
export function planDrives(db: DB, ctx: GroupContext) {
  const pick = (research: Record<string, number>) => Object.fromEntries(RESEARCH_IDS.map((id) => [id, research[id] ?? 0]));
  const drives = new Map<number, Drives | null>();
  for (const e of latestEmpires(db, ctx)) drives.set(e.userId, { time: e.time, research: pick(e.rec.research), source: 'empire' });
  const players = memberPlayers(db, ctx);
  const playerName = db.prepare('SELECT name FROM players WHERE id = ?').pluck();
  const drivesOf = (userId: number): Drives | null => {
    if (!drives.has(userId)) {
      const playerId = players.get(userId);
      const spy = playerId ? spyEmpire(db, ctx, playerId, playerName.get(playerId) as string) : null;
      drives.set(userId, spy?.researchTime != null ? { time: spy.researchTime, research: pick(spy.research), source: 'spy' } : null);
    }
    return drives.get(userId)!;
  };
  return (f: { user_id: number; manual: string | null; drives_time: number | null }): Drives | null => {
    const base = drivesOf(f.user_id);
    if (f.manual == null || (base && base.time > f.drives_time!)) return base;
    return { time: f.drives_time!, research: { ...(base?.research ?? pick({})), ...(JSON.parse(f.manual) as Record<number, number>) }, source: 'manual' };
  };
}

export type LaunchPlan = Pick<PlanRow, 'id' | 'g' | 's' | 'p' | 'planet_type' | 'target_time' | 'status' | 'mission'> & { time_precision: string };
export type LaunchFleet = { id: number; plan_id: number; user_id: number; g: number | null; s: number | null; p: number | null; planet_type: string | null; status: string };

/**
 * Plan fleets the member's newest overview shows in flight: an own attack (hold plans: hold) from the fleet's start to the plan's target,
 * landing around the plan's time (as the viewer may see it, `sharedFleets`). Returns the real arrival and the paste
 * time per plan fleet; an invited or ready fleet becomes launched.
 */
export function launchedOf(db: DB, ctx: GroupContext, plans: LaunchPlan[], fleets: LaunchFleet[]): Map<number, { arrival: number; time: number }> {
  const out = new Map<number, { arrival: number; time: number }>();
  const snaps = new Map<number, { time: number; data: StoredFleet[]; used: Set<number> } | null>();
  const same = (b: StoredFleet['from'] | null, g: number, s: number, p: number, type: string) =>
    !!b && b.coords.g === g && b.coords.s === s && b.coords.p === p && b.type === type;
  for (const plan of plans) {
    if (plan.g == null || (plan.status !== 'planning' && plan.status !== 'launched')) continue;
    const missions = plan.mission === 'hold' ? [HOLD_MISSION] : LAUNCH_MISSIONS;
    const from = plan.target_time - LAUNCH_SLACK;
    const to = plan.target_time + (plan.time_precision === 'day' ? 86400 : plan.time_precision === 'hour' ? 3600 : 0) + LAUNCH_SLACK;
    for (const f of fleets) {
      if (f.plan_id !== plan.id || f.g == null || f.status === 'withdrawn') continue;
      if (!snaps.has(f.user_id)) {
        const snap = sharedFleets(db, ctx.groupId, f.user_id, ctx.user.id);
        snaps.set(f.user_id, snap ? { time: snap.time, data: snap.data, used: new Set() } : null);
      }
      const snap = snaps.get(f.user_id);
      if (!snap) continue;
      let best = -1;
      snap.data.forEach((m, i) => {
        if (m.owner !== 'own' || m.phase !== 'out' || m.mission == null || !missions.includes(m.mission) || snap.used.has(i)) return;
        if (!same(m.to, plan.g!, plan.s!, plan.p!, plan.planet_type) || !same(m.from, f.g!, f.s!, f.p!, f.planet_type ?? 'planet')) return;
        if (m.arrival < from || m.arrival > to) return;
        if (best < 0 || Math.abs(m.arrival - plan.target_time) < Math.abs(snap.data[best].arrival - plan.target_time)) best = i;
      });
      if (best < 0) continue;
      snap.used.add(best);
      out.set(f.id, { arrival: snap.data[best].arrival, time: snap.time });
      if (f.status === 'invited' || f.status === 'ready') {
        db.prepare("UPDATE attack_plan_fleets SET status = 'launched' WHERE id = ?").run(f.id);
        f.status = 'launched';
      }
    }
  }
  return out;
}

/** The return home of a retime moves with the impact, unless a phalanx or a recall gives it. */
const followsImpact = (e: EnemyRow) => e.phalanx_home == null && e.recall_from == null;

/**
 * Enemy fleets of plans; a newer overview paste of the same attack updates the arrival as seen (ACS delays), and an
 * attack that vanished from the attacked member's overview before it arrived suggests a recall window.
 */
export function enemiesOf(db: DB, ctx: GroupContext, planIds: number[]): EnemyRow[] {
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
    const key = attackKey(fromOf(e), toOf(e), fleets[0]?.ships ?? {});
    const latest = seen.get(key);
    if (latest && latest.arrival !== e.arrival) {
      e.moved = latest.arrival - e.arrival;
      db.transaction(() => {
        db.prepare('UPDATE attack_plan_enemy SET arrival = ? WHERE plan_id = ?').run(latest.arrival, e.plan_id);
        // a retime lands after the return home
        if (followsImpact(e)) {
          db.prepare("UPDATE attack_plans SET target_time = target_time + ? WHERE id = ? AND mission <> 'hold'").run(e.moved, e.plan_id);
          db.prepare(
            `UPDATE target_claims SET expires_at = expires_at + ? WHERE id = (SELECT claim_id FROM attack_plans WHERE id = ? AND mission <> 'hold')
               AND released_at IS NULL`,
          ).run(e.moved, e.plan_id);
        }
      })();
      e.arrival = latest.arrival;
    }
    e.recall_seen = !latest && e.member_id != null ? recallWindow(db, ctx.groupId, e.member_id, key) : null;
  }
  return rows;
}

/**
 * Plans follow the impact of their enemy (also after a delay): a hold moves its target time to it; a retime was
 * already moved by `enemiesOf` with the return home, here only the loaded plans catch up.
 */
export function followEnemies(db: DB, plans: Pick<PlanRow, 'id' | 'mission' | 'target_time'>[], enemies: Map<number, EnemyRow>) {
  for (const p of plans) {
    const e = enemies.get(p.id);
    if (!e) continue;
    if (p.mission !== 'hold') {
      if (e.moved && followsImpact(e)) p.target_time += e.moved;
      continue;
    }
    if (p.target_time === e.arrival + e.hold_offset) continue;
    p.target_time = e.arrival + e.hold_offset;
    db.prepare('UPDATE attack_plans SET target_time = ? WHERE id = ?').run(p.target_time, p.id);
  }
}

/**
 * Landing back home of a retime's enemy fleet as the retime panel derives it: followed fleet (the lead after a recall
 * of the whole ACS), chosen speed or full speed until one is chosen; null without a known ship.
 */
export function retimeHome(u: UniverseSettings, e: EnemyRow): number | null {
  const fleets = JSON.parse(e.fleets) as EnemyFleet[];
  const recall = e.recall_from != null && e.recall_to != null ? { from: e.recall_from, to: e.recall_to } : null;
  const fleet = fleets[recall && e.recall_lead ? 0 : e.follow] ?? fleets[0];
  if (!fleet) return null;
  const c = retimeCandidates(u, {
    from: [e.from_g, e.from_s, e.from_p],
    to: [e.to_g, e.to_s, e.to_p],
    ships: fleet.ships,
    drives: drivesFromResearch(JSON.parse(e.drives) as Record<number, number>),
    arrival: e.arrival,
    firstSeen: e.first_seen,
    acs: fleets.length > 1,
    departure: e.departure_from != null && e.departure_to != null ? { from: e.departure_from, to: e.departure_to } : null,
    recall,
  }).find((x) => x.percent === (e.percent ?? 100));
  return c ? (c.recallHome ? c.recallHome.from : c.home) : null;
}

/**
 * New distance or speed settings of a universe: open retimes move their target time by the change of the enemy's
 * return home (a target set by hand keeps its offset), the claim follows. A phalanx return does not depend on them.
 * Returns the groups with moved plans.
 */
export function followUniverse(db: DB, universeId: number, before: UniverseSettings, after: UniverseSettings): number[] {
  const rows = db
    .prepare(
      `SELECT e.*, a.group_id FROM attack_plan_enemy e JOIN attack_plans a ON a.id = e.plan_id JOIN groups g ON g.id = a.group_id
       WHERE g.universe_id = ? AND a.mission <> 'hold' AND a.status IN ('planning', 'launched') AND a.target_time > ? AND e.phalanx_home IS NULL`,
    )
    .all(universeId, now()) as (EnemyRow & { group_id: number })[];
  const groups = new Set<number>();
  db.transaction(() => {
    for (const e of rows) {
      const from = retimeHome(before, e);
      const to = retimeHome(after, e);
      if (from == null || to == null || from === to) continue;
      db.prepare('UPDATE attack_plans SET target_time = target_time + ? WHERE id = ?').run(to - from, e.plan_id);
      db.prepare(
        'UPDATE target_claims SET expires_at = expires_at + ? WHERE id = (SELECT claim_id FROM attack_plans WHERE id = ?) AND released_at IS NULL',
      ).run(to - from, e.plan_id);
      groups.add(e.group_id);
    }
  })();
  return [...groups];
}
