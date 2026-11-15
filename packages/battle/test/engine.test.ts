import { describe, expect, it } from 'vitest';
import { chanceMargin, lossMargin, runBattle, simulate, simulateRefined, type BattleSetup } from '../src/index.js';
import { fight, hasEngine } from './wasm.js';

const none = { 109: 0, 110: 0, 111: 0 };

describe.skipIf(!hasEngine)('Battlerust engine (WASM)', () => {
  it('lets a lone light fighter lose against a hundred rocket launchers', () => {
    const setup: BattleSetup = { attackers: [{ units: { 204: 1 }, research: none }], defenders: [{ units: { 401: 100 }, research: none }] };
    const s = simulate(fight, setup, 10);
    expect(s.wins.defender).toBe(1);
    expect(s.attackers[0].lost[204].avg).toBe(1);
    expect(s.attackers[0].lossChance[204]).toBe(1);
    expect(Object.values(s.roundShares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('shows the risk of small battles: two small cargos against a rocket launcher', () => {
    const setup: BattleSetup = { attackers: [{ units: { 202: 2 }, research: none }], defenders: [{ units: { 401: 1 }, research: none }] };
    const s = simulate(fight, setup, 300);
    const chance = s.attackers[0].lossChance[202];
    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThan(1);
    // the average left carries the risk: 2 − lost on average
    expect(s.attackers[0].remaining[202].avg).toBeCloseTo(2 - s.attackers[0].lost[202]?.avg, 10);
  });

  it('refines the loss chances of a small battle beyond the runs asked for', () => {
    const setup: BattleSetup = { attackers: [{ units: { 202: 2, 204: 3 }, research: none }], defenders: [{ units: { 401: 1 }, research: none }] };
    const shares: number[] = [];
    const s = simulateRefined(fight, setup, 20, undefined, { refine: { margin: 0.02, maxRuns: 4000, budgetMs: 60000 }, progress: (p) => shares.push(p) });
    expect(s.runs).toBeGreaterThan(20);
    expect(lossMargin(s)).toBeLessThanOrEqual(0.02);
    expect(s.attackers[0].lossChance[204]).toBeGreaterThan(0);
    expect(s.attackers[0].lossChance[204]).toBeLessThan(0.2);
    expect(Math.max(...shares)).toBeLessThanOrEqual(1);
  });

  it('stays at the runs asked for when the time budget is spent', () => {
    const setup: BattleSetup = { attackers: [{ units: { 202: 2, 204: 3 }, research: none }], defenders: [{ units: { 401: 1 }, research: none }] };
    let clock = 0;
    const s = simulateRefined(fight, setup, 30, undefined, { now: () => (clock += 5000) });
    expect(s.runs).toBe(30);
  });

  it('stuns with ion cannons: their hits disable ships for a round', () => {
    const setup: BattleSetup = { attackers: [{ units: { 204: 300 }, research: none }], defenders: [{ units: { 405: 50 }, research: none }] };
    const { output } = runBattle(fight, setup);
    const stunned = output.rounds.reduce((n, r) => n + r.defender.Statistics.stunned_done.sum, 0);
    expect(stunned).toBeGreaterThan(0);
  });

  it('loots a won battle and leaves debris', () => {
    const setup: BattleSetup = {
      attackers: [{ units: { 207: 50, 203: 20 }, research: none }],
      defenders: [{ units: { 401: 20 }, research: none }],
      resources: { metal: 300000, crystal: 150000, deuterium: 60000 },
    };
    const s = simulate(fight, setup, 5, { fleetDebris: 50, defenseDebris: 10, moonFactor: 1, maxMoonChance: 20 });
    expect(s.wins.attacker).toBe(1);
    expect(s.loot.metal).toBeGreaterThan(0);
    // rocket launchers: 2000 metal each, 10 % of what is not rebuilt
    expect(s.debris.metal.max).toBeLessThanOrEqual(20 * 2000 * 0.1);
  });
});

describe('chanceMargin', () => {
  it('narrows with the runs and keeps a margin for chances never seen', () => {
    expect(chanceMargin(0.04, 100)).toBeGreaterThan(0.03);
    expect(chanceMargin(0.04, 10000)).toBeLessThan(0.005);
    expect(chanceMargin(0, 20)).toBeCloseTo(0.161, 2);
    expect(chanceMargin(1, 20)).toBeCloseTo(0.161, 2);
    expect(chanceMargin(0, 1000)).toBeLessThan(0.005);
    expect(chanceMargin(0.5, 0)).toBe(1);
  });
});
