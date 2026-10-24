import type { Coords, Lang, LocalDateTime } from './util.js';

export type PlanetType = 'planet' | 'moon';

/** 1 total, 2 fleet, 3 research, 4 buildings, 5 defense, 6 honor points (game `type` parameter). */
export type StatsType = 1 | 2 | 3 | 4 | 5 | 6;
export const STATS_TYPES: Record<StatsType, string> = {
  1: 'total',
  2: 'fleet',
  3: 'research',
  4: 'buildings',
  5: 'defense',
  6: 'honor',
};

/** Normalized status flags (language independent). */
export type PlayerStatus = 'inactive' | 'longinactive' | 'vacation' | 'banned' | 'noob' | 'strong';

export interface StatsRow {
  rank: number;
  /** positive = climbed. Only available from HTML (tooltip). */
  rankChange: number | null;
  ingameId: number | null;
  name: string;
  status: PlayerStatus[];
  allyId: number | null;
  allyName: string | null;
  /** may be negative for honor points */
  points: number;
  /** honor title shown in front of the name in the honor points ranking (e.g. "Groß-Imperator") */
  title?: string | null;
  /** alliance ranking: number of members */
  members?: number | null;
}

export interface StatsRecord {
  kind: 'stats';
  who: 'player' | 'alliance';
  /** null when it could not be determined (plain text) - caller must supply it. */
  type: StatsType | null;
  statTime: LocalDateTime | null;
  rows: StatsRow[];
}

export interface SpyReportRecord {
  kind: 'spy';
  msgId: number | null;
  coords: Coords;
  planetType: PlanetType;
  planetName: string;
  playerName: string;
  reportTime: LocalDateTime | null;
  /** class -> (element id -> amount). Presence of a class means the section was visible. */
  sections: Record<number, Record<number, number>>;
  destroyChance: number | null;
  probesDestroyed: boolean;
}

export interface BattleRecord {
  kind: 'battle';
  msgId: number | null;
  reportId: string | null;
  time: LocalDateTime | null;
  coords: Coords;
  planetType: PlanetType;
  /** from the reader's perspective (css class on the title) */
  outcome: 'win' | 'lose' | 'draw' | null;
  lostAttacker: number;
  lostDefender: number;
  loot: { metal: number; crystal: number; deuterium: number };
  debris: { metal: number; crystal: number };
}

export type ExpoEventType = 'Res' | 'Ships' | 'Pirates' | 'Aliens' | 'Fast' | 'Slow' | 'BlackHole' | 'Nothing';
export type ExpoSize = 'Small' | 'Medium' | 'Big' | 'None';
/** Depletion hint from the probe logbook. 'none' = probe present and no hint (<=10 expos, no depletion). */
export type ExpoDepletion = 'none' | 'few' | 'medium' | 'many' | null;

export interface ExpeditionRecord {
  kind: 'expedition';
  msgId: number | null;
  time: LocalDateTime | null;
  coords: Coords | null;
  event: ExpoEventType;
  size: ExpoSize;
  factor: number | null;
  depletion: ExpoDepletion;
  foundResources: Record<number, number>;
  foundShips: Record<number, number>;
}

export interface HostileSpyRecord {
  kind: 'hostileSpy';
  msgId: number | null;
  time: LocalDateTime | null;
  fromPlanetName: string;
  fromPlayerName: string;
  fromCoords: Coords;
  fromType: PlanetType;
  targetPlanetName: string;
  targetCoords: Coords;
  targetType: PlanetType;
}

/** Recycling report (transport message): collected debris and what the field held in total. */
export interface RecycleRecord {
  kind: 'recycle';
  msgId: number | null;
  time: LocalDateTime | null;
  coords: Coords;
  metal: number;
  crystal: number;
  /** debris field before collecting */
  totalMetal: number;
  totalCrystal: number;
}

/** Sender or recipient of a player message: name, plus the main planet when the game shows it. */
export interface MessageParty {
  name: string;
  coords: Coords | null;
}

/** Message between players ("Spieler Nachrichten"), received or sent; the game keeps a copy for both sides. */
export interface PlayerMessageRecord {
  kind: 'playerMessage';
  msgId: number | null;
  time: LocalDateTime | null;
  from: MessageParty;
  to: MessageParty[];
  subject: string;
  /** plain text, line breaks kept */
  body: string;
  /**
   * Conversation in the mailbox of the one who copied it (`u_<id of its first message>`), from the reply link; the other
   * side's copy has another id. HTML only.
   */
  thread: string | null;
  /** in-game id of the conversation partner of the one who copied it (reply link), also on their own sent messages */
  partnerId: number | null;
}

export interface GalaxyRow {
  position: number;
  planetName: string;
  moon: boolean;
  /** moon name (alt text of the moon image in the galaxy HTML) */
  moonName?: string | null;
  destroyed: boolean;
  playerId: number | null;
  playerName: string | null;
  status: PlayerStatus[];
  allyId: number | null;
  allyTag: string | null;
  /** universe.json carries the alliance name instead of the tag */
  allyName?: string | null;
  debris: { metal: string; crystal: string } | null;
}

export interface GalaxyRecord {
  kind: 'galaxy';
  g: number;
  s: number;
  rows: GalaxyRow[];
  /** when the system was seen (epoch seconds, universe.json); default: time of the paste */
  seenAt?: number;
}

export interface EmpirePlanet {
  name: string;
  coords: Coords;
  /** moons share the coordinates of their planet */
  type: PlanetType;
  /** element id -> amount / level */
  values: Record<number, number>;
  /** max temperature (°C) */
  temp?: number;
  fields?: { used: number; max: number };
  /** resources 901-903 and net energy 911 at page time */
  resources?: Record<number, number>;
  /** production per hour (only when "Produktion /h" is enabled on the empire page) */
  perHour?: Record<number, number>;
  /** building in the queue (⬆): element and target level */
  building?: { id: number; level: number } | null;
  /** ships/defense in the shipyard queue (⬆): element -> amount */
  shipyard?: Record<number, number>;
}

export interface EmpireRecord {
  kind: 'empire';
  planets: EmpirePlanet[];
  /** research levels (account wide) */
  research: Record<number, number>;
  /** research in progress (⬆) */
  researchQueue?: { id: number; level: number; coords: Coords | null } | null;
  /** resources on fleets in flight (✈), 901-903 */
  flying?: Record<number, number>;
  /** ships on fleets in flight (✈): element -> amount (missing in records parsed before it was read) */
  flyingShips?: Record<number, number>;
  /** server time of the page (local game time) */
  pageTime?: string | null;
  /** planet selected in the game header with its storage capacity (resource bar) */
  active?: { coords: Coords; type: PlanetType; storage: Record<number, number> } | null;
}

/** Building on the buildings page of one planet/moon: level, cost and build time of the next level. */
export interface BuildingsEntry {
  id: number;
  level: number;
  /** cost of the next level (after the queue) as the game shows it (catch-up bonus included), 901-903 and 911 */
  cost: Record<number, number>;
  /** build time of the next level in seconds */
  time: number | null;
  /** "Busy": research (TechnoDome, lab) or the shipyard (nanite factory, shipyard) is working */
  busy?: boolean;
}

/** Game buildings page (page=buildings) of the selected planet/moon. */
export interface BuildingsRecord {
  kind: 'buildings';
  coords: Coords;
  type: PlanetType;
  pageTime: string | null;
  /** resource bar: amounts, storage capacity and production per hour (basic income included) of 901-903 */
  resources: Record<number, number>;
  storage: Record<number, number>;
  perHour: Record<number, number>;
  /** catch-up bonus in percent as shown (rounded to 2 decimals), null if the universe has none */
  catchUp: number | null;
  /** used and maximum fields of the planet/moon */
  fields?: { used: number; max: number } | null;
  buildings: BuildingsEntry[];
  /** build queue, first entry in progress; `end` epoch seconds when shown */
  queue: { id: number; level: number; destroy: boolean; end: number | null }[];
}

/** Game research page (page=research) on the selected planet: levels are account wide, costs and time this planet's. */
export interface ResearchRecord {
  kind: 'research';
  coords: Coords;
  type: PlanetType;
  pageTime: string | null;
  resources: Record<number, number>;
  storage: Record<number, number>;
  perHour: Record<number, number>;
  catchUp: number | null;
  /** a research lab or TechnoDome is being built: research is blocked */
  labBusy: boolean;
  /** the planet has no research lab */
  noLab: boolean;
  /** research levels with cost and time of the next level (`busy` unused) */
  research: BuildingsEntry[];
  /** account wide research queue, first in progress; `end` epoch seconds */
  queue: { id: number; level: number; end: number | null }[];
  /**
   * own levels the requirement lines show ("Forschungslabor (Stufe 10/5)"): the planet's lab and research the page
   * leaves out (the game's "hide useless")
   */
  known?: Record<number, number>;
}

export interface OverviewQueue {
  kind: 'building' | 'research' | 'shipyard';
  coords: Coords;
  type: PlanetType;
  /** element id; level = target level, for the shipyard the amount of the current batch */
  id: number;
  level: number;
  destroy: boolean;
  /** remaining seconds at page time */
  seconds: number;
}

/** Game overview page: what is being built where and how long it still takes. */
export interface OverviewRecord {
  kind: 'overview';
  pageTime: string | null;
  current: { coords: Coords; type: PlanetType } | null;
  queues: OverviewQueue[];
  /** catch-up bonus in percent (cost and build time reduction), null if the universe has none */
  catchUp: number | null;
}

/** Start or target of a fleet movement; `type` null for a plain position (expedition, colonization). */
export interface FleetBody {
  coords: Coords;
  type: PlanetType | 'debris' | null;
  name: string | null;
}

/** One event of the overview's fleet list. */
export interface FleetMovement {
  /**
   * own fleet, hostile fleet heading for one of the own planets (attack, ACS attack, spying, …), or another fleet
   * (peaceful, or an ACS fleet attacking someone else)
   */
  owner: 'own' | 'hostile' | 'foreign';
  /** owner of a foreign fleet when the text names it */
  player: string | null;
  /** game mission id (1 attack, 3 transport, 4 deploy, 15 expedition …), null if unknown */
  mission: number | null;
  /** mission as shown in the game */
  missionName: string;
  /** flying to the target, flying back, or holding at the target (expedition, ACS defend) */
  phase: 'out' | 'return' | 'hold';
  /** where the fleet comes from and where this flight ends (a returning fleet flies from its target home) */
  from: FleetBody;
  to: FleetBody | null;
  /** element id -> amount (empty when the game doesn't show them) */
  ships: Record<number, number>;
  /** cargo 901-903 when shown */
  resources: Record<number, number> | null;
  /** remaining seconds at page time */
  seconds: number;
  /** arrival as shown in the copied text ("HH:MM:SS", game time), refines `seconds` */
  clock: string | null;
  /**
   * ACS: the fleets of one ACS share one event (one timer) in the game; they get the same number here, the first one
   * is the lead (mission attack). null for a fleet on its own.
   */
  acs: number | null;
}

/** Fleet movements of the game overview ("Ereignisse"), also when only that list was copied. */
export interface FleetsRecord {
  kind: 'fleets';
  pageTime: string | null;
  fleets: FleetMovement[];
}

export interface BattleHallEntry {
  reportId: string;
  rank: number;
  attackers: string[];
  defenders: string[];
  winner: 'attacker' | 'defender' | 'draw' | null;
  time: LocalDateTime | null;
  units: number;
}

/** Battle Hall page: up to 100 top battle reports of the selected time frame. */
export interface BattleHallRecord {
  kind: 'battleHall';
  /** 0 all, 1 day, 2 week, 3 month */
  timeframe: number | null;
  entries: BattleHallEntry[];
}

export interface CombatFleet {
  side: 'attacker' | 'defender';
  name: string;
  /** element id -> amount before the battle / after the last round */
  start: Record<number, number>;
  end: Record<number, number>;
}

/** Battle report page (compact: participants, fleets before/after, outcome). */
export interface CombatReportRecord {
  kind: 'combatReport';
  reportId: string | null;
  time: LocalDateTime | null;
  winner: 'attacker' | 'defender' | 'draw';
  rounds: number;
  lost: { attacker: number; defender: number };
  debris: { metal: number; crystal: number };
  fleets: CombatFleet[];
}

export type HubRecord =
  | StatsRecord
  | SpyReportRecord
  | BattleRecord
  | ExpeditionRecord
  | HostileSpyRecord
  | RecycleRecord
  | PlayerMessageRecord
  | GalaxyRecord
  | EmpireRecord
  | OverviewRecord
  | BuildingsRecord
  | ResearchRecord
  | FleetsRecord
  | BattleHallRecord
  | CombatReportRecord;

export type PageType = 'stats' | 'messages' | 'galaxy' | 'empire' | 'overview' | 'buildings' | 'research' | 'fleets' | 'phalanx' | 'battleHall' | 'combatReport' | 'unknown';

export interface ParseResult {
  pageType: PageType;
  lang: Lang;
  source: 'html' | 'text' | 'json';
  records: HubRecord[];
  /** stable codes, translated by the web app (e.g. `stats_category_unknown`) */
  warnings: string[];
}
