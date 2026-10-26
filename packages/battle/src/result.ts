import { ELEMENT_COSTS } from '@pr0hub/core/tech';
import type { BattleFleet } from './input.js';

/** Per unit of a fleet in one round, as the engine reports it (`Roundstats`). */
export interface EngineUnitRound {
  attack: number;
  shield: number;
  hull: number;
  amount: number;
  lost: number;
  stunned: number;
  escape: number;
}

/** One statistic of a side in a round: shooter fleet -> target fleet -> shooter unit -> target unit -> value. */
export interface EngineStat {
  maps: Record<string, Record<string, Record<string, Record<string, number>>>>;
  sum: number;
}

export interface EngineSideRound {
  Roundstats: Record<string, Record<string, EngineUnitRound>>;
  Statistics: Record<string, EngineStat>;
}

/** Output of the Rust engine: `outcome` 1 attacker wins, -1 defender wins, 0 draw; round 0 is the start. */
export interface EngineOutput {
  outcome: 1 | 0 | -1;
  rounds: { attacker: EngineSideRound; defender: EngineSideRound }[];
}

export type Winner = 'attacker' | 'defender' | 'draw';

/** Universe settings of a battle: share of destroyed fleet and defense in the debris field (percent). */
export interface DebrisSettings {
  fleetDebris: number;
  defenseDebris: number;
}

export const DEFAULT_DEBRIS: DebrisSettings = { fleetDebris: 30, defenseDebris: 0 };

export interface FleetOutcome {
  /** units lost in the battle (before the defense is rebuilt) */
  lost: Record<number, number>;
  /** defense rebuilt after the battle (the planet only) */
  repaired: Record<number, number>;
  /** units after the battle */
  remaining: Record<number, number>;
}

export interface BattleResult {
  winner: Winner;
  /** rounds fought */
  rounds: number;
  attackers: FleetOutcome[];
  defenders: FleetOutcome[];
  debris: { metal: number; crystal: number };
  /** value of the lost units (metal + crystal) per side */
  lostValue: { attacker: number; defender: number };
  /** costs of what each side lost for good (rebuilt defense not counted), with deuterium */
  lostResources: { attacker: Resources3; defender: Resources3 };
}

export interface Resources3 {
  metal: number;
  crystal: number;
  deuterium: number;
}

const WINNER: Record<number, Winner> = { 1: 'attacker', [-1]: 'defender', 0: 'draw' };

/** Defense the game rebuilds: of more than 10 units 60-80 %, else each unit with 70 %. */
function rebuilt(amount: number, random: () => number): number {
  const rand = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  if (amount > 10) return Math.ceil((amount * rand(60, 80)) / 100);
  let n = 0;
  for (let i = 0; i < amount; i++) if (rand(1, 100) <= 70) n++;
  return n;
}

function outcomes(fleets: BattleFleet[], rounds: EngineOutput['rounds'], side: 'attacker' | 'defender'): FleetOutcome[] {
  return fleets.map((fleet, i) => {
    const lost: Record<number, number> = {};
    for (const round of rounds) {
      for (const [id, unit] of Object.entries(round[side].Roundstats[i] ?? {})) {
        if (unit.lost > 0) lost[Number(id)] = (lost[Number(id)] ?? 0) + unit.lost;
      }
    }
    const remaining: Record<number, number> = {};
    for (const [id, n] of Object.entries(fleet.units)) if (n > 0) remaining[Number(id)] = n - (lost[Number(id)] ?? 0);
    return { lost, repaired: {}, remaining };
  });
}

/**
 * The battle's result from the engine output, like the game evaluates it (`BattleEngineRust::parseRustJson`): losses
 * summed over the rounds, the planet's defense rebuilt, the debris field from the lost fleet and the defense that
 * stays destroyed.
 */
export function battleResult(
  output: EngineOutput,
  attackers: BattleFleet[],
  defenders: BattleFleet[],
  settings: DebrisSettings = DEFAULT_DEBRIS,
  random: () => number = Math.random,
): BattleResult {
  const a = outcomes(attackers, output.rounds, 'attacker');
  const d = outcomes(defenders, output.rounds, 'defender');
  const debris = { metal: 0, crystal: 0 };
  const lostValue = { attacker: 0, defender: 0 };
  const lostResources = { attacker: { metal: 0, crystal: 0, deuterium: 0 }, defender: { metal: 0, crystal: 0, deuterium: 0 } };
  const cost = (side: Resources3, id: number, amount: number) => {
    const [metal, crystal, deuterium] = ELEMENT_COSTS[id] ?? [0, 0, 0];
    side.metal += metal * amount;
    side.crystal += crystal * amount;
    side.deuterium += deuterium * amount;
  };
  const add = (id: number, amount: number, percent: number) => {
    const [metal, crystal] = ELEMENT_COSTS[id] ?? [0, 0];
    debris.metal += (metal * amount * percent) / 100;
    debris.crystal += (crystal * amount * percent) / 100;
  };
  const value = (id: number, amount: number) => amount * ((ELEMENT_COSTS[id]?.[0] ?? 0) + (ELEMENT_COSTS[id]?.[1] ?? 0));

  for (const f of a) {
    for (const [key, n] of Object.entries(f.lost)) {
      add(Number(key), n, settings.fleetDebris);
      lostValue.attacker += value(Number(key), n);
      cost(lostResources.attacker, Number(key), n);
    }
  }
  d.forEach((f, slot) => {
    for (const [key, n] of Object.entries(f.lost)) {
      const id = Number(key);
      const back = slot === 0 && id >= 400 ? rebuilt(n, random) : 0;
      if (back) {
        f.repaired[id] = back;
        f.remaining[id] += back;
      }
      add(id, n - back, id < 400 ? settings.fleetDebris : settings.defenseDebris);
      lostValue.defender += value(id, n);
      cost(lostResources.defender, id, n - back);
    }
  });

  return {
    winner: WINNER[output.outcome] ?? 'draw',
    rounds: Math.max(0, output.rounds.length - 1),
    attackers: a,
    defenders: d,
    debris,
    lostValue,
    lostResources,
  };
}

/** Chance for a moon in percent (`ShowBattleSimulatorPage`): 1 % per 100,000 debris times the factor, capped. */
export function moonChance(debris: { metal: number; crystal: number }, moonFactor = 1, maxChance = 20): number {
  return Math.min(Math.floor(((debris.metal + debris.crystal) / 100000) * moonFactor), maxChance);
}
