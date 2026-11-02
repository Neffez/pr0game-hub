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

/** Transport step (pr0plan `TRANSPORT`): resources leave the planet and land on the target after the flight. */
export interface TransportSettings {
  /** hub planet key of the target, null: the resources just leave */
  target: string | null;
  /** 901-903 */
  resources: Record<string, number>;
  /** flight time in seconds */
  flight: number;
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
}
