import { distance, drivesFromResearch, flightDuration, launchFor, slowestShip } from '@pr0hub/flight';
import type { SessionUser } from '../auth.js';
import { resolveGroup, type GroupContext, type Universe } from '../context.js';
import type { DB } from '../db.js';
import { alertDone, alertsOf, buildingsState, planetElements, planetOf, storagesOf, type BuildingsState } from './buildings.js';
import { FLEET_KEEP, openFleetAlerts } from './fleetAlerts.js';
import { sharedFleets, type StoredFleet } from './fleets.js';
import { alliance } from './members.js';
import { enemiesOf, followEnemies, launchedOf, planDrives, type LaunchFleet, type LaunchPlan, type PlanRow } from './plans.js';

/**
 * Something the members should notice: hostile fleets heading for a member (attack, spying, …) from outside the
 * alliance, the viewer's open invitations to a raid planner plan, new comments in threads the viewer wrote in, and the
 * launch of the viewer's own plan fleets, the next level of a building the viewer is waiting for being affordable, and
 * the arrival of own fleets the viewer set an alert for, and full storages on the viewer's planets.
 * The bell lists them; push notifications send them (push.ts).
 */
export type Notification =
  | AttackNotification | InviteNotification | CommentNotification | LaunchNotification | BuildingNotification | FleetNotification | StorageNotification;

interface Base {
  /** stable while the event lasts (the web app remembers which ones were seen, push sends each once) */
  id: string;
  userId: number;
  member: string;
  /** when it happens (arrival of the fleet, target time of the plan, the newest comment, the launch) */
  time: number;
}

export interface AttackNotification extends Base {
  kind: 'attack';
  /** for an ACS: the lead fleet with the ships of all its fleets */
  fleet: StoredFleet;
  /** number of fleets of an ACS, 1 for a single fleet */
  fleets: number;
}

/** The viewer is invited to a plan (`userId`/`member`: who invited, for older invitations the plan's creator). */
export interface InviteNotification extends Base {
  kind: 'invite';
  plan: {
    id: number; g: number | null; s: number | null; p: number | null; planet_type: 'planet' | 'moon'; mission: 'attack' | 'hold';
    /** 'day' and 'hour': the time is the start of that day or hour; the invitation lasts until its end */
    time_precision: 'day' | 'hour' | 'exact';
  };
}

/** New comments in a thread the viewer wrote in, since their last comment there (`userId`/`member`: newest author). */
export interface CommentNotification extends Base {
  kind: 'comment';
  thread: { player: number; name: string } | { g: number; s: number; p: number; type: 'planet' | 'moon'; owner: string | null };
  /** the newest comment, shortened */
  excerpt: string;
  /** new comments in the thread */
  count: number;
}

/** A fleet of the viewer in a plan to the second has to start soon (`time`: the launch). */
export interface LaunchNotification extends Base {
  kind: 'launch';
  plan: { id: number; g: number; s: number; p: number; planet_type: 'planet' | 'moon'; mission: 'attack' | 'hold'; target_time: number };
  from: { g: number; s: number; p: number; type: 'planet' | 'moon' };
}

/**
 * The resources for the next level of a building or research (`element` from 100) on one of the viewer's planets are
 * there and nothing blocks it (`time`: since when).
 */
export interface BuildingNotification extends Base {
  kind: 'building';
  /** the alert (buildings page) */
  alert: number;
  planet: { g: number; s: number; p: number; type: 'planet' | 'moon'; name: string };
  element: number;
  level: number;
}

/**
 * One of the viewer's own fleets they set an alert for arrives (`time`): due `lead` minutes before it, listed from
 * `LAUNCH_AHEAD` before that (the web app shows it from the due time on) until `FLEET_KEEP` after the arrival.
 */
export interface FleetNotification extends Base {
  kind: 'fleet';
  /** the alert (Imperium) */
  alert: number;
  fleet: StoredFleet;
  /** minutes before the arrival */
  lead: number;
}

/**
 * A storage on one of the viewer's planets is full by the newest synced pages: production up to the capacity or
 * fleets landing (`time`: since when, kept over newer syncs while it stays full). Moons have no production.
 */
export interface StorageNotification extends Base {
  kind: 'storage';
  planet: { g: number; s: number; p: number; name: string };
  /** 901 metal, 902 crystal, 903 deuterium */
  resource: number;
}

/** A member created a plan (channel only, not on the bell; `userId`/`member`: the creator, `time`: its creation). */
export interface PlanNotification extends Base {
  kind: 'plan';
  plan: InviteNotification['plan'] & { target_time: number };
}

/** What a group's Discord channel gets: attacks on members, new plans and the members' launches. */
export type ChannelNotification = AttackNotification | PlanNotification | LaunchNotification;

/** How long a plan's target time lasts by its precision. */
const PRECISION_SPAN = { day: 86400, hour: 3600, exact: 0 };
/** New comments are listed this long. */
export const COMMENT_KEEP = 48 * 3600;
/** A launch is listed this long before it. */
export const LAUNCH_AHEAD = 3600;
/** An affordable building level is listed this long. */
export const BUILDING_KEEP = 24 * 3600;
/** A full storage is listed this long. */
export const STORAGE_KEEP = 24 * 3600;
/** New plans are posted to the channel this long after their creation. */
export const PLAN_KEEP = 3600;
const EXCERPT = 80;

const DISPLAY = 'COALESCE(gm.ingame_name, u.username)';

/** Fleets of the own alliance's players (by name or planet): their "attacks" on a member are moon attempts or shooting
 * debris for saving, no alarm. */
function friends(db: DB, ctx: GroupContext) {
  const ally = alliance(db, ctx);
  return (f: StoredFleet) => (!!f.player && ally.names.has(f.player.toLowerCase())) || ally.coords.has(`${f.from.coords.g}:${f.from.coords.s}:${f.from.coords.p}`);
}

/** Current notifications of the group for the viewer (`ctx.user`) at `t`, the next first; members' fleets as they share them. */
export function notificationsFor(db: DB, ctx: GroupContext, t: number): Notification[] {
  let state: BuildingsState | undefined;
  const own = () => (state ??= buildingsState(db, ctx, ctx.user.id, t));
  return [
    ...attacks(db, ctx, t), ...invites(db, ctx, t), ...comments(db, ctx, t), ...launches(db, ctx, t), ...buildings(db, ctx, t, own), ...fleets(db, ctx, t),
    ...storages(db, ctx, t, own),
  ].sort((a, b) => a.time - b.time);
}

/**
 * Current notifications of the group's channel at `t`, the next first: attacks on members (hostile fleets are shared
 * with every member), plans created within `PLAN_KEEP` and the launches of all members' plan fleets. The channel is
 * the alliance's own: only members read it, so it gets what every member sees in the hub.
 */
export function channelNotificationsFor(db: DB, universe: Universe, groupId: number, t: number): ChannelNotification[] {
  const group = db.prepare('SELECT name FROM groups WHERE id = ?').pluck().get(groupId) as string | undefined;
  if (group == null) return [];
  const ctxOf = (user: SessionUser): GroupContext => ({ user, universe, groupId, groupName: group, role: 'member' });
  const channel = ctxOf({ id: 0, username: '', isAdmin: false, lang: 'de', dateFormat: 'auto' });
  const launching = db
    .prepare(
      `SELECT DISTINCT u.id, u.username, u.lang, u.date_format FROM attack_plan_fleets f JOIN attack_plans a ON a.id = f.plan_id
       JOIN users u ON u.id = f.user_id JOIN group_members m ON m.group_id = a.group_id AND m.user_id = u.id
       WHERE a.group_id = ? AND f.status IN ('invited', 'ready') AND a.status IN ('planning', 'launched') AND a.time_precision = 'exact' AND a.target_time > ?`,
    )
    .all(groupId, t) as { id: number; username: string; lang: string; date_format: string }[];
  const own = launching.flatMap((u) => launches(db, ctxOf({ id: u.id, username: u.username, isAdmin: false, lang: u.lang, dateFormat: u.date_format }), t));
  return [...attacks(db, channel, t), ...plans(db, groupId, t), ...own].sort((a, b) => a.time - b.time);
}

/** Plans of the group created within `PLAN_KEEP` that are still being planned. */
function plans(db: DB, groupId: number, t: number): PlanNotification[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, ${DISPLAY} AS creator, a.g, a.s, a.p, a.planet_type, a.mission, a.target_time, a.time_precision, a.created_at
       FROM attack_plans a JOIN users u ON u.id = a.user_id LEFT JOIN group_members gm ON gm.group_id = a.group_id AND gm.user_id = u.id
       WHERE a.group_id = ? AND a.status = 'planning' AND a.created_at > ?
         AND a.target_time + CASE a.time_precision WHEN 'day' THEN ${PRECISION_SPAN.day} WHEN 'hour' THEN ${PRECISION_SPAN.hour} ELSE 0 END > ?`,
    )
    .all(groupId, t - PLAN_KEEP, t) as (PlanNotification['plan'] & { user_id: number; creator: string; created_at: number })[];
  return rows.map(({ user_id, creator, created_at, ...plan }) => ({ id: `plan:${plan.id}`, kind: 'plan', userId: user_id, member: creator, time: created_at, plan }));
}

function attacks(db: DB, ctx: GroupContext, t: number): AttackNotification[] {
  const members = db
    .prepare('SELECT m.user_id, COALESCE(m.ingame_name, u.username) AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
    .all(ctx.groupId) as { user_id: number; name: string }[];
  const friendly = friends(db, ctx);
  const list: AttackNotification[] = [];
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
  return list;
}

/** The viewer's invitations: one per plan (the newest when invited several times), from whoever invited. */
function invites(db: DB, ctx: GroupContext, t: number): InviteNotification[] {
  const rows = db
    .prepare(
      `SELECT a.id, u.id AS user_id, ${DISPLAY} AS inviter, a.g, a.s, a.p, a.planet_type, a.mission, a.target_time, a.time_precision, MAX(f.id) AS newest
       FROM attack_plan_fleets f JOIN attack_plans a ON a.id = f.plan_id
       JOIN users u ON u.id = COALESCE(f.invited_by, a.user_id) LEFT JOIN group_members gm ON gm.group_id = a.group_id AND gm.user_id = u.id
       WHERE a.group_id = ? AND f.user_id = ? AND f.status = 'invited' AND a.status = 'planning'
         AND a.target_time + CASE a.time_precision WHEN 'day' THEN ${PRECISION_SPAN.day} WHEN 'hour' THEN ${PRECISION_SPAN.hour} ELSE 0 END > ?
       GROUP BY a.id`,
    )
    .all(ctx.groupId, ctx.user.id, t) as (InviteNotification['plan'] & { user_id: number; inviter: string; target_time: number; newest: number })[];
  return rows.map(({ user_id, inviter, target_time, newest: _, ...plan }) => ({
    id: `invite:${plan.id}`, kind: 'invite', userId: user_id, member: inviter, time: target_time, plan,
  }));
}

/** Threads with comments of others after the viewer's own last one there (of the last two days): one entry per thread. */
function comments(db: DB, ctx: GroupContext, t: number): CommentNotification[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.user_id, ${DISPLAY} AS author, c.body, c.created_at, c.player_id, pr.name AS player_name, c.g, c.s, c.p, c.planet_type,
         op.name AS owner
       FROM comments c
       LEFT JOIN users u ON u.id = c.user_id LEFT JOIN group_members gm ON gm.group_id = c.group_id AND gm.user_id = c.user_id
       LEFT JOIN players pr ON pr.id = c.player_id
       LEFT JOIN planets pl ON c.player_id IS NULL AND pl.group_id = c.group_id AND pl.g = c.g AND pl.s = c.s AND pl.p = c.p
       LEFT JOIN players op ON op.id = pl.player_id
       WHERE c.group_id = ? AND c.deleted_at IS NULL AND c.created_at > ? AND c.user_id IS NOT ?
         AND c.id > (
           SELECT MAX(o.id) FROM comments o
           WHERE o.group_id = c.group_id AND o.user_id = ? AND o.deleted_at IS NULL
             AND (CASE WHEN c.player_id IS NOT NULL THEN o.player_id = c.player_id
                  ELSE o.g = c.g AND o.s = c.s AND o.p = c.p AND o.planet_type = c.planet_type END)
         )
       ORDER BY c.created_at, c.id`,
    )
    .all(ctx.groupId, t - COMMENT_KEEP, ctx.user.id, ctx.user.id) as {
    id: number; user_id: number | null; author: string | null; body: string; created_at: number; player_id: number | null; player_name: string | null;
    g: number | null; s: number | null; p: number | null; planet_type: 'planet' | 'moon' | null; owner: string | null;
  }[];
  const threads = new Map<string, CommentNotification>();
  for (const r of rows) {
    const key = r.player_id != null ? `p${r.player_id}` : `${r.g}:${r.s}:${r.p}:${r.planet_type}`;
    const known = threads.get(key);
    const excerpt = r.body.length > EXCERPT ? r.body.slice(0, EXCERPT - 1).trimEnd() + '…' : r.body;
    const thread: CommentNotification['thread'] =
      r.player_id != null ? { player: r.player_id, name: r.player_name ?? '?' } : { g: r.g!, s: r.s!, p: r.p!, type: r.planet_type!, owner: r.owner };
    threads.set(key, {
      id: `comment:${key}:${r.id}`, kind: 'comment', userId: r.user_id ?? 0, member: r.author ?? '?', time: r.created_at,
      thread, excerpt, count: (known?.count ?? 0) + 1,
    });
  }
  return [...threads.values()];
}

/**
 * The earliest time after `t` when one of the group's open building alerts gets ready (resources there, facility
 * free), null when none will by what is known now.
 */
export function nextBuildingAlert(db: DB, universe: Universe, groupId: number, t: number): number | null {
  const users = db
    .prepare(
      `SELECT DISTINCT u.id, u.username, u.is_admin, u.lang, u.date_format FROM building_alerts b JOIN users u ON u.id = b.user_id
       WHERE b.group_id = ?`,
    )
    .all(groupId) as { id: number; username: string; is_admin: number; lang: string; date_format: string }[];
  let next: number | null = null;
  for (const u of users) {
    const ctx = resolveGroup(db, { id: u.id, username: u.username, isAdmin: !!u.is_admin, lang: u.lang, dateFormat: u.date_format }, universe, groupId);
    const state = buildingsState(db, ctx, u.id, t);
    for (const a of alertsOf(db, ctx, u.id)) {
      const bp = planetOf(state, a);
      const info = bp && planetElements(state, bp, t).find((b) => b.id === a.element_id);
      if (!info || alertDone(a, info) || info.readyAt == null || info.readyAt <= t) continue;
      next = next == null ? info.readyAt : Math.min(next, info.readyAt);
    }
  }
  return next;
}

/**
 * The viewer's building alerts whose level is affordable now: resources and production of the newest synced pages plus
 * the fleets landing until then. Built or queued levels no longer count (the buildings page removes those alerts).
 */
function buildings(db: DB, ctx: GroupContext, t: number, own: () => BuildingsState): BuildingNotification[] {
  const alerts = alertsOf(db, ctx, ctx.user.id);
  if (!alerts.length) return [];
  const state = own();
  const name = db.prepare(`SELECT ${DISPLAY} FROM users u LEFT JOIN group_members gm ON gm.group_id = ? AND gm.user_id = u.id WHERE u.id = ?`).pluck().get(ctx.groupId, ctx.user.id) as string;
  const list: BuildingNotification[] = [];
  for (const a of alerts) {
    const bp = planetOf(state, a);
    if (!bp) continue;
    const info = planetElements(state, bp, t).find((b) => b.id === a.element_id);
    if (!info || alertDone(a, info) || info.next !== a.level || info.state !== 'buildable' || info.readyAt == null) continue;
    if (info.readyAt < t - BUILDING_KEEP) continue;
    list.push({
      id: `building:${a.id}:${a.level}`, kind: 'building', userId: ctx.user.id, member: name, time: info.readyAt, alert: a.id,
      planet: { g: a.g, s: a.s, p: a.p, type: a.planet_type, name: bp.name }, element: a.element_id, level: a.level,
    });
  }
  return list;
}

/**
 * The full storages of the viewer's planets, listed `STORAGE_KEEP` from when they got full. `storage_full` keeps since
 * when (the newest page of a full storage shows it full already at its sync time), a storage no longer full is
 * removed from it, so it notifies again the next time it runs full.
 */
function storages(db: DB, ctx: GroupContext, t: number, own: () => BuildingsState): StorageNotification[] {
  const state = own();
  const full = state.planets.flatMap((bp) => storagesOf(state, bp, t).filter((x) => x.full).map((x) => ({ bp, resource: x.resource, at: x.at! })));
  const known = db
    .prepare('SELECT g, s, p, resource, since FROM storage_full WHERE group_id = ? AND user_id = ?')
    .all(ctx.groupId, ctx.user.id) as { g: number; s: number; p: number; resource: number; since: number }[];
  const keyOf = (c: { g: number; s: number; p: number }, res: number) => `${c.g}:${c.s}:${c.p}:${res}`;
  const since = new Map(known.map((r) => [keyOf(r, r.resource), r.since]));
  const still = new Set(full.map((f) => keyOf(f.bp.coords, f.resource)));
  const drop = db.prepare('DELETE FROM storage_full WHERE group_id = ? AND user_id = ? AND g = ? AND s = ? AND p = ? AND resource = ?');
  for (const r of known) if (!still.has(keyOf(r, r.resource))) drop.run(ctx.groupId, ctx.user.id, r.g, r.s, r.p, r.resource);
  const add = db.prepare('INSERT OR IGNORE INTO storage_full (group_id, user_id, g, s, p, resource, since) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const list: StorageNotification[] = [];
  let name: string | undefined;
  for (const f of full) {
    const c = f.bp.coords;
    const key = keyOf(c, f.resource);
    let from = since.get(key);
    if (from == null) {
      from = f.at;
      add.run(ctx.groupId, ctx.user.id, c.g, c.s, c.p, f.resource, from);
    }
    if (from < t - STORAGE_KEEP) continue;
    name ??= db.prepare(`SELECT ${DISPLAY} FROM users u LEFT JOIN group_members gm ON gm.group_id = ? AND gm.user_id = u.id WHERE u.id = ?`).pluck().get(ctx.groupId, ctx.user.id) as string;
    list.push({
      id: `storage:${key}:${from}`, kind: 'storage', userId: ctx.user.id, member: name, time: from,
      planet: { g: c.g, s: c.s, p: c.p, name: f.bp.name }, resource: f.resource,
    });
  }
  return list;
}

/**
 * The earliest time after `t` when a storage on a planet of one of `userIds` (members of the group) gets full, null
 * when none will by what is known now.
 */
export function nextStorageFull(db: DB, universe: Universe, groupId: number, userIds: number[], t: number): number | null {
  let next: number | null = null;
  for (const id of userIds) {
    const u = db.prepare('SELECT id, username, is_admin, lang, date_format FROM users WHERE id = ?').get(id) as
      | { id: number; username: string; is_admin: number; lang: string; date_format: string }
      | undefined;
    if (!u) continue;
    const ctx = resolveGroup(db, { id: u.id, username: u.username, isAdmin: !!u.is_admin, lang: u.lang, dateFormat: u.date_format }, universe, groupId);
    const state = buildingsState(db, ctx, u.id, t);
    for (const bp of state.planets) {
      for (const x of storagesOf(state, bp, t)) if (x.at != null && x.at > t) next = next == null ? x.at : Math.min(next, x.at);
    }
  }
  return next;
}

/**
 * The viewer's fleet alerts from `LAUNCH_AHEAD` before their reminder time (the arrival minus the lead) until
 * `FLEET_KEEP` after the arrival.
 */
function fleets(db: DB, ctx: GroupContext, t: number): FleetNotification[] {
  const alerts = openFleetAlerts(db, ctx, ctx.user.id, t).filter((a) => a.arrival - a.lead * 60 - LAUNCH_AHEAD <= t && a.arrival + FLEET_KEEP > t);
  if (!alerts.length) return [];
  const name = db.prepare(`SELECT ${DISPLAY} FROM users u LEFT JOIN group_members gm ON gm.group_id = ? AND gm.user_id = u.id WHERE u.id = ?`).pluck().get(ctx.groupId, ctx.user.id) as string;
  // the id stays when the arrival moves by a second on a newer fleet list or the lead changes (sent once); alert ids
  // are never reused
  return alerts.map((a) => ({
    id: `fleet:${a.id}`, kind: 'fleet', userId: ctx.user.id, member: name, time: a.arrival, alert: a.id, fleet: a.fleet, lead: a.lead,
  }));
}

/**
 * The viewer's fleets of plans to the second (invited or ready, with start and ships) that launch within the next hour:
 * launch = target time minus the flight time, like the raid planner. Fleets the overview already shows in flight
 * count as launched; holds follow the impact first.
 */
function launches(db: DB, ctx: GroupContext, t: number): LaunchNotification[] {
  const fleets = db
    .prepare(
      `SELECT f.id, f.plan_id, f.user_id, f.g, f.s, f.p, f.planet_type, f.ships, f.speed, f.status, f.drives AS manual, f.drives_time
       FROM attack_plan_fleets f JOIN attack_plans a ON a.id = f.plan_id
       WHERE a.group_id = ? AND f.user_id = ? AND f.status IN ('invited', 'ready') AND f.g IS NOT NULL
         AND a.status IN ('planning', 'launched') AND a.time_precision = 'exact' AND a.g IS NOT NULL AND a.target_time > ?`,
    )
    .all(ctx.groupId, ctx.user.id, t) as (LaunchFleet & { ships: string; speed: number; manual: string | null; drives_time: number | null })[];
  if (!fleets.length) return [];
  const plans = db
    .prepare(
      `SELECT id, g, s, p, planet_type, target_time, status, mission, time_precision FROM attack_plans
       WHERE id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify([...new Set(fleets.map((f) => f.plan_id))])) as (LaunchPlan & Pick<PlanRow, 'g' | 's' | 'p'>)[];
  followEnemies(db, plans, new Map(enemiesOf(db, ctx, plans.map((p) => p.id)).map((e) => [e.plan_id, e])));
  launchedOf(db, ctx, plans, fleets);
  const drivesOf = planDrives(db, ctx);
  const u = ctx.universe.settings;
  const name = db.prepare(`SELECT ${DISPLAY} FROM users u LEFT JOIN group_members gm ON gm.group_id = ? AND gm.user_id = u.id WHERE u.id = ?`).pluck().get(ctx.groupId, ctx.user.id) as string;
  const list: LaunchNotification[] = [];
  for (const f of fleets) {
    const plan = plans.find((p) => p.id === f.plan_id)!;
    if (f.status !== 'invited' && f.status !== 'ready') continue;
    const drives = drivesOf({ user_id: f.user_id, manual: f.manual, drives_time: f.drives_time });
    const slowest = slowestShip(JSON.parse(f.ships), drivesFromResearch(drives?.research ?? {}));
    if (!slowest) continue;
    const duration = flightDuration(u, distance(u, [f.g!, f.s!, f.p!], [plan.g!, plan.s!, plan.p!]), slowest.speed, f.speed);
    const launch = launchFor(plan.target_time, duration);
    if (launch <= t || launch - LAUNCH_AHEAD > t) continue;
    list.push({
      id: `launch:${f.id}:${launch}`, kind: 'launch', userId: ctx.user.id, member: name, time: launch,
      plan: { id: plan.id, g: plan.g!, s: plan.s!, p: plan.p!, planet_type: plan.planet_type, mission: plan.mission, target_time: plan.target_time },
      from: { g: f.g!, s: f.s!, p: f.p!, type: (f.planet_type ?? 'planet') as 'planet' | 'moon' },
    });
  }
  return list;
}
