/**
 * Fleet save: keep a fleet in the air (or parked elsewhere) while its owner is offline or an attack lands. Timing like
 * the game: `flightTimes` (floored timestamps), the fuel of ShowFleetStep3Page (charged once for there and back) and
 * MissionCaseStay (a deploy gets half of it back on arrival), recalls like FleetFunctions::sendFleetBack.
 */
import { distance, fleetConsumption, flightDuration, flightTimes, recallFor, slowestShip, SPEED_PERCENTS, type Coords, type Drives, type Fleet, type Universe } from './flight.js';
import type { ShipCatalog } from './ships.js';

/** Ships that make the recycling mission available (the game's ship type `recycler`). */
export const RECYCLERS = [209];

/**
 * Where the fleet can go: an own planet or moon, or the debris field of an occupied position (the game offers recycling
 * there with a recycler in the fleet, also when the field is empty).
 */
export interface SaveTarget {
  coords: Coords;
  type: 'planet' | 'moon' | 'debris';
  name?: string | null;
}

/**
 * `deploy`: one way, the fleet stays at the target (rest = arrival). `transport`: there and back home (rest = landing
 * home; a transport to an own planet unloads and returns). `recall`: deploy far away and recall it so it lands back
 * home at the wanted time (needs the owner online at the recall). `harvest`: recycling at a debris field and back home
 * (needs a recycler in the fleet).
 */
export type SaveKind = 'deploy' | 'transport' | 'recall' | 'harvest';

export interface FleetSaveOption {
  kind: SaveKind;
  target: SaveTarget;
  /** speed in percent */
  speed: number;
  /** one-way flight seconds (float, like the game) */
  duration: number;
  departure: number;
  arrival: number;
  /** recall only: when to recall the fleet */
  recall: number | null;
  /** when the fleet is at rest again (deploy: arrival, transport, harvest and recall: home) */
  rest: number;
  /** seconds after the wanted time (`rest - back`, ≥ 0) */
  late: number;
  /** deuterium needed at the start (also takes cargo space) */
  fuel: number;
  /** deuterium used in the end (a deploy gets half of the fuel back) */
  cost: number;
}

export interface FleetSaveInput {
  universe: Universe;
  catalog: ShipCatalog;
  drives: Drives;
  from: SaveTarget;
  fleet: Fleet;
  /** earliest departure (now) */
  now: number;
  /** latest departure (the owner goes offline, the attack lands) */
  latest: number;
  /** the fleet must not be at rest before this time (wake-up, after the impact) */
  back: number;
  targets: SaveTarget[];
  kinds?: SaveKind[];
  speeds?: readonly number[];
}

const same = (a: SaveTarget, b: SaveTarget) => a.type === b.type && a.coords.every((v, i) => v === b.coords[i]);

/**
 * Fleet save options for one fleet, the most fitting first: rest as close as possible after `back`, then the least
 * deuterium. Departures are as late as needed to land at `back` (never before `now`, never after `latest`); options
 * that come to rest before `back` are left out. Recalls go to the farthest target at full speed.
 */
export function fleetSaveOptions(input: FleetSaveInput): FleetSaveOption[] {
  const { universe: u, catalog, drives, from, fleet, now, latest, back } = input;
  const kinds = input.kinds ?? ['deploy', 'transport'];
  const speeds = input.speeds ?? SPEED_PERCENTS;
  const slowest = slowestShip(fleet, drives, catalog);
  if (!slowest || slowest.speed <= 0 || latest < now) return [];
  const out: FleetSaveOption[] = [];
  const fuelOf = (duration: number, dist: number) => fleetConsumption(u, fleet, duration, dist, drives, 1, catalog);
  const recyclers = RECYCLERS.some((id) => (fleet[id] ?? 0) > 0);
  for (const target of input.targets) {
    if (same(target, from)) continue;
    const dist = distance(u, from.coords, target.coords);
    for (const kind of kinds) {
      if (kind === 'recall') continue;
      // recycling only at debris fields and with a recycler, the other missions only to own bodies
      if ((kind === 'harvest') !== (target.type === 'debris') || (kind === 'harvest' && !recyclers)) continue;
      for (const speed of speeds) {
        const duration = flightDuration(u, dist, slowest.speed, speed);
        const span = (start: number) => {
          const t = flightTimes(start, duration);
          return (kind === 'deploy' ? t.arrival : t.home) - start;
        };
        // as late as possible so that it rests at `back`, but between now and the latest departure
        const departure = Math.min(latest, Math.max(now, back - span(back)));
        const t = flightTimes(departure, duration);
        const rest = kind === 'deploy' ? t.arrival : t.home;
        if (rest < back) continue;
        const fuel = fuelOf(duration, dist);
        out.push({
          kind, target, speed, duration, departure, arrival: t.arrival, recall: null, rest, late: rest - back, fuel,
          cost: kind === 'deploy' ? fuel - Math.floor(fuel / 2) : fuel,
        });
      }
    }
  }
  if (kinds.includes('recall')) {
    // the farthest target at full speed: the longest outbound flight leaves the most room for the recall
    let far: { target: SaveTarget; dist: number } | null = null;
    for (const target of input.targets) {
      if (same(target, from) || target.type === 'debris') continue;
      const dist = distance(u, from.coords, target.coords);
      if (!far || dist > far.dist) far = { target, dist };
    }
    if (far) {
      const duration = flightDuration(u, far.dist, slowest.speed, 100);
      const departure = now;
      const t = flightTimes(departure, duration);
      const r = recallFor(back, t);
      if (r.recall != null) {
        const fuel = fuelOf(duration, far.dist);
        out.push({
          kind: 'recall', target: far.target, speed: 100, duration, departure, arrival: t.arrival, recall: r.recall, rest: r.home,
          late: r.home - back, fuel, cost: fuel,
        });
      }
    }
  }
  return out.sort((a, b) => a.late - b.late || a.cost - b.cost || b.speed - a.speed);
}
