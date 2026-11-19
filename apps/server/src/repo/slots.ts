import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { buildingsState } from './buildings.js';
import type { StoredFleet } from './fleets.js';

/**
 * Fleet and expedition slots of a member, like the game's `FleetFunctions`: every own fleet but missile attacks takes
 * one of `1 + computer technology` slots (`getMaxFleetSlots`, `getCurrentFleets`), expeditions also one of
 * `⌊√astrophysics⌋` expedition slots (`getExpeditionLimit`). A fleet holds its slot until it is back home (the game
 * deletes the fleet then), so the newest synced fleet list tells which slots are taken until when. An expedition that
 * a black hole swallowed is gone at the end of its stay already, and a fast or slow expedition comes back earlier or
 * later (`MissionCaseExpedition`): the expedition reports synced after the fleet list correct that.
 */

export const EXPEDITION_MISSION = 15;
/** Missile attacks take no fleet slot. */
const MISSILE_MISSION = 10;
const COMPUTER_TECH = 108;
const ASTROPHYSICS = 124;
/** An expedition report is written at the end of the stay (`stay_time`); its time matches the hold line this closely. */
const REPORT_TOLERANCE = 60;

/** One own flight of the fleet list: its lines (out, hold, return as listed) and when it frees its slot. */
export interface Flight {
  mission: number | null;
  lines: StoredFleet[];
  /** when the fleet is home again (or gone), its slot free */
  end: number;
  /** an expedition swallowed by a black hole (its report was synced) */
  lost: boolean;
}

const PHASES: StoredFleet['phase'][] = ['out', 'hold', 'return'];

const sameCoords = (a: StoredFleet['from'] | null, b: StoredFleet['from'] | null) =>
  !!a && !!b && a.coords.g === b.coords.g && a.coords.s === b.coords.s && a.coords.p === b.coords.p;
const sameShips = (a: Record<number, number>, b: Record<number, number>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[Number(k)] === b[Number(k)]);
};

/**
 * The own flights of a fleet list: each line starts a flight unless it continues an earlier one (a later phase of the
 * same mission between the same two places, the earliest such line after it, one with the same ships first). Two
 * flights between the same places with different stays may swap their later lines; the number of flights and their
 * ends stay right.
 */
export function flightsOf(list: StoredFleet[]): StoredFleet[][] {
  const own = list
    .filter((f) => f.owner === 'own')
    .sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.arrival - b.arrival);
  const used = new Set<StoredFleet>();
  const flights: StoredFleet[][] = [];
  for (const f of own) {
    if (used.has(f)) continue;
    used.add(f);
    const lines = [f];
    const ends = (x: StoredFleet) => (sameCoords(x.from, f.from) && sameCoords(x.to, f.to)) || (sameCoords(x.from, f.to) && sameCoords(x.to, f.from));
    for (const phase of PHASES.slice(PHASES.indexOf(f.phase) + 1)) {
      const last = lines[lines.length - 1];
      const next = own
        .filter((x) => !used.has(x) && x.phase === phase && (x.mission ?? null) === (f.mission ?? null) && x.arrival > last.arrival && ends(x))
        .sort((a, b) => Number(!sameShips(a.ships, last.ships)) - Number(!sameShips(b.ships, last.ships)) || a.arrival - b.arrival)[0];
      if (next) {
        used.add(next);
        lines.push(next);
      }
    }
    flights.push(lines);
  }
  return flights;
}

type Report = { time: number; g: number | null; s: number | null; p: number | null; event: string; factor: number | null };

/** The flights of a fleet list with their ends; expedition reports synced since correct the expeditions (see top). */
export function flightEnds(list: StoredFleet[], reports: Report[]): Flight[] {
  return flightsOf(list).map((lines) => {
    const last = lines[lines.length - 1];
    const flight: Flight = { mission: last.mission, lines, end: last.arrival, lost: false };
    if (last.mission !== EXPEDITION_MISSION) return flight;
    const hold = lines.find((l) => l.phase === 'hold');
    const back = lines.find((l) => l.phase === 'return');
    if (!hold) return flight;
    const at = hold.to ?? hold.from;
    const report = reports.find(
      (r) => Math.abs(r.time - hold.arrival) <= REPORT_TOLERANCE && r.g === at.coords.g && r.s === at.coords.s && r.p === at.coords.p,
    );
    if (!report) return flight;
    if (report.event === 'BlackHole') return { ...flight, end: hold.arrival, lost: true };
    if (back && report.factor) {
      const way = back.arrival - hold.arrival;
      if (report.event === 'Fast') flight.end = hold.arrival + Math.max(1, Math.floor(way * (1 - report.factor / 10)));
      if (report.event === 'Slow') flight.end = back.arrival + 3600 * report.factor;
    }
    return flight;
  });
}

/** The member's own flights by their newest fleet list (`time` its page time), null without one. */
export function memberFlights(db: DB, groupId: number, userId: number, list: { time: number; data: StoredFleet[] } | null): { time: number; flights: Flight[] } | null {
  if (!list) return null;
  // expedition reports of stays ending after the list was synced
  const reports = db
    .prepare('SELECT time, g, s, p, event, factor FROM expeditions WHERE group_id = ? AND user_id = ? AND time >= ?')
    .all(groupId, userId, list.time - REPORT_TOLERANCE) as Report[];
  return { time: list.time, flights: flightEnds(list.data, reports).filter((f) => f.end > list.time) };
}

export interface SlotCount {
  /** flights holding a slot at `at` */
  used: number;
  /** slots by the research, null when it is unknown */
  max: number | null;
  /** when the next of them frees its slot, null when none is taken */
  next: number | null;
  /** when each of them frees its slot, earliest first (the client counts down with them) */
  ends: number[];
}

export interface FleetSlots {
  /** page time of the fleet list: fleets sent after it are missing */
  time: number;
  /** false: another member's slots by the fleets they share */
  own: boolean;
  at: number;
  fleets: SlotCount;
  expeditions: SlotCount;
}

/** Slots of the game by the research levels: fleet slots and expedition slots, null when the level is unknown. */
export function slotLimits(research: Record<string, number>): { fleets: number | null; expeditions: number | null } {
  const computer = research[COMPUTER_TECH];
  const astro = research[ASTROPHYSICS];
  return { fleets: computer == null ? null : 1 + computer, expeditions: astro == null ? null : Math.floor(Math.sqrt(astro)) };
}

/** Taken and free slots at `at` from the member's flights and research. */
export function slotsAt(flights: { time: number; flights: Flight[] }, research: Record<string, number>, at: number, own = true): FleetSlots {
  const limits = slotLimits(research);
  const count = (list: Flight[], max: number | null): SlotCount => {
    const ends = list.filter((f) => f.end > at).map((f) => f.end).sort((a, b) => a - b);
    return { used: ends.length, max, next: ends[0] ?? null, ends };
  };
  const counted = flights.flights.filter((f) => f.mission !== MISSILE_MISSION);
  return {
    time: flights.time,
    own,
    at,
    fleets: count(counted, limits.fleets),
    expeditions: count(counted.filter((f) => f.mission === EXPEDITION_MISSION), limits.expeditions),
  };
}

/**
 * The member's slots now by their newest fleet list as the viewer sees it (`sharedFleets`) and their research, null
 * without a fleet list.
 */
export function memberSlots(db: DB, ctx: GroupContext, userId: number, list: { time: number; data: StoredFleet[] } | null): FleetSlots | null {
  const flights = memberFlights(db, ctx.groupId, userId, list);
  return flights ? slotsAt(flights, buildingsState(db, ctx, userId).research, ctx.now, userId === ctx.user.id) : null;
}
