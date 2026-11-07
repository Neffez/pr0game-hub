/**
 * Spy priority (backlog B-2): which farm targets are worth a probe now. A target's need for a new report grows with
 * the age of its report and with signs that the report no longer holds (fleet, defense or other points gained since,
 * a battle at the planet since, no buildings or no risk known); the priority is that need times the loot expected now.
 */
export type SpyReason = 'old' | 'fleet' | 'defense' | 'points' | 'battle' | 'noLevels' | 'unknownRisk';

export interface SpyInput {
  lootSum: number;
  reportTime: number;
  /** buildings known (production since the report can be projected) */
  levels: boolean;
  fleetKnown: boolean;
  defenseKnown: boolean;
  /** points gained since the report per category (1 total, 2 fleet, 5 defense) */
  changes: Record<1 | 2 | 5, number | null>;
  lastBattle: number | null;
}

/** Hours after which half of a report's certainty is gone (exponential). */
export const SPY_TAU_HOURS = 12;
export const SPY_WEIGHTS: Record<Exclude<SpyReason, 'old'>, number> = { fleet: 0.6, defense: 0.6, points: 0.3, battle: 0.3, noLevels: 0.4, unknownRisk: 0.3 };

export function spyPriority(x: SpyInput, now: number): { score: number; need: number; reasons: SpyReason[] } {
  const ageH = Math.max(0, now - x.reportTime) / 3600;
  let need = 1 - Math.exp(-ageH / SPY_TAU_HOURS);
  const reasons: SpyReason[] = [];
  if (ageH >= SPY_TAU_HOURS) reasons.push('old');
  const add = (r: Exclude<SpyReason, 'old'>, on: boolean) => {
    if (!on) return;
    reasons.push(r);
    need += SPY_WEIGHTS[r];
  };
  const fleet = (x.changes[2] ?? 0) > 0;
  const defense = (x.changes[5] ?? 0) > 0;
  add('fleet', fleet);
  add('defense', defense);
  // other points (buildings, research): the planet grew, a new report shows the new mines
  add('points', !fleet && !defense && (x.changes[1] ?? 0) > 0);
  add('battle', x.lastBattle != null && x.lastBattle > x.reportTime);
  add('noLevels', !x.levels);
  add('unknownRisk', !x.fleetKnown || !x.defenseKnown);
  return { score: Math.round(x.lootSum * need), need, reasons };
}
