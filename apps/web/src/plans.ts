import {
  distance,
  drivesFromResearch,
  flightDuration,
  planAttack,
  SHIPS,
  slowestShip,
  type AcsPlan,
  type Coords,
  type FleetPlan,
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
  g: number;
  s: number;
  p: number;
  planet_type: 'planet' | 'moon';
  target_time: number;
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
}

export const PLAN_STATUSES = ['planning', 'launched', 'done', 'cancelled'] as const;
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
  const target: Coords = [plan.g, plan.s, plan.p];
  const flights = plan.fleets.map((f): { fleet: PlanFleet; duration: number | null } => {
    if (f.g == null || f.s == null || f.p == null || f.status === 'withdrawn') return { fleet: f, duration: null };
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

/** Plans still ahead or flying (shown first), the rest as past ones. */
export const isCurrent = (p: AttackPlan, now: number) => (p.status === 'planning' || p.status === 'launched') && p.target_time > now - 3600;

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
export function fromLocalInput(value: string): number | null {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}
