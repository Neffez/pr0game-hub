/**
 * Planning own attacks, solo or as ACS, by the rules of ShowFleetStep3Page and FleetFunctions::setACSTime:
 * - a fleet lands `floor(duration)` after its launch;
 * - the lead sends an attack and creates the ACS, the others join afterwards;
 * - a fleet that would land before the ACS time waits for it, one that would land later pushes the whole ACS
 *   (arrival and return of all fleets) back by the difference, without any limit;
 * - beyond `maxFleets` fleets or `maxParticipants` players a fleet is sent as a normal attack and lands on its own;
 * - every fleet lands back home `duration` after the (possibly delayed) arrival.
 */

export interface AcsLimits {
  /** game config max_fleets_per_acs */
  maxFleets: number;
  /** game config max_participants_per_acs (lead included) */
  maxParticipants: number;
}

/** Limits of the pr0game universes. */
export const ACS_LIMITS: AcsLimits = { maxFleets: 16, maxParticipants: 5 };

/** Launch so that a fleet with this one-way duration lands at `arrival`. */
export const launchFor = (arrival: number, duration: number) => arrival - Math.floor(duration);

/** Landing of a fleet launched at `launch`. */
export const arrivalOf = (launch: number, duration: number) => launch + Math.floor(duration);

/** Landing back home after an arrival at `arrival` (no stay). */
export const homeOf = (arrival: number, duration: number) => Math.floor(arrival + duration);

export interface PlannedFleet {
  id: string;
  /** player sending it (counts against maxParticipants) */
  player: string;
  /** one-way duration in seconds (float, `flightDuration`) */
  duration: number;
}

export interface FleetPlan {
  id: string;
  /** launch for the target time */
  launch: number;
  /** the target time cannot be reached any more: launch lies before now */
  late: boolean;
  /** earliest possible landing from now (equals the target time when not late) */
  earliest: number;
  /** pushes the ACS back (its earliest landing is the resulting arrival and lies after the target time) */
  delays: boolean;
  /** would have to launch before the lead, i.e. before the ACS exists */
  beforeLead: boolean;
  /** beyond the ACS limits: sent as a normal attack, lands on its own at `earliest`/`launch` timing */
  outside: boolean;
  /** landing back home after the resulting arrival */
  home: number;
}

export interface AcsPlan {
  /** id of the lead (earliest launch, or the given one) */
  lead: string | null;
  /** arrival of the ACS: target time, or later when fleets push it back */
  arrival: number;
  /** seconds the ACS lands after the target time */
  delay: number;
  fleets: FleetPlan[];
  /** players in the ACS, lead first (in launch order) */
  players: string[];
  /** fleets / players beyond the limits */
  tooManyFleets: boolean;
  tooManyPlayers: boolean;
}

/**
 * Plan for landing all fleets at `target` (unix seconds), seen at `now`. One fleet is a solo attack. The lead is the
 * fleet with the earliest launch unless `lead` names one. Fleets beyond the limits (in launch order) are marked
 * `outside` and do not count for the ACS arrival.
 */
export function planAttack(target: number, fleets: PlannedFleet[], now: number, opts: { lead?: string; limits?: AcsLimits } = {}): AcsPlan {
  const limits = opts.limits ?? ACS_LIMITS;
  const order = fleets
    .map((f, i) => ({ f, i, launch: launchFor(target, f.duration) }))
    .sort((a, b) => a.launch - b.launch || a.i - b.i);
  const leadId = opts.lead ?? order[0]?.f.id ?? null;
  const leadItem = order.find((o) => o.f.id === leadId);
  if (leadItem) {
    order.splice(order.indexOf(leadItem), 1);
    order.unshift(leadItem);
  }

  // limits in launch order, lead first: a player is in once one of their fleets is
  const players: string[] = [];
  let count = 0;
  const outside = new Set<number>();
  for (const o of order) {
    const known = players.includes(o.f.player);
    if (count >= limits.maxFleets || (!known && players.length >= limits.maxParticipants)) {
      outside.add(o.i);
      continue;
    }
    count++;
    if (!known) players.push(o.f.player);
  }

  const earliest = (f: PlannedFleet) => Math.max(target, arrivalOf(now, f.duration));
  const inAcs = order.filter((o) => !outside.has(o.i));
  const arrival = Math.max(target, ...inAcs.map((o) => earliest(o.f)));
  const leadLaunch = leadItem ? Math.max(now, leadItem.launch) : null;
  const plans: FleetPlan[] = fleets.map((f, i) => {
    const launch = launchFor(target, f.duration);
    const out = outside.has(i);
    const own = earliest(f);
    return {
      id: f.id,
      launch,
      late: launch < now,
      earliest: own,
      delays: !out && own > target && own === arrival,
      beforeLead: leadLaunch != null && f.id !== leadId && Math.max(now, launch) < leadLaunch,
      outside: out,
      home: homeOf(out ? own : arrival, f.duration),
    };
  });
  return {
    lead: leadItem ? leadId : null,
    arrival,
    delay: arrival - target,
    fleets: plans,
    players,
    tooManyFleets: fleets.length > limits.maxFleets,
    tooManyPlayers: new Set(fleets.map((f) => f.player)).size > limits.maxParticipants,
  };
}
