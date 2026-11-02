/**
 * Engine abilities of the running game that install.sql does not have. The combat values of the later ships are
 * defaults of the unit catalog (`@pr0hub/core/units`, `liveUnits.ts`).
 */

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
