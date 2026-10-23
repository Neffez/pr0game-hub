import {
  distance,
  drivesFromResearch,
  flightDuration,
  planAttack,
  retimeCandidates,
  SHIPS,
  slowestShip,
  type AcsPlan,
  type Coords,
  type FleetPlan,
  type RetimeCandidate,
} from '@pr0hub/flight';
import type { UniverseSettings } from './format';

/** Fleet of an attack plan (server: routes/plans.ts). */
export interface PlanFleet {
  id: number;
  user_id: number;
  member: string;
  g: number | null;
  s: number | null;
  p: number | null;
  planet_type: 'planet' | 'moon' | null;
  ships: Record<string, number>;
  speed: number;
  status: 'invited' | 'ready' | 'launched' | 'withdrawn';
  updated_at: number;
  /** drive research of the member's latest empire page */
  drives: { time: number; research: Record<string, number> } | null;
}

/** Own attack of one or more members on one target at one time (server: routes/plans.ts). */
export interface AttackPlan {
  id: number;
  user_id: number;
  creator: string;
  /** target coordinates, null until known (the plan then names a player) */
  g: number | null;
  s: number | null;
  p: number | null;
  planet_type: 'planet' | 'moon';
  /** with `time_precision` day: start of that day; hour: around that time; exact: impact to the second */
  target_time: number;
  time_precision: Precision;
  note: string | null;
  status: 'planning' | 'launched' | 'done' | 'cancelled';
  created_at: number;
  updated_at: number;
  /** member holding the plan's target claim (null: none, e.g. claimed by someone else) */
  claim_user_id: number | null;
  player_id: number | null;
  player_name: string | null;
  planet_name: string | null;
  fleets: PlanFleet[];
  /** retime: the hostile fleet the plan answers */
  enemy: PlanEnemy | null;
}

export interface Body {
  g: number;
  s: number;
  p: number;
  type: 'planet' | 'moon';
}
export interface EnemyFleet {
  mission: number | null;
  ships: Record<string, number>;
}

/** Hostile fleet of a retime plan (server: routes/plans.ts); its inputs are shared by all participants. */
export interface PlanEnemy {
  member_id: number | null;
  member: string | null;
  from: Body;
  to: Body;
  /** the lead first */
  fleets: EnemyFleet[];
  follow: number;
  arrival: number;
  first_seen: number;
  drives: Record<string, number>;
  drives_source: 'spy' | 'manual' | null;
  drives_time: number | null;
  departure: { from: number; to: number } | null;
  recall: { from: number; to: number } | null;
  recall_lead: boolean;
  percent: number | null;
  buffer: number;
  updated_at: number;
  updated_by: string | null;
}

/** Hostile attack on a member from the overview pastes (server: repo/hostile.ts). */
export interface HostileAttack {
  key: string;
  memberId: number;
  member: string;
  seen: number;
  arrival: number;
  from: Body;
  to: Body;
  fleets: EnemyFleet[];
  player: { id: number; name: string } | null;
  drives: { research: Record<string, number>; time: number | null } | null;
  until: number;
  planId: number | null;
}

/** Inputs of the enemy analysis (plan enemy or form values). */
export type EnemyInput = Pick<PlanEnemy, 'from' | 'to' | 'fleets' | 'follow' | 'arrival' | 'first_seen' | 'drives' | 'departure' | 'recall' | 'recall_lead'>;

/**
 * Speed candidates of the followed enemy fleet. After a recall of the ACS lead all fleets come back with the lead,
 * so the lead's candidates count then.
 */
export function enemyCandidates(u: UniverseSettings, e: EnemyInput): RetimeCandidate[] {
  const index = e.recall && e.recall_lead ? 0 : e.follow;
  const fleet = e.fleets[index] ?? e.fleets[0];
  if (!fleet) return [];
  return retimeCandidates(u, {
    from: [e.from.g, e.from.s, e.from.p],
    to: [e.to.g, e.to.s, e.to.p],
    ships: fleet.ships,
    drives: drivesFromResearch(e.drives),
    arrival: e.arrival,
    firstSeen: e.first_seen,
    acs: e.fleets.length > 1,
    departure: e.departure,
    recall: e.recall,
  });
}

/** Landing back home of a candidate: after the impact, or the earliest return after the recall. */
export const candidateHome = (c: RetimeCandidate) => (c.recallHome ? c.recallHome.from : c.home);

/** Fleet of an attack to follow by default: the one with the most ships (the main fleet, not the lead's probe). */
export const mainFleet = (fleets: EnemyFleet[]) =>
  fleets.reduce((best, f, i) => (Object.values(f.ships).reduce((a, n) => a + n, 0) > Object.values(fleets[best].ships).reduce((a, n) => a + n, 0) ? i : best), 0);

export const PLAN_STATUSES = ['planning', 'launched', 'done', 'cancelled'] as const;
export const PRECISIONS = ['day', 'hour', 'exact'] as const;
export type Precision = (typeof PRECISIONS)[number];
export const FLEET_STATUSES = ['invited', 'ready', 'launched', 'withdrawn'] as const;
export const SPEEDS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
/** Ships that can fly (drive data in @pr0hub/flight), in game order. */
export const FLEET_SHIPS = Object.keys(SHIPS).map(Number);
/** Drive research older than this is flagged (days). */
export const DRIVES_MAX_AGE = 3 * 86400;

/** A fleet with its flight: null when it has no start or no known ship yet (e.g. only invited). */
export interface FleetFlight {
  fleet: PlanFleet;
  duration: number | null;
  plan: FleetPlan | null;
}

export interface PlanView {
  /** planAttack over the fleets that fly (not withdrawn, with start and ships) */
  acs: AcsPlan | null;
  fleets: FleetFlight[];
}

/** Flight times, launches, lead and delays of a plan at `now`. */
export function computePlan(u: UniverseSettings, plan: AttackPlan, now: number): PlanView {
  const target: Coords | null = plan.g != null && plan.s != null && plan.p != null ? [plan.g, plan.s, plan.p] : null;
  const flights = plan.fleets.map((f): { fleet: PlanFleet; duration: number | null } => {
    if (!target || f.g == null || f.s == null || f.p == null || f.status === 'withdrawn') return { fleet: f, duration: null };
    const drives = drivesFromResearch(f.drives?.research ?? {});
    const slowest = slowestShip(f.ships, drives);
    if (!slowest) return { fleet: f, duration: null };
    return { fleet: f, duration: flightDuration(u, distance(u, [f.g, f.s, f.p], target), slowest.speed, f.speed) };
  });
  const flying = flights.filter((x): x is { fleet: PlanFleet; duration: number } => x.duration != null);
  const acs = flying.length
    ? planAttack(plan.target_time, flying.map((x) => ({ id: String(x.fleet.id), player: String(x.fleet.user_id), duration: x.duration })), now)
    : null;
  return {
    acs,
    fleets: flights.map((x) => ({ ...x, plan: acs?.fleets.find((p) => p.id === String(x.fleet.id)) ?? null })),
  };
}

/** End of the time a plan may land in: the day, around the hour, or the second. */
export const latestTime = (p: Pick<AttackPlan, 'target_time' | 'time_precision'>) =>
  p.target_time + (p.time_precision === 'day' ? 86400 : p.time_precision === 'hour' ? 3600 : 0);

/** Plans still ahead or flying (shown first), the rest as past ones. */
export const isCurrent = (p: AttackPlan, now: number) => (p.status === 'planning' || p.status === 'launched') && latestTime(p) > now - 3600;

/** "1:41:1" / "[1:41:1]" -> coordinates. */
export function parseTarget(raw: string): Coords | null {
  const m = raw.match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Unix seconds <-> value of an `<input type="datetime-local" step="1">` (browser time, like the rest of the hub). */
export function toLocalInput(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** Value of an `<input type="date">` <-> start of that day (browser time). */
export const toDateInput = (epoch: number) => toLocalInput(epoch).slice(0, 10);
export const fromDateInput = (value: string) => fromLocalInput(`${value}T00:00:00`);

export function fromLocalInput(value: string): number | null {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

/** Form values of a plan's target and time (new plan, or editing one). */
export interface PlanDraft {
  player: { id: number; name: string } | null;
  /** "g:s:p", empty while unknown */
  target: string;
  type: 'planet' | 'moon';
  precision: Precision;
  /** `<input type="date">` value (precision day) */
  date: string;
  /** `<input type="datetime-local">` value (hour, exact) */
  time: string;
  note: string;
}

export function newDraft(now: number, target = '', type: 'planet' | 'moon' = 'planet'): PlanDraft {
  return { player: null, target, type, precision: 'exact', date: toDateInput(now + 86400), time: toLocalInput(now + 3600), note: '' };
}

export function draftOf(p: AttackPlan): PlanDraft {
  return {
    player: p.player_id ? { id: p.player_id, name: p.player_name ?? '?' } : null,
    target: p.g != null ? `${p.g}:${p.s}:${p.p}` : '',
    type: p.planet_type,
    precision: p.time_precision,
    date: toDateInput(p.target_time),
    time: toLocalInput(p.target_time),
    note: p.note ?? '',
  };
}

/** Request body of a draft; null when the target (player or coordinates) or the time is missing or invalid. */
export function draftBody(d: PlanDraft) {
  const raw = d.target.trim();
  const c = raw ? parseTarget(raw) : null;
  if (raw && !c) return null;
  if (!c && !d.player) return null;
  const time = d.precision === 'day' ? fromDateInput(d.date) : fromLocalInput(d.time);
  if (!time) return null;
  return {
    g: c?.[0] ?? null,
    s: c?.[1] ?? null,
    p: c?.[2] ?? null,
    type: d.type,
    player_id: d.player?.id ?? null,
    target_time: time,
    time_precision: d.precision,
    note: d.note,
  };
}
