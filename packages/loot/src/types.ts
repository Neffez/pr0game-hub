/** Metal, crystal, deuterium. */
export interface Res {
  m: number;
  k: number;
  d: number;
}

export type ResKey = keyof Res;
export const RES_KEYS: readonly ResKey[] = ['m', 'k', 'd'];

/** Ship id -> amount. */
export type Ships = Record<number, number>;

/** One ACS participant, whose costs are covered before the profit is split. */
export interface Participant {
  id: string;
  name: string;
  /** deuterium of the attack flights (all battles) */
  flightDeut?: number;
  /** deuterium of the own recycler flights */
  recDeut?: number;
  /** interplanetary missiles fired on the target (costs of element 503) */
  missiles?: number;
  /** any other costs */
  extra?: Partial<Res>;
}

/**
 * Recycles for the participants without being one: keeps `keepPct` % of what they recycled (game rule: at most 20 %),
 * their recycler deuterium is not refunded on top.
 */
export interface Helper {
  id: string;
  name: string;
  keepPct: number;
}

/** A participant's fleet in one battle, as the battle report lists it. */
export interface BattleFleet {
  participant: string;
  start: Ships;
  end: Ships;
  /** resources the fleet carried already (reduce its free cargo space) */
  carried?: Partial<Res>;
  /** loot this fleet brought home, when known (wins over the share computed from the cargo space) */
  loot?: Res;
}

export interface Battle {
  /** epoch seconds, for the 24 h deadline */
  time?: number | null;
  /** loot of all attackers together */
  loot: Res;
  fleets: BattleFleet[];
}

/** Debris collected by a participant or helper. */
export interface Recycling {
  by: string;
  m: number;
  k: number;
}

export type SplitMode = 'equal' | 'investment';

export interface Settings {
  /** profit split: equal shares, or by the value of the ships sent */
  mode: SplitMode;
  /** market rates as the game gives them: metal and crystal per deuterium (`d` is 1) */
  rates: Res;
  /** reference market rates (in-game), conversions outside 75-125 % of them are flagged */
  refRates?: Res | null;
  /** a shortage of deuterium is made up for in metal by this share, the rest in crystal (0..1) */
  deficitMetalShare: number;
  /** ship used for the transfers (202 or 203) */
  cargoShip: number;
}

export interface SettlementInput {
  participants: Participant[];
  helpers: Helper[];
  battles: Battle[];
  recycling: Recycling[];
  settings: Settings;
}

export interface Transfer {
  from: string;
  to: string;
  res: Res;
  /** cargo ships of `settings.cargoShip` needed */
  ships: number;
}

export interface PersonResult {
  id: string;
  name: string;
  role: 'participant' | 'helper';
  /** loot per battle (participants) */
  loot: Res[];
  recycled: Res;
  /** what the person holds now: loot + recycling */
  holds: Res;
  /** costs to cover (participants) or the helper's part (kept share of the recycling) */
  costs: Res;
  /** value of the ships sent in all battles (resources, as points * 1000) */
  invested: number;
  /** share of the profit (0..1, helpers 0) */
  share: number;
  /** costs covered, in kind or converted */
  covered: Res;
  profit: Res;
  /** covered + profit */
  entitled: Res;
  /** entitled - holds: positive = gets, negative = sends */
  balance: Res;
}

export type SettlementWarning = 'too_many_participants' | 'unknown_person' | 'costs_not_covered' | 'rates_out_of_range';

export interface SettlementResult {
  people: PersonResult[];
  /** loot of all battles */
  loot: Res;
  recycled: Res;
  /** everything collected: loot + recycling */
  pot: Res;
  /** costs of all participants and helpers */
  costs: Res;
  /** profit split among the participants */
  profit: Res;
  /** share of the participants' costs covered (1 = fully) */
  coverage: number;
  /** values in deuterium at the given rates */
  value: { pot: number; costs: number; profit: number };
  /** suggested transfers, few flights */
  transfers: Transfer[];
  /** epoch seconds: 24 h after the last battle (game rule for sharing ACS loot), null without battle times */
  deadline: number | null;
  /** resources whose rate is outside 75-125 % of the reference rate */
  rateWarnings: ResKey[];
  warnings: SettlementWarning[];
}
