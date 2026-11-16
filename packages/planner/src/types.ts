/**
 * A build order: per planet of the hub (key `g:s:p:type`) an ordered list of steps, plus the levels it starts from.
 * A step means "+1 level" (building, research) or "+count units" (ship, defense); its target level is derived from
 * the base and the steps before it, so reordering renumbers the levels.
 */

export type StepKind = 'building' | 'research' | 'ship' | 'defense' | 'prod' | 'transport';

/** Production settings step (pr0plan `SET_PROD`). */
export interface ProdSettings {
  /** producer id (1, 2, 3) -> 0 … 1 */
  factors: Record<string, number>;
  /** wait for the planet's build slot, the research, the shipyard to be free first */
  awaitBuilding: boolean;
  awaitResearch: boolean;
  awaitShipyard: boolean;
  /** seconds the planet's list waits afterwards */
  wait: number;
}

/** What a transport step does at the target: unload and fly home, stay, or found the planned planet. */
export type TransportMission = 'transport' | 'deploy' | 'colonize';

/**
 * Transport step (pr0plan `TRANSPORT`, or added in the hub): resources leave the planet and land on the target after
 * the flight. With `ships` the flight time, the deuterium for the flight and the cargo space are calculated from the
 * coordinates, the drives researched at the departure and the universe's settings; without them (or without
 * coordinates of both planets) `flight` counts. The ships themselves are not tracked.
 */
export interface TransportSettings {
  /** hub planet key of the target, null: the resources just leave */
  target: string | null;
  /** 901-903; ignored with `all` */
  resources: Record<string, number>;
  /** flight time in seconds when it cannot be calculated */
  flight: number;
  /** default `transport`; `colonize` to a planned planet founds it at the arrival */
  mission?: TransportMission;
  /** ship id -> amount flying */
  ships?: Record<string, number>;
  /** speed in percent (10 … 100 in steps of 10), default 100 */
  speed?: number;
  /** load everything that is on the planet at the departure (metal, crystal, deuterium in this order) up to the cargo space */
  all?: boolean;
  /** earliest departure (epoch seconds) */
  notBefore?: number;
  /** wanted arrival (epoch seconds): the fleet leaves a flight time before it, later when the resources are missing */
  arriveAt?: number;
}

/** A planet planned by hand or from a pr0plan file that the hub has not synced yet (key `0:0:<n>:planet`). */
export interface PlannedPlanet {
  name?: string;
  /** where it will be: flight times to and from it, and the synced planet it is assigned to once that exists */
  coords?: { g: number; s: number; p: number };
  /** max temperature (production of deuterium and satellites) */
  temp?: number;
}

export interface Step {
  /** stable id (reordering, done flags, notifications) */
  id: string;
  kind: StepKind;
  /** game element id of a building, research, ship or defense */
  element?: number;
  /** units of a ship or defense step */
  count?: number;
  prod?: ProdSettings;
  transport?: TransportSettings;
  /** skipped like a deactivated action in pr0plan */
  deactivated?: boolean;
  /** checked off by hand */
  done?: boolean;
}

/** Levels the build order starts from: building levels and unit counts per hub planet, research of the account. */
export interface Base {
  planets: Record<string, Record<string, number>>;
  research: Record<string, number>;
}

export interface BuildOrder {
  base: Base;
  /** hub planet key -> steps in order */
  planets: Record<string, Step[]>;
  /** details of the planned planets (keys `0:0:<n>:planet` of `planets`) */
  planned?: Record<string, PlannedPlanet>;
}
