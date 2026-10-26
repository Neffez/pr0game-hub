import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initSync, wasm_fight_battle_rounds } from '../wasm/battlerust.js';
import { runBattle, simulate, type BattleSetup } from '../src/index.js';

initSync({ module: readFileSync(new URL('../wasm/battlerust_bg.wasm', import.meta.url)) });
const fight = wasm_fight_battle_rounds;
const none = { 109: 0, 110: 0, 111: 0 };

describe('Battlerust engine (WASM)', () => {
  it('lets a lone light fighter lose against a hundred rocket launchers', () => {
    const setup: BattleSetup = { attackers: [{ units: { 204: 1 }, research: none }], defenders: [{ units: { 401: 100 }, research: none }] };
    const s = simulate(fight, setup, 10);
    expect(s.wins.defender).toBe(1);
    expect(s.attackers[0].lost[204].avg).toBe(1);
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
