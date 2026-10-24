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
import { flightCalcLink, type UniverseSettings } from './format';

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
  /** research for flight times and the simulator: the member's latest empire page, else spy reports; drives also by hand (the newest counts) */
  drives: { time: number; research: Record<string, number>; source: 'empire' | 'spy' | 'manual' } | null;
  /** the member's newest overview shows this fleet in flight to the target: real arrival, time of that paste */
  seen: { arrival: number; time: number } | null;
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
  /** attack (solo, ACS, retime) or hold on a member's planet against a hostile attack */
  mission: 'attack' | 'hold';
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
  /**
   * newest spy report of the target (values by element id) for the combat simulators; hold plans: the defended planet
   * from the member's empire page, else its newest spy report
   */
  spy: { time: number; values: Record<string, number> } | null;
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
  /** hold plans: research of the attacking player (newest spy report showing it) for the combat simulators */
  research?: Record<string, number> | null;
  research_time?: number | null;
  departure: { from: number; to: number } | null;
  recall: { from: number; to: number } | null;
  recall_lead: boolean;
  /** the attack vanished from the member's overview between these pastes, before it arrived: likely recalled */
  recall_seen: { from: number; to: number } | null;
  percent: number | null;
  buffer: number;
  /** hold plans: seconds from the impact the hold fleets land */
  hold_offset: number;
  /** landing back home as a pasted phalanx showed it (then the retime lands after it) */
  phalanx: { home: number; time: number | null } | null;
  updated_at: number;
  updated_by: string | null;
}

/** Hostile attack on a member from the overview pastes, or seen in a phalanx (server: repo/hostile.ts). */
export interface HostileAttack {
  key: string;
  /** member it heads for; null when only seen in a phalanx */
  memberId: number | null;
  /** that member, or the attacked player by the galaxy data */
  member: string | null;
  source: 'overview' | 'phalanx';
  /** member who pasted the phalanx */
  reporter: string | null;
  /** landing back home when the phalanx shows the return (the scanned player's own attack) */
  home: number | null;
  seen: number;
  arrival: number;
  from: Body;
  to: Body;
  fleets: EnemyFleet[];
  player: { id: number; name: string } | null;
  drives: { research: Record<string, number>; time: number | null } | null;
  until: number;
  /** retime and hold plan answering it */
  planId: number | null;
  holdPlanId: number | null;
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

const shipsParam = (ships: Record<string, number>) =>
  Object.entries(ships)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${id}:${n}`)
    .join(',');

/** Flight calculator ("timing" mode) for a fleet of a plan: its start, ships, speed and drives, landing at the target time. */
export function fleetCalcLink(u: UniverseSettings, plan: AttackPlan, f: PlanFleet): string | null {
  if (plan.g == null || f.g == null) return null;
  return flightCalcLink(u, [f.g, f.s!, f.p!], [plan.g, plan.s!, plan.p!], f.drives?.research ?? {}, {
    m: 'timing',
    arr: plan.target_time,
    ships: shipsParam(f.ships),
    spd: f.speed / 10,
  });
}

/**
 * Flight calculator ("retime" mode) for the enemy fleet of a plan: followed fleet, drives, arrival (and the first seen
 * one after a delay), recall and chosen speed; `own` (a fleet of the viewer) fills the counter-attack with start, slowest
 * ship, drives and the buffer.
 */
export function enemyCalcLink(u: UniverseSettings, e: EnemyInput & Pick<PlanEnemy, 'percent' | 'buffer'>, own?: PlanFleet): string {
  const fleet = e.fleets[e.recall && e.recall_lead ? 0 : e.follow] ?? e.fleets[0];
  const extra: Record<string, string | number> = { m: 'retime', ships: shipsParam(fleet?.ships ?? {}), ea: e.arrival };
  if (e.percent) extra.spd = e.percent / 10;
  if (e.first_seen !== e.arrival) extra.eo = e.first_seen;
  extra.eout = e.recall ? 'recall' : 'impact';
  if (e.recall) extra.er = e.recall.from;
  if (own?.g != null) {
    const research = own.drives?.research ?? {};
    const slowest = slowestShip(own.ships, drivesFromResearch(research));
    extra.ks = `${own.g}:${own.s}:${own.p}`;
    if (slowest) extra.kship = slowest.id;
    Object.assign(extra, { kc: research[115] ?? 0, ki: research[117] ?? 0, kh: research[118] ?? 0, ko: e.buffer });
  }
  return flightCalcLink(u, [e.from.g, e.from.s, e.from.p], [e.to.g, e.to.s, e.to.p], e.drives, extra);
}

/** Seconds after the enemy's return the own fleets land by default (0-1 s is a good retime). */
export const DEFAULT_BUFFER = 1;

/** How good a retime buffer is: up to 1 s good, 2-3 s poor, from 4 s very poor. */
export const bufferRating = (seconds: number) => (seconds <= 1 ? 'good' : seconds <= 3 ? 'poor' : 'bad');

/** Landing back home of a candidate: after the impact, or the earliest return after the recall. */
export const candidateHome = (c: RetimeCandidate) => (c.recallHome ? c.recallHome.from : c.home);

/** A hold must be there before the fight: at least 1 s before the impact; later only pays off if the enemy delays. */
export const holdRating = (offset: number) => (offset <= -1 ? 'safe' : 'late');

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
  // holds cannot be delayed and form no ACS: every fleet lands on its own
  if (plan.mission === 'hold') {
    return {
      acs: null,
      fleets: flights.map((x) => ({
        ...x,
        plan: x.duration == null ? null : { ...planAttack(plan.target_time, [{ id: String(x.fleet.id), player: String(x.fleet.user_id), duration: x.duration }], now).fleets[0], delays: false },
      })),
    };
  }
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

/** Plans in a fleet's flight: the plan is set to launched or a fleet was launched (by hand or seen in the overview). */
export const isRunning = (p: AttackPlan) => p.status === 'launched' || p.fleets.some((f) => f.status === 'launched');

/** Current plans for the menu: still being planned, and running ones. */
export function planCounts(plans: AttackPlan[], now: number): { planning: number; running: number } {
  const current = plans.filter((p) => isCurrent(p, now));
  const running = current.filter(isRunning).length;
  return { planning: current.length - running, running };
}

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
