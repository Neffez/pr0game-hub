import { drivesFromResearch, retimeCandidates } from '@pr0hub/flight';
import type { UniverseSettings } from '../config.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { latestEmpires, spyEmpire } from './empire.js';
import { fleetVisibility, sharedFleets, type StoredFleet } from './fleets.js';
import { attackKey, hostileAttacks, recallWindow, shipsKey, type Body, type EnemyFleet } from './hostile.js';
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
export type LaunchFleet = {
  id: number; plan_id: number; user_id: number; g: number | null; s: number | null; p: number | null; planet_type: string | null; status: string;
  /** JSON of the planned ships */
  ships: string;
};
/** A plan fleet in flight as an overview shows it. */
export type LaunchSeen = { arrival: number; time: number; ships: Record<number, number> };

/**
 * Plan fleets the member's newest overview shows in flight: an own attack (hold plans: hold) from the fleet's start to the plan's target,
 * landing around the plan's time (as the viewer may see it, `sharedFleets`). A fleet not on its member's overview counts
 * when another participant's overview shows it as a foreign fleet on the same route from a planet of that member (by
 * the galaxy data; both in one ACS, e.g. a lead that has not synced). Among equally good matches the one with the plan
 * fleet's ships wins. Returns the real arrival, the ships flying and the paste time per plan fleet; an invited or ready
 * fleet becomes launched.
 */
export function launchedOf(db: DB, ctx: GroupContext, plans: LaunchPlan[], fleets: LaunchFleet[]): Map<number, LaunchSeen> {
  const out = new Map<number, LaunchSeen>();
  const players = memberPlayers(db, ctx);
  const snaps = new Map<number, { time: number; data: StoredFleet[]; used: Set<number> } | null>();
  const snapOf = (userId: number) => {
    if (!snaps.has(userId)) {
      const snap = sharedFleets(db, ctx.groupId, userId, ctx.user.id);
      snaps.set(userId, snap ? { time: snap.time, data: snap.data, used: new Set() } : null);
    }
    return snaps.get(userId)!;
  };
  const same = (b: StoredFleet['from'] | null, g: number, s: number, p: number, type: string) =>
    !!b && b.coords.g === g && b.coords.s === s && b.coords.p === p && b.type === type;
  for (const plan of plans) {
    if (plan.g == null || (plan.status !== 'planning' && plan.status !== 'launched')) continue;
    const missions = plan.mission === 'hold' ? [HOLD_MISSION] : LAUNCH_MISSIONS;
    const from = plan.target_time - LAUNCH_SLACK;
    const to = plan.target_time + (plan.time_precision === 'day' ? 86400 : plan.time_precision === 'hour' ? 3600 : 0) + LAUNCH_SLACK;
    const mine = fleets.filter((f) => f.plan_id === plan.id && f.g != null && f.status !== 'withdrawn');
    /** the movement in `userId`'s overview closest to the plan's time that is `f` flying (`owner` as that overview names it) */
    const find = (f: LaunchFleet, userId: number, owner: StoredFleet['owner']) => {
      const snap = snapOf(userId);
      if (!snap) return false;
      const player = players.get(f.user_id) ?? null;
      const planned = shipsKey(JSON.parse(f.ships) as Record<number, number>);
      const score = (m: StoredFleet) => Math.abs(m.arrival - plan.target_time) * 2 + (shipsKey(m.ships) === planned ? 0 : 1);
      let best = -1;
      snap.data.forEach((m, i) => {
        if (m.owner !== owner || m.phase !== 'out' || m.mission == null || !missions.includes(m.mission) || snap.used.has(i)) return;
        if (!same(m.to, plan.g!, plan.s!, plan.p!, plan.planet_type) || !same(m.from, f.g!, f.s!, f.p!, f.planet_type ?? 'planet')) return;
        if (m.arrival < from || m.arrival > to) return;
        // a foreign fleet from a planet of another player is not this member's
        if (owner === 'foreign' && m.fromPlayer && player != null && m.fromPlayer.id !== player) return;
        if (best < 0 || score(m) < score(snap.data[best])) best = i;
      });
      if (best < 0) return false;
      snap.used.add(best);
      out.set(f.id, { arrival: snap.data[best].arrival, time: snap.time, ships: snap.data[best].ships });
      if (f.status === 'invited' || f.status === 'ready') {
        db.prepare("UPDATE attack_plan_fleets SET status = 'launched' WHERE id = ?").run(f.id);
        f.status = 'launched';
      }
      return true;
    };
    for (const f of mine) find(f, f.user_id, 'own');
    const others = [...new Set(mine.map((f) => f.user_id))];
    for (const f of mine) {
      if (out.has(f.id)) continue;
      for (const userId of others) if (userId !== f.user_id && find(f, userId, 'foreign')) break;
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

/** A fleet of an own running attack: a member's (`memberId`) or, in an ACS, a non-member's (guest). */
export interface OwnAttackFleet {
  memberId: number | null;
  member: string | null;
  /** owner of the start by the galaxy data */
  player: { id: number; name: string } | null;
  from: Body;
  mission: number | null;
  ships: Record<number, number>;
}

/** A running own attack (solo or ACS) from the members' overview pastes that no plan covers yet. */
export interface OwnAttack {
  /** stable while the attack lasts: route and the lead fleet's ships */
  key: string;
  /** page time of the overview it was seen on */
  seen: number;
  arrival: number;
  to: Body;
  /** owner of the target by the galaxy data */
  player: { id: number; name: string } | null;
  /** the lead first */
  fleets: OwnAttackFleet[];
}

const isBody = (b: StoredFleet['from'] | null): b is StoredFleet['from'] & { type: Body['type'] } => !!b && (b.type === 'planet' || b.type === 'moon');
const bodyOf = (b: StoredFleet['from']): Body => ({ ...b.coords, type: b.type as Body['type'] });

/**
 * Own attacks (attack, ACS attack, destroy) in flight on the members' newest overviews, for the viewer to take into
 * the raid planner: only those the viewer flies in (their own fleet, or in an ACS a foreign fleet from the viewer's
 * player), until a plan on the target lands around the same time (± `LAUNCH_SLACK`). ACS fleets as one attack, the
 * lead first; the same attack seen by several participants counts once, from the newest paste.
 */
export function ownAttacks(db: DB, ctx: GroupContext): OwnAttack[] {
  const planned = db.prepare(
    `SELECT 1 FROM attack_plans WHERE group_id = ? AND mission <> 'hold' AND status IN ('planning', 'launched')
       AND g = ? AND s = ? AND p = ? AND planet_type = ? AND target_time BETWEEN ? AND ?`,
  );
  return collectOwnAttacks(db, ctx)
    .filter((a) => a.viewers.has(ctx.user.id))
    .filter((a) => !planned.get(ctx.groupId, a.to.g, a.to.s, a.to.p, a.to.type, a.arrival - LAUNCH_SLACK, a.arrival + LAUNCH_SLACK))
    .map(({ viewers: _, ...a }) => a);
}

/** Own attacks in flight on the overviews the viewer may see, planned or not, with the members who fly in them. */
function collectOwnAttacks(db: DB, ctx: GroupContext): (OwnAttack & { viewers: Set<number> })[] {
  const t = ctx.now;
  const players = memberPlayers(db, ctx);
  const memberOf = new Map<number, number>();
  for (const [userId, playerId] of players) if (playerId != null && !memberOf.has(playerId)) memberOf.set(playerId, userId);
  const members = db
    .prepare('SELECT m.user_id, COALESCE(m.ingame_name, u.username) AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
    .all(ctx.groupId) as { user_id: number; name: string }[];
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const playerName = db.prepare('SELECT name FROM players WHERE id = ?').pluck();
  const byKey = new Map<string, OwnAttack & { viewers: Set<number> }>();
  for (const m of members) {
    const snap = sharedFleets(db, ctx.groupId, m.user_id, ctx.user.id);
    if (!snap) continue;
    const groups = new Map<string, StoredFleet[]>();
    snap.data.forEach((f, i) => {
      if (f.phase !== 'out' || f.mission == null || !LAUNCH_MISSIONS.includes(f.mission) || f.arrival <= t) return;
      if (!isBody(f.from) || !isBody(f.to) || (f.owner !== 'own' && f.acs == null)) return;
      const id = f.acs != null ? `acs${f.acs}` : `f${i}`;
      groups.set(id, [...(groups.get(id) ?? []), f]);
    });
    for (const fleets of groups.values()) {
      if (!fleets.some((f) => f.owner === 'own')) continue;
      const lead = fleets[0];
      const to = bodyOf(lead.to!);
      const key = attackKey(bodyOf(lead.from), to, lead.ships);
      const known = byKey.get(key);
      const out = fleets.map((f): OwnAttackFleet => {
        const playerId = f.owner === 'own' ? players.get(m.user_id) ?? null : f.fromPlayer?.id ?? null;
        const memberId = f.owner === 'own' ? m.user_id : playerId != null ? memberOf.get(playerId) ?? null : null;
        const player = f.owner === 'own'
          ? (playerId != null ? { id: playerId, name: playerName.get(playerId) as string } : null)
          : f.fromPlayer ?? null;
        return { memberId, member: memberId != null ? names.get(memberId) ?? null : null, player, from: bodyOf(f.from), mission: f.mission, ships: f.ships };
      });
      // every participant seen in any paste may see it; the newest paste gives arrival and fleets
      const viewers = new Set([...(known?.viewers ?? []), ...out.flatMap((f) => (f.memberId != null ? [f.memberId] : []))]);
      if (known && known.seen >= snap.time) {
        known.viewers = viewers;
        continue;
      }
      byKey.set(key, { key, seen: snap.time, arrival: lead.arrival, to, player: null, fleets: out, viewers });
    }
  }
  const owner = db.prepare(
    'SELECT pr.id, pr.name FROM planets pl JOIN players pr ON pr.id = pl.player_id WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ?',
  );
  return [...byKey.values()]
    .sort((a, b) => a.arrival - b.arrival)
    .map((a) => ({ ...a, player: (owner.get(ctx.groupId, a.to.g, a.to.s, a.to.p) as { id: number; name: string } | undefined) ?? null }));
}

/** The plan side of an own attack's non-member fleets (guests for the simulators). */
export const guestsOfAttack = (fleets: OwnAttackFleet[]) =>
  fleets.filter((f) => f.memberId == null).map(({ player, from, mission, ships }) => ({ player, from, mission, ships }));

/**
 * Recalls from the members' overviews: a plan fleet whose member's newest overview, pasted before the fleet would have
 * landed, shows it flying back from the plan's target to its start (and no longer towards it), after an older overview
 * showed it on the way there, was recalled. It is withdrawn once (`recalled_at`, the paste time; set back by hand it
 * stays so); when no fleet of the plan is left, the plan is cancelled and its claim released. Fleets a member does not
 * share are left alone. Returns the ids of the changed plans.
 */
export function recallOwnPlans(db: DB, ctx: GroupContext): number[] {
  const plans = db
    .prepare(
      `SELECT id, g, s, p, planet_type, target_time, time_precision, mission, claim_id FROM attack_plans
       WHERE group_id = ? AND g IS NOT NULL AND status IN ('planning', 'launched') AND target_time > ?`,
    )
    .all(ctx.groupId, now() - LAUNCH_SLACK - 86400) as (LaunchPlan & { claim_id: number | null })[];
  if (!plans.length) return [];
  const fleets = db
    .prepare(
      `SELECT id, plan_id, user_id, g, s, p, planet_type, status FROM attack_plan_fleets
       WHERE plan_id IN (SELECT value FROM json_each(?)) AND recalled_at IS NULL AND status <> 'withdrawn' AND g IS NOT NULL`,
    )
    .all(JSON.stringify(plans.map((p) => p.id))) as Omit<LaunchFleet, 'ships'>[];
  const snaps = new Map<number, { time: number; data: StoredFleet[] }[]>();
  const snapsOf = (userId: number) => {
    if (!snaps.has(userId)) {
      const rows = db
        .prepare('SELECT page_time AS time, data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC')
        .all(ctx.groupId, userId) as { time: number; data: string }[];
      snaps.set(userId, rows.map((r) => ({ time: r.time, data: JSON.parse(r.data) as StoredFleet[] })));
    }
    return snaps.get(userId)!;
  };
  const same = (b: StoredFleet['from'] | null, g: number, s: number, p: number, type: string) =>
    !!b && b.coords.g === g && b.coords.s === s && b.coords.p === p && b.type === type;
  const changed: number[] = [];
  db.transaction(() => {
    for (const plan of plans) {
      const missions = plan.mission === 'hold' ? [HOLD_MISSION] : LAUNCH_MISSIONS;
      const from = plan.target_time - LAUNCH_SLACK;
      const to = plan.target_time + (plan.time_precision === 'day' ? 86400 : plan.time_precision === 'hour' ? 3600 : 0) + LAUNCH_SLACK;
      let recalled = false;
      for (const f of fleets.filter((x) => x.plan_id === plan.id)) {
        const vis = fleetVisibility(db, ctx.groupId, f.user_id);
        const shown = (m: StoredFleet) => m.owner === 'own' && m.mission != null && missions.includes(m.mission) && vis.shared(m);
        const start = (b: StoredFleet['from'] | null) => same(b, f.g!, f.s!, f.p!, f.planet_type ?? 'planet');
        const target = (b: StoredFleet['from'] | null) => same(b, plan.g!, plan.s!, plan.p!, plan.planet_type);
        const going = (m: StoredFleet) => shown(m) && m.phase === 'out' && start(m.from) && target(m.to) && m.arrival >= from && m.arrival <= to;
        const [newest, ...older] = snapsOf(f.user_id);
        if (!newest || newest.data.some(going)) continue;
        const before = older.find((s) => s.data.some(going))?.data.find(going);
        if (!before || newest.time >= before.arrival) continue;
        if (!newest.data.some((m) => shown(m) && m.phase === 'return' && target(m.from) && start(m.to))) continue;
        db.prepare("UPDATE attack_plan_fleets SET status = 'withdrawn', recalled_at = ?, updated_at = ? WHERE id = ?").run(newest.time, now(), f.id);
        recalled = true;
      }
      if (!recalled) continue;
      changed.push(plan.id);
      const left = db.prepare("SELECT COUNT(*) FROM attack_plan_fleets WHERE plan_id = ? AND status <> 'withdrawn'").pluck().get(plan.id) as number;
      if (left) continue;
      db.prepare("UPDATE attack_plans SET status = 'cancelled', claim_id = NULL, updated_at = ? WHERE id = ?").run(now(), plan.id);
      if (plan.claim_id) db.prepare('UPDATE target_claims SET released_at = ? WHERE id = ? AND released_at IS NULL').run(now(), plan.claim_id);
    }
  })();
  return changed;
}

/**
 * Carries a running own attack into the plans made from it (`attack_plans.attack_key`): fleets that joined the ACS
 * after the plan was made get a launched fleet row (existing rows, also changed or withdrawn ones, are left alone),
 * guests are renewed and the plan follows a moved arrival (the claim with it). `maxFleets` caps the rows per plan.
 * Returns the ids of the changed plans.
 */
export function syncOwnPlans(db: DB, ctx: GroupContext, maxFleets: number): number[] {
  const plans = db
    .prepare(
      `SELECT id, attack_key, target_time, claim_id, guests FROM attack_plans
       WHERE group_id = ? AND attack_key IS NOT NULL AND mission <> 'hold' AND status IN ('planning', 'launched') AND target_time > ?`,
    )
    .all(ctx.groupId, now() - LAUNCH_SLACK) as { id: number; attack_key: string; target_time: number; claim_id: number | null; guests: string | null }[];
  if (!plans.length) return [];
  const attacks = new Map(collectOwnAttacks(db, ctx).map((a) => [a.key, a]));
  const rows = db.prepare('SELECT id, user_id, g, s, p, planet_type FROM attack_plan_fleets WHERE plan_id = ?');
  const insert = db.prepare(
    `INSERT INTO attack_plan_fleets (plan_id, user_id, g, s, p, planet_type, ships, status, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'launched', ?)`,
  );
  const changed: number[] = [];
  db.transaction(() => {
    for (const plan of plans) {
      const attack = attacks.get(plan.attack_key);
      if (!attack) continue;
      let touched = false;
      if (attack.arrival !== plan.target_time) {
        db.prepare("UPDATE attack_plans SET target_time = ?, time_precision = 'exact', updated_at = ? WHERE id = ?").run(attack.arrival, now(), plan.id);
        if (plan.claim_id) db.prepare('UPDATE target_claims SET expires_at = expires_at + ? WHERE id = ? AND released_at IS NULL').run(attack.arrival - plan.target_time, plan.claim_id);
        touched = true;
      }
      const have = rows.all(plan.id) as { user_id: number; g: number | null; s: number | null; p: number | null; planet_type: string | null }[];
      let count = have.length;
      for (const f of attack.fleets) {
        if (f.memberId == null) continue;
        const at = have.findIndex((r) => r.user_id === f.memberId && r.g === f.from.g && r.s === f.from.s && r.p === f.from.p && (r.planet_type ?? 'planet') === f.from.type);
        if (at >= 0) {
          have.splice(at, 1);
          continue;
        }
        if (count >= maxFleets) break;
        count++;
        insert.run(plan.id, f.memberId, f.from.g, f.from.s, f.from.p, f.from.type, JSON.stringify(f.ships), null);
        touched = true;
      }
      const guests = guestsOfAttack(attack.fleets);
      const json = guests.length ? JSON.stringify(guests) : null;
      if (json !== plan.guests) {
        db.prepare('UPDATE attack_plans SET guests = ?, updated_at = ? WHERE id = ?').run(json, now(), plan.id);
        touched = true;
      }
      if (touched) changed.push(plan.id);
    }
  })();
  return changed;
}
