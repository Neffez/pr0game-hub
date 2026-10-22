/**
 * Retime: when does a hostile fleet land back home? Ships and route are known, the speed percent is not, so there is
 * one candidate per speed step. Rules (timing rules in FEATURE_REQUEST_RETIME.md, from the game source):
 * - return after impact = arrival + duration (pure flight time, ACS delays do not count);
 * - a single attack launched exactly `floor(duration)` before its arrival; a fleet in an ACS may have waited for the
 *   ACS time or been pushed back, so it launched at that time or earlier;
 * - a recall returns after the time flown so far: `home = 2 * recall - launch`. Recalling the ACS lead recalls the
 *   whole ACS with the lead's return (use the lead's candidate for all its fleets).
 */
import { homeOf, launchFor } from './acs.js';
import { distance, flightDuration, slowestShip, SPEED_PERCENTS, type Coords, type Drives, type Fleet, type Universe } from './flight.js';

/** Time range in unix seconds, both ends included. */
export interface TimeWindow {
  from: number;
  to: number;
}

export interface EnemyFleet {
  from: Coords;
  to: Coords;
  ships: Fleet;
  /** drive levels of the owner (prefilled from hub data, editable) */
  drives: Drives;
  /** arrival as shown now */
  arrival: number;
  /** arrival first seen, before later ACS delays (defaults to `arrival`) */
  firstSeen?: number;
  /** part of an ACS (lead or further fleet): may have waited, so the launch is only an upper bound */
  acs?: boolean;
  /** "not on the overview at …, there at …": the launch lies in this window */
  departure?: TimeWindow | null;
  /** the fleet vanished before its arrival: it was recalled in this window */
  recall?: TimeWindow | null;
}

export interface RetimeCandidate {
  percent: number;
  /** one-way duration (float) */
  duration: number;
  /** possible launches: exact for a single attack (from = to); `from` null when open (ACS without departure window) */
  launch: { from: number | null; to: number };
  /** fits the departure and recall windows */
  possible: boolean;
  /** landing back home after impact */
  home: number;
  /** landing back home after the recall: range from the windows, `to` null when open; null without recall */
  recallHome: { from: number; to: number | null } | null;
}

/** One candidate per speed step (100 % first); empty when no ship of the fleet is known. */
export function retimeCandidates(u: Universe, fleet: EnemyFleet): RetimeCandidate[] {
  const slowest = slowestShip(fleet.ships, fleet.drives);
  if (!slowest) return [];
  const dist = distance(u, fleet.from, fleet.to);
  const dep = fleet.departure ?? null;
  return SPEED_PERCENTS.map((percent) => {
    const duration = flightDuration(u, dist, slowest.speed, percent);
    const latest = launchFor(fleet.firstSeen ?? fleet.arrival, duration);
    let from: number | null = fleet.acs ? (dep?.from ?? null) : latest;
    let to = fleet.acs && dep ? Math.min(dep.to, latest) : latest;
    let possible = !dep || (fleet.acs ? latest >= dep.from : latest >= dep.from && latest <= dep.to);
    if (!fleet.acs) from = to = latest;

    let recallHome: RetimeCandidate['recallHome'] = null;
    if (fleet.recall) {
      // recalled while flying out: after the (earliest) launch and before the arrival
      const r1 = from == null ? fleet.recall.from : Math.max(fleet.recall.from, from);
      const r2 = Math.min(fleet.recall.to, fleet.arrival - 1);
      if (r2 < r1 || r2 < (from ?? -Infinity)) possible = false;
      else {
        // launch before the recall; earliest home: earliest recall after the latest launch possible by then
        to = Math.min(to, r2);
        recallHome = { from: 2 * r1 - Math.min(to, r1), to: from == null ? null : 2 * r2 - from };
      }
    }
    return { percent, duration, launch: { from, to }, possible, home: homeOf(fleet.arrival, duration), recallHome };
  });
}
