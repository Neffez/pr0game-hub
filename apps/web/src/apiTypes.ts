/**
 * Response types of hub API endpoints the web app reads, written after the server's routes and `openapi.yaml`
 * (C-02 of the review). Rows keep the server's column names (snake case), aggregates are camel case like the server
 * builds them.
 */
import type { DeckEvent, DeckState } from '@pr0hub/core';
import type { Inactivity } from './components/InactivityBadge.vue';
import type { PointsStall } from './format';

type PlanetType = 'planet' | 'moon';
/** a member that is no longer in the hub (deleted account): no id, no name */
type MemberRef = { user_id: number | null; username: string | null };

// ------------------------------------------------------------------------------------------- GET /{uni}/raids

/** A battle report of a member (`battle_reports` row). */
export interface RaidReport extends MemberRef {
  id: number;
  report_id: string | null;
  time: number | null;
  created_at: number;
  g: number;
  s: number;
  p: number;
  planet_type: PlanetType;
  outcome: string | null;
  lost_attacker: number;
  lost_defender: number;
  loot_metal: number;
  loot_crystal: number;
  loot_deuterium: number;
  debris_metal: number;
  debris_crystal: number;
  /** the full report is in the combat report archive */
  archived: number;
  target_player_name: string | null;
  /** at one of the member's own planets: a defense, not a raid */
  defense: boolean;
}

export interface RaidsPerUser {
  userId: number | null;
  username: string | null;
  raids: number;
  metal: number;
  crystal: number;
  deuterium: number;
  lost: number;
  debris: number;
}

/** A recycling report (`recycle_reports` row). */
export interface RecycleReport extends MemberRef {
  id: number;
  time: number | null;
  created_at: number;
  g: number;
  s: number;
  p: number;
  metal: number;
  crystal: number;
  total_metal: number;
  total_crystal: number;
}

export interface RecyclePerUser {
  userId: number | null;
  username: string | null;
  runs: number;
  metal: number;
  crystal: number;
  /** what the field still held */
  left: number;
}

/** An interplanetary missile impact. */
export interface MissileImpact extends MemberRef {
  id: number;
  time: number | null;
  created_at: number;
  count: number;
  from_g: number;
  from_s: number;
  from_p: number;
  g: number;
  s: number;
  p: number;
  result: string | null;
  intercepted: number | null;
  losses: Record<string, number> | null;
  target_player_name: string | null;
  /** the member was hit, not the attacker */
  defense: boolean;
}

export interface MissilePerUser {
  userId: number | null;
  username: string | null;
  attacks: number;
  fired: number;
  intercepted: number;
  /** missiles of attacks with a known result */
  known: number;
  losses: Record<string, number>;
}

export interface Raids {
  from: number;
  to: number;
  perUser: RaidsPerUser[];
  reports: RaidReport[];
  recyclePerUser: RecyclePerUser[];
  recycling: RecycleReport[];
  missilePerUser: MissilePerUser[];
  missiles: MissileImpact[];
}

// ------------------------------------------------------------------------------------- GET /{uni}/expeditions

/** An expedition result (`expeditions` row, found resources and ships parsed). */
export interface Expedition {
  id: number;
  user_id: number;
  /** `manual:…` for an event counted by hand on the deck tab */
  dedupe_key: string;
  username: string;
  time: number | null;
  created_at: number;
  g: number | null;
  s: number | null;
  p: number | null;
  event: string;
  size: string;
  factor: number | null;
  depletion: string | null;
  found_resources: Record<string, number>;
  found_ships: Record<string, number>;
}

export interface ExpeditionsPerUser {
  userId: number;
  username: string;
  total: number;
  /** count per event key (`Res:Small`, `Nothing`) */
  events: Record<string, number>;
  resources: Record<string, number>;
  ships: Record<string, number>;
}

export interface Expeditions {
  from: number;
  to: number;
  perUser: ExpeditionsPerUser[];
  deckSize: number;
  /** cards per event key in the universe's deck */
  expected: Record<string, number>;
  list: Expedition[];
}

// -------------------------------------------------------------------------------------------- GET /{uni}/deck

export interface Deck {
  userId: number;
  settings: { startTime: number | null; initialDrawn: Record<string, number>; unknownDepletion: number };
  lastEvents: (DeckEvent & { id: number; time: number; manual: number })[];
  state: DeckState;
}

// ------------------------------------------------------------------------------------- GET /{uni}/players/{id}

export interface PlayerScore {
  type: number;
  time: number;
  points: number;
  rank?: number;
}

export interface PlayerPlanet {
  g: number;
  s: number;
  p: number;
  name: string | null;
  has_moon: number;
  moon_name: string | null;
  moon_diameter: number | null;
  updated_at: number;
  last_spy: number | null;
  last_spy_moon: number | null;
}

/** Known from a spy report or, for an alliance member, their empire page. */
export interface Known {
  time: number;
  source: 'spy' | 'empire';
}

export interface PlayerDetails {
  player: {
    id: number;
    ingame_id: number | null;
    name: string;
    alliance_id: number | null;
    status: string[];
    first_seen: number;
    last_seen: number;
    note: string | null;
    ally_name: string | null;
    ally_tag: string | null;
    ally_ingame_id: number | null;
  };
  history: PlayerScore[];
  /** the viewer's own total and fleet points, for comparison */
  ownHistory: PlayerScore[];
  planets: PlayerPlanet[];
  spyReports: { id: number; g: number; s: number; p: number; planet_type: PlanetType; planet_name: string | null; report_time: number; sections: Record<string, Record<string, number>> }[];
  statusLog: { status: string; seen_at: number }[];
  aliases: { name: string; seen_until: number }[];
  research: (Known & { values: Record<string, number> }) | null;
  /** phalanx level per moon `g:s:p` */
  phalanx: Record<string, Known & { level: number }>;
  pointsStall: PointsStall | null;
  inactivity: Inactivity | null;
}
