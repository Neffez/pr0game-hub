import { describe, expect, it } from 'vitest';
import type { FarmTarget } from '../src/apiTypes';
import { beatableValue, debrisValue, FLEET_HALF_LIFE_HOURS, fleetFit, fleetFreshness, fleetPriority, inactiveHours, inactivityTier, recommendedValue, riskTier, shareOf, standingFleet, strengthOf, type SimOutcome } from '../src/farmRank';

const now = 1_000_000;
type Strength = FarmTarget['strength'];
type Inactivity = FarmTarget['inactivity'];
const strength = (fleet: number | null, defense: number | null, from: 'report' | 'stats' = 'report'): Strength => ({
  fleet, fleetFrom: fleet == null ? null : from, defense, defenseFrom: defense == null ? null : from, grown: false,
});
const inactive = (level: NonNullable<Inactivity>['level'], hours: number | null, status: 'inactive' | null = null): Inactivity => ({
  score: 0, level, since: hours == null ? null : now - hours * 3600, atLeast: false, status, stall: null, lastActive: null, reasons: [],
});
const sim = (wins: number, profit: number, lostShare = 0): SimOutcome => ({
  wins, profit, loot: { metal: 10_000, crystal: 0, deuterium: 0 }, debris: { metal: 0, crystal: 0 }, lost: { metal: lostShare * 100_000, crystal: 0, deuterium: 0 }, lostShare, defenderLost: { metal: 0, crystal: 0, deuterium: 0 },
});

describe('farm ranking', () => {
  it('counts defense twice against the own fleet', () => {
    expect(strengthOf(strength(100, 50))).toEqual({ points: 200, known: true, estimated: false });
    expect(shareOf(strength(100, 50), 1000)).toBe(0.2);
    expect(shareOf(strength(100, 50), null)).toBeNull();
    expect(strengthOf(strength(0, 10, 'stats')).estimated).toBe(true);
  });

  it('tells safe, weak, strong and unknown targets apart', () => {
    expect(riskTier(strength(0, 0), null)).toBe('safe');
    expect(riskTier(strength(100, 100), 1000)).toBe('weak');
    // 100 fleet + 2 × 150 defense = 40 % of the own fleet: acceptable, above 50 % strong
    expect(riskTier(strength(100, 150), 1000)).toBe('acceptable');
    expect(riskTier(strength(100, 250), 1000)).toBe('strong');
    // defense unknown: too strong already by the fleet, otherwise unknown
    expect(riskTier(strength(600, null), 1000)).toBe('strong');
    expect(riskTier(strength(100, null), 1000)).toBe('unknown');
    expect(riskTier(strength(100, 0), null)).toBe('unknown');
  });

  it('lets a simulation decide the risk', () => {
    expect(riskTier(strength(900, 900), 1000, sim(1, 5000))).toBe('weak');
    expect(riskTier(strength(0, 0), 1000, sim(1, 5000))).toBe('safe');
    // by the share of the own fleet lost: up to 10 % weak, 30 % acceptable, 50 % risky
    expect(riskTier(strength(10, 0), 1000, sim(1, 5000, 0.1))).toBe('weak');
    expect(riskTier(strength(10, 0), 1000, sim(1, 5000, 0.2))).toBe('acceptable');
    expect(riskTier(strength(10, 0), 1000, sim(1, 5000, 0.45))).toBe('risky');
    expect(riskTier(strength(10, 0), 1000, sim(1, 5000, 0.6))).toBe('strong');
    // not won in every run, or no profit: strong
    expect(riskTier(strength(10, 0), 1000, sim(0.95, 5000))).toBe('strong');
    expect(riskTier(strength(10, 0), 1000, sim(1, -100))).toBe('strong');
  });

  it('ranks inactive players first, then the risk, then the loot per flight hour', () => {
    expect(inactivityTier(inactive('inactive', null, 'inactive'))).toBe(4);
    expect(inactivityTier(inactive('likely', 30))).toBe(2);
    expect(inactivityTier(null)).toBe(0);
    const topPlayer = recommendedValue(inactive('active', null), 'strong', 5_000_000);
    const sleepyStrong = recommendedValue(inactive('likely', 30), 'strong', 10);
    const sleepyWeak = recommendedValue(inactive('likely', 30), 'weak', 10);
    const sleepyWeakRich = recommendedValue(inactive('likely', 30), 'weak', 20);
    expect([topPlayer, sleepyStrong, sleepyWeak, sleepyWeakRich].sort((a, b) => b - a)).toEqual([sleepyWeakRich, sleepyWeak, sleepyStrong, topPlayer]);
    expect(beatableValue('weak', 1)).toBeGreaterThan(beatableValue('acceptable', 1e9));
    expect(beatableValue('acceptable', 1)).toBeGreaterThan(beatableValue('strong', 1e9));
    expect(recommendedValue(inactive('likely', 30), 'risky', 1e9)).toBeGreaterThan(recommendedValue(inactive('possible', 30), 'safe', 1e9));
  });

  it('marks a fleet standing at a player inactive for 12 hours and more', () => {
    expect(inactiveHours(inactive('likely', 30), now)).toBe(30);
    expect(inactiveHours(inactive('inactive', null, 'inactive'), now)).toBe(7 * 24);
    expect(inactiveHours(inactive('active', 30), now)).toBeNull();
    expect(standingFleet(strength(500, 0), inactive('likely', 13), now)).toBe(true);
    expect(standingFleet(strength(500, 0), inactive('possible', 6), now)).toBe(false);
    expect(standingFleet(strength(500, 0, 'stats'), inactive('likely', 30), now)).toBe(false);
    expect(debrisValue({ 901: 100, 902: 50 }, true)!).toBeGreaterThan(debrisValue({ 901: 1e9, 902: 0 }, false)!);
    expect(debrisValue({ 901: 0, 902: 0 }, true)).toBeNull();
  });

  it('weighs fleet targets by their fit to 30 % of the own fleet and the age of the report', () => {
    expect(fleetFit(0.1, true)).toBe(1);
    expect(fleetFit(0.3, true)).toBe(1);
    expect(fleetFit(0.4, true)).toBeCloseTo(0.65);
    expect(fleetFit(0.5, true)).toBeCloseTo(0.3);
    expect(fleetFit(0.8, true)).toBe(0.05);
    // own fleet unknown, or a side of the target unknown: no full weight
    expect(fleetFit(null, true)).toBe(0.3);
    expect(fleetFit(0.2, false)).toBe(0.3);
    expect(fleetFreshness(FLEET_HALF_LIFE_HOURS, false)).toBe(0.5);
    expect(fleetFreshness(100, true)).toBe(1);
    // a big fleet at 30 % beats a small one at 10 %, a huge one at 80 % loses to both
    const at = (gain: number, share: number) => fleetPriority({ gain, share, known: true, hours: 0, standing: false, sim: null });
    expect(at(300_000, 0.3)).toBeGreaterThan(at(100_000, 0.1));
    expect(at(800_000, 0.8)).toBeLessThan(at(100_000, 0.1));
    // a simulation decides with its profit, a loss ranks last
    expect(fleetPriority({ gain: 1e9, share: 0.2, known: true, hours: 0, standing: false, sim: sim(1, 1234) })).toBe(1234);
    expect(fleetPriority({ gain: 1e9, share: 0.2, known: true, hours: 0, standing: false, sim: sim(0.5, -100) })).toBeLessThan(0);
  });
});
