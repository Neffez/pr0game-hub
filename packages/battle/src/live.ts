/**
 * Combat values of the running game that install.sql does not have (ships added later, abilities of the Rust engine).
 * Source: the in-game unit info pages (attack, shield, rapidfire in percent: shots n = 1 / (1 − p)), given by the
 * project owner. The hull is not listed here: it comes from the costs like for every unit ((metal + crystal) / 10,
 * the info page shows metal + crystal as structure points).
 */

export interface LiveUnit {
  attack?: number;
  shield?: number;
  /** rapidfire of this unit against target id: shots */
  rapidfire?: Record<number, number>;
}

/** Ships missing in install.sql, with their own rapidfire. */
export const LIVE_UNITS: Record<number, LiveUnit> = {
  // Schwerer Kreuzer
  222: { attack: 620, shield: 100, rapidfire: { 202: 3, 203: 2, 204: 9, 205: 2, 206: 2, 210: 5, 212: 5, 225: 3, 401: 15 } },
  // Sturmtransporter
  225: { attack: 50, shield: 90, rapidfire: { 210: 5, 212: 5 } },
  // Optimierter Recycler
  227: { attack: 1, shield: 50, rapidfire: { 210: 5, 212: 5 } },
  // Behemoth
  231: {
    attack: 20000,
    shield: 5000,
    rapidfire: {
      202: 25, 203: 25, 204: 20, 205: 10, 206: 5, 207: 4, 208: 25, 209: 25, 210: 100, 211: 4, 212: 100, 213: 2, 215: 3,
      222: 2, 225: 14, 227: 10, 401: 20, 402: 20, 403: 10, 404: 5, 405: 10,
    },
  },
  // Void Titan: no rapidfire, none against it
  232: { attack: 200000, shield: 50000, rapidfire: {} },
};

/** Rapidfire of older units against the ships above ("Rapidfire von" on their info pages): shooter -> target -> shots. */
export const LIVE_RAPIDFIRE_AGAINST: Record<number, Record<number, number>> = {
  205: { 225: 2 },
  207: { 222: 2 },
  213: { 222: 2 },
  214: { 222: 18, 225: 140, 227: 100 },
  215: { 225: 4 },
};

/**
 * Stun factor per unit: a hit stuns the target for its next shot with chance factor × attack / target hull
 * (Battlerust `do_stun`). The ion cannon has factor 1 (game, 2026-10).
 */
export const LIVE_STUN: Record<number, number> = {
  405: 1,
};

/**
 * Shield domes as "ship shields": they must fall before other units can be hit. A universe setting (not every
 * universe has it, e.g. not U7), so it only applies with `bigShields` in the battle's options.
 */
export const LIVE_BIGSHIELD: number[] = [407, 408];
