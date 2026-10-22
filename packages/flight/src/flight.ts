/**
 * Ports of the game's FleetFunctions (getTargetDistance, getShipSpeed, getFleetMaxSpeed, getMissionDuration,
 * getFleetConsumption, sendFleetBack) and the send/ACS timing of ShowFleetStep3Page / setACSTime.
 * Durations stay float, timestamps are floored like on the server.
 */
import { SHIPS, type ShipDrives } from './ships.js';

export const MIN_FLEET_TIME = 5;

export type Coords = [number, number, number];

/** Universe layout as configured in the game (same field names as the hub's universe settings). */
export interface Universe {
  galaxies: number;
  systems: number;
  circularGalaxies: boolean;
  circularSystems: boolean;
  galaxyDistanceFactor: number;
  systemDistanceFactor: number;
  systemDistance: number;
  planetDistanceFactor: number;
  planetDistance: number;
  /** game config `fleet_speed`, 2500 = normal speed */
  fleetSpeed: number;
}

/** Drive research levels (115, 117, 118) and fuel efficiency (134). */
export interface Drives {
  combustion: number;
  impulse: number;
  hyperspace: number;
  fuelEfficiency?: number;
}

/** Research levels by element id -> drive levels (missing levels count as 0). */
export const drivesFromResearch = (research: Record<number, number | undefined>): Drives => ({
  combustion: research[115] ?? 0,
  impulse: research[117] ?? 0,
  hyperspace: research[118] ?? 0,
  fuelEfficiency: research[134] ?? 0,
});

/** Fleet as ship id -> amount. */
export type Fleet = Record<number, number>;

/** Speed steps the game offers: 10 % to 100 %. */
export const SPEED_PERCENTS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10] as const;

/** Shortest wrap-around distance, like the ring branches on the server. */
function ringDistance(a: number, b: number, max: number): number {
  const d = Math.abs(a - b);
  if (d < Math.ceil(max / 2)) return d;
  return Math.floor(max / 2) - (d - Math.ceil(max / 2));
}

/** FleetFunctions::getTargetDistance */
export function distance(u: Universe, a: Coords, b: Coords): number {
  if (a[0] !== b[0]) {
    const d = u.circularGalaxies ? ringDistance(a[0], b[0], u.galaxies) : Math.abs(a[0] - b[0]);
    return d * u.galaxyDistanceFactor;
  }
  if (a[1] !== b[1]) {
    const d = u.circularSystems ? ringDistance(a[1], b[1], u.systems) : Math.abs(a[1] - b[1]);
    return d * u.systemDistanceFactor + u.systemDistance;
  }
  if (a[2] !== b[2]) return Math.abs(a[2] - b[2]) * u.planetDistanceFactor + u.planetDistance;
  return 5;
}

/** Drive index (0-2) a ship uses with the given research. */
function driveIndex(ship: ShipDrives, drives: Drives): 0 | 1 | 2 {
  const uses = (need: number, have: number) => need === 1 || (need > 1 && have >= need);
  if (uses(ship.tech[2], drives.hyperspace)) return 2;
  if (uses(ship.tech[1], drives.impulse)) return 1;
  return 0;
}

const DRIVE_BONUS = [0.1, 0.2, 0.3];

/** FleetFunctions::getShipSpeed; 0 for unknown ships. */
export function shipSpeed(id: number, drives: Drives): number {
  const ship = SHIPS[id];
  if (!ship) return 0;
  const i = driveIndex(ship, drives);
  const level = [drives.combustion, drives.impulse, drives.hyperspace][i];
  return ship.speed[i] * (1 + DRIVE_BONUS[i] * level);
}

/** Slowest ship of a fleet (FleetFunctions::getFleetMaxSpeed); null when no known ship is in it. */
export function slowestShip(fleet: Fleet, drives: Drives): { id: number; speed: number } | null {
  let best: { id: number; speed: number } | null = null;
  for (const [key, amount] of Object.entries(fleet)) {
    const id = Number(key);
    const speed = shipSpeed(id, drives);
    if (amount > 0 && speed > 0 && (!best || speed < best.speed)) best = { id, speed };
  }
  return best;
}

/** FleetFunctions::getMissionDuration: one-way seconds (float) at 10-100 % speed. */
export function flightDuration(u: Universe, dist: number, fleetSpeed: number, percent = 100): number {
  if (!fleetSpeed || fleetSpeed <= 0) return MIN_FLEET_TIME;
  // the game passes the speed step 1-10 and multiplies by 0.1; keep that for identical float rounding
  let duration = 3500 / ((percent / 10) * 0.1);
  duration *= Math.sqrt((dist * 10) / fleetSpeed);
  duration += 10;
  duration /= u.fleetSpeed / 2500;
  return Math.max(duration, MIN_FLEET_TIME);
}

/** FleetFunctions::getFleetConsumption: deuterium for one way. */
export function fleetConsumption(u: Universe, fleet: Fleet, duration: number, dist: number, drives: Drives, honorBoost = 1): number {
  const gameSpeed = u.fleetSpeed / 2500;
  let consumption = 0;
  for (const [key, amount] of Object.entries(fleet)) {
    const id = Number(key);
    const ship = SHIPS[id];
    const speed = shipSpeed(id, drives);
    if (!ship || !(amount > 0) || speed <= 0) continue;
    const base = ship.consumption[driveIndex(ship, drives)] * (1 - 0.02 * (drives.fuelEfficiency ?? 0));
    const spd = (35000 / Math.max(duration * gameSpeed - 10, 1)) * Math.sqrt((dist * 10) / speed);
    consumption += ((base * amount * dist) / 35000) * (spd / 10 + 1) * (spd / 10 + 1);
  }
  return Math.round(consumption * honorBoost) + 1;
}

/** Unix seconds of one flight: launch, arrival, end of stay, landing back home. */
export interface FlightTimes {
  start: number;
  arrival: number;
  stayEnd: number;
  home: number;
}

/** Times as the server stores them when sending at `start`. */
export function flightTimes(start: number, duration: number, stay = 0): FlightTimes {
  const arrival = Math.floor(duration) + start;
  const stayEnd = Math.floor(arrival + stay);
  return { start, arrival, stayEnd, home: Math.floor(stayEnd + duration) };
}

/** Known arrival, no delay: launch and return follow from the duration. */
export function flightTimesFromArrival(arrival: number, duration: number, stay = 0): FlightTimes {
  return flightTimes(arrival - Math.floor(duration), duration, stay);
}

/**
 * Fleet now arriving at `arrival`; `original` is its arrival when it was sent (before any ACS delay or waiting).
 * setACSTime() shifts arrival, stay end and return, but never the launch.
 */
export function delayedFlightTimes(arrival: number, original: number, duration: number, stay = 0): FlightTimes {
  const stayEnd = Math.floor(arrival + stay);
  return { start: original - Math.floor(duration), arrival, stayEnd, home: Math.floor(stayEnd + duration) };
}

export type RecallResult =
  | { home: number; phase: 'out' | 'hold' }
  | { home: null; reason: 'not_started' | 'stay_locked' | 'returning' };

/**
 * FleetFunctions::sendFleetBack: an outbound recall returns after the time already flown, a recall while holding
 * (hold/trade, `holdRecallable`) after the full outbound time. Expeditions cannot be recalled once they arrived.
 */
export function recallHome(recall: number, t: FlightTimes, holdRecallable = false): RecallResult {
  if (recall < t.start) return { home: null, reason: 'not_started' };
  if (recall < t.arrival) return { home: recall + (recall - t.start), phase: 'out' };
  if (recall < t.stayEnd) {
    if (!holdRecallable) return { home: null, reason: 'stay_locked' };
    return { home: recall + (t.arrival - t.start), phase: 'hold' };
  }
  return { home: null, reason: 'returning' };
}

export type RecallTimeResult =
  | { recall: number; home: number; phase: 'out' | 'hold' }
  | { recall: null; reason: 'before_start' | 'no_recall_needed' | 'unreachable' };

/** Inverse of recallHome: recall time (rounded up) to be back home at `wanted`. */
export function recallFor(wanted: number, t: FlightTimes, holdRecallable = false): RecallTimeResult {
  if (wanted <= t.start) return { recall: null, reason: 'before_start' };
  if (wanted >= t.home) return { recall: null, reason: 'no_recall_needed' };
  const recall = Math.ceil((wanted + t.start) / 2);
  if (recall < t.arrival) return { recall, home: 2 * recall - t.start, phase: 'out' };
  if (holdRecallable && t.stayEnd > t.arrival) {
    const holdRecall = wanted - (t.arrival - t.start);
    if (holdRecall >= t.arrival && holdRecall < t.stayEnd) {
      return { recall: holdRecall, home: holdRecall + (t.arrival - t.start), phase: 'hold' };
    }
  }
  return { recall: null, reason: 'unreachable' };
}
