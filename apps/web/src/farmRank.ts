/**
 * Farm finder ranking: how inactive a target's player is, how strong the target is against the own fleet, and the
 * default order from both (inactive and weak targets first, then loot per flight hour).
 */
import type { Schema } from './apiTypes';

type Strength = Schema<'FarmTarget'>['strength'];
type Inactivity = Schema<'FarmTarget'>['inactivity'];
export type SimOutcome = NonNullable<Schema<'FarmSimulation'>['results'][number]['outcome']>;

/**
 * Defense points count twice. Simulations on the game's engine (same research on both sides; cruisers and
 * battleships, battleships and battlecruisers, light fighters, bombers against early, mid and late defense mixes, at
 * 20k and 200k points) gave: what a fleet beats with the losses of a fleet of 30 % of its points, it beats as defense
 * at 10-31 % of its points, median 15 %. Above that the attacker loses a quarter of the fleet or more and still
 * does not win: losses without loot.
 */
export const DEFENSE_WEIGHT = 2;
/** Rule of thumb: a target up to 30 % of the own fleet points is won with hardly any losses and pays best. */
export const WEAK_SHARE = 0.3;
/** A fleet standing on a planet of a player inactive at least this long is worth destroying (debris field). */
export const STANDING_FLEET_HOURS = 12;
/** A simulation counts as won when the attacker wins at least this share of the runs. */
export const SIM_WIN = 0.95;
/**
 * An attack is only worth it with a clear gain: the ships lost may cost at most this share of what comes in (loot and
 * debris field), otherwise the target counts as strong even when the profit is barely positive.
 */
export const SIM_MAX_LOSS = 0.25;

export type RiskTier = 'safe' | 'weak' | 'unknown' | 'strong';
/** Higher is better in the default order. */
const TIER_RANK: Record<RiskTier, number> = { safe: 3, weak: 2, unknown: 1, strong: 0 };

/** Fleet plus weighted defense; `known`: both sides are known (from a report or the statistics). */
export function strengthOf(s: Strength): { points: number; known: boolean; estimated: boolean } {
  return {
    points: (s.fleet ?? 0) + DEFENSE_WEIGHT * (s.defense ?? 0),
    known: s.fleet != null && s.defense != null,
    estimated: s.fleetFrom === 'stats' || s.defenseFrom === 'stats',
  };
}

/** Strength as a share of the own fleet points, null when the own fleet is unknown or empty. */
export function shareOf(s: Strength, own: number | null): number | null {
  return own && own > 0 ? strengthOf(s).points / own : null;
}

/** The simulated attack is won for sure and brings a clear gain (losses at most a quarter of loot plus debris). */
export function clearGain(sim: SimOutcome): boolean {
  const lost = sim.lost.metal + sim.lost.crystal + sim.lost.deuterium;
  const gain = sim.loot.metal + sim.loot.crystal + sim.loot.deuterium + sim.debris.metal + sim.debris.crystal;
  return sim.wins >= SIM_WIN && sim.profit > 0 && lost <= SIM_MAX_LOSS * gain;
}

/**
 * Risk of a target: `safe` nothing that fights, `weak` up to 30 % of the own fleet, `strong` above, `unknown` when a
 * side or the own fleet is unknown. A simulation of the own fleet against it decides when there is one: only a sure
 * win with a clear gain is `weak` (or `safe`), anything else `strong`.
 */
export function riskTier(s: Strength, own: number | null, sim?: SimOutcome | null): RiskTier {
  const { points, known } = strengthOf(s);
  if (sim) return !clearGain(sim) ? 'strong' : known && points === 0 ? 'safe' : 'weak';
  if (known && points === 0) return 'safe';
  const share = shareOf(s, own);
  if (share == null) return 'unknown';
  if (share > WEAK_SHARE) return 'strong';
  return known ? 'weak' : 'unknown';
}

/** 4 flagged by the game, 3 inactive, 2 likely, 1 possibly inactive, 0 active or unknown. */
export function inactivityTier(i: Inactivity): number {
  if (!i) return 0;
  if (i.status) return 4;
  return i.level === 'inactive' ? 3 : i.level === 'likely' ? 2 : i.level === 'possible' ? 1 : 0;
}

/** Hours the player is probably inactive (flagged by the game without a time: at least 7 days), null when active. */
export function inactiveHours(i: Inactivity, now: number): number | null {
  if (!i || i.level === 'active' || i.level === 'unknown') return null;
  if (i.since == null) return i.status ? 7 * 24 : null;
  return Math.max(0, now - i.since) / 3600;
}

/** A fleet seen in a report on a planet of a player inactive for at least 12 hours. */
export function standingFleet(s: Strength, i: Inactivity, now: number): boolean {
  const hours = inactiveHours(i, now);
  return s.fleetFrom === 'report' && (s.fleet ?? 0) > 0 && hours != null && hours >= STANDING_FLEET_HOURS;
}

/** Below this the loot per flight hour stays the tie breaker of a tier (the tiers sit above it). */
const SPAN = 1e13;
const capped = (v: number | null) => Math.min(Math.max(v ?? 0, 0), SPAN - 1);

/** Default order: inactivity tier, then risk tier, then loot per flight hour (descending). */
export function recommendedValue(i: Inactivity, tier: RiskTier, perFlightHour: number | null): number {
  return (inactivityTier(i) * 4 + TIER_RANK[tier]) * SPAN + capped(perFlightHour);
}

/** Targets the own fleet beats (safe or weak) first, then loot per flight hour. */
export function beatableValue(tier: RiskTier, perFlightHour: number | null): number {
  return (tier === 'safe' || tier === 'weak' ? 1 : 0) * SPAN + capped(perFlightHour);
}

/** Debris of a fleet: standing fleets first, then the size of the field. */
export function debrisValue(debris: { 901: number; 902: number } | null, standing: boolean): number | null {
  if (!debris) return null;
  const sum = debris[901] + debris[902];
  if (sum <= 0) return null;
  return (standing ? SPAN : 0) + capped(sum);
}
