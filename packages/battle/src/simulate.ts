import { engineInput, type BattleFleet } from './input.js';
import { battleResult, DEFAULT_DEBRIS, moonChance, type BattleResult, type DebrisSettings, type EngineOutput } from './result.js';
import { steal, type Resources } from './steal.js';

/** The engine call: Battlerust's `fight_battle_rounds` (WASM in the browser and in Node). */
export type Fight = (inputJson: string) => string;

export interface BattleSetup {
  attackers: (BattleFleet & { carried?: number })[];
  /** the planet first (defense rebuilt, loot), then fleets holding there */
  defenders: BattleFleet[];
  /** resources on the planet */
  resources?: Resources;
}

export interface SimSettings extends DebrisSettings {
  moonFactor: number;
  maxMoonChance: number;
  /** shield domes as ship shields (universe setting) */
  bigShields?: boolean;
}

export const DEFAULT_SIM_SETTINGS: SimSettings = { ...DEFAULT_DEBRIS, moonFactor: 1, maxMoonChance: 20, bigShields: false };

export interface Range {
  avg: number;
  min: number;
  max: number;
}

export interface FleetSummary {
  lost: Record<number, Range>;
  repaired: Record<number, Range>;
  remaining: Record<number, Range>;
}

export interface RunResult extends BattleResult {
  loot: Resources;
  moonChance: number;
}

export interface SimSummary {
  runs: number;
  /** share of the runs (0-1) */
  wins: { attacker: number; defender: number; draw: number };
  rounds: Range;
  attackers: FleetSummary[];
  defenders: FleetSummary[];
  debris: { metal: Range; crystal: Range };
  /** average over all runs (lost battles bring nothing) */
  loot: { metal: number; crystal: number; deuterium: number };
  moonChance: Range;
  lostValue: { attacker: Range; defender: Range };
  /** the run closest to the average losses, with the engine's rounds for the report */
  typical: { run: RunResult; output: EngineOutput };
}

const ZERO_RES: Resources = { metal: 0, crystal: 0, deuterium: 0 };

/** One battle: engine, evaluation, loot of a won battle, moon chance. */
export function runBattle(fight: Fight, setup: BattleSetup, settings: SimSettings = DEFAULT_SIM_SETTINGS, random = Math.random) {
  const output = JSON.parse(fight(JSON.stringify(engineInput(setup.attackers, setup.defenders, { bigShields: settings.bigShields })))) as EngineOutput;
  const result = battleResult(output, setup.attackers, setup.defenders, settings, random);
  const loot =
    result.winner === 'attacker' && setup.resources
      ? steal(result.attackers.map((f, i) => ({ units: f.remaining, carried: setup.attackers[i].carried })), setup.resources)
      : { ...ZERO_RES };
  const run: RunResult = { ...result, loot, moonChance: moonChance(result.debris, settings.moonFactor, settings.maxMoonChance) };
  return { run, output };
}

function range(values: number[]): Range {
  if (!values.length) return { avg: 0, min: 0, max: 0 };
  return { avg: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
}

function fleetSummary(fleets: { lost: Record<number, number>; repaired: Record<number, number>; remaining: Record<number, number> }[]): FleetSummary {
  const out: FleetSummary = { lost: {}, repaired: {}, remaining: {} };
  for (const key of ['lost', 'repaired', 'remaining'] as const) {
    const ids = new Set(fleets.flatMap((f) => Object.keys(f[key]).map(Number)));
    for (const id of ids) out[key][id] = range(fleets.map((f) => f[key][id] ?? 0));
  }
  return out;
}

/** Summary of many runs of the same battle. */
export function summarize(runs: { run: RunResult; output: EngineOutput }[]): SimSummary {
  const results = runs.map((r) => r.run);
  const n = results.length;
  const share = (w: string) => results.filter((r) => r.winner === w).length / n;
  const lost = range(results.map((r) => r.lostValue.attacker + r.lostValue.defender));
  const typical = runs.reduce((best, r) =>
    Math.abs(r.run.lostValue.attacker + r.run.lostValue.defender - lost.avg) <
    Math.abs(best.run.lostValue.attacker + best.run.lostValue.defender - lost.avg)
      ? r
      : best,
  );
  const avg = (f: (r: RunResult) => number) => results.reduce((a, r) => a + f(r), 0) / n;
  return {
    runs: n,
    wins: { attacker: share('attacker'), defender: share('defender'), draw: share('draw') },
    rounds: range(results.map((r) => r.rounds)),
    attackers: results[0].attackers.map((_, i) => fleetSummary(results.map((r) => r.attackers[i]))),
    defenders: results[0].defenders.map((_, i) => fleetSummary(results.map((r) => r.defenders[i]))),
    debris: { metal: range(results.map((r) => r.debris.metal)), crystal: range(results.map((r) => r.debris.crystal)) },
    loot: { metal: avg((r) => r.loot.metal), crystal: avg((r) => r.loot.crystal), deuterium: avg((r) => r.loot.deuterium) },
    moonChance: range(results.map((r) => r.moonChance)),
    lostValue: { attacker: range(results.map((r) => r.lostValue.attacker)), defender: range(results.map((r) => r.lostValue.defender)) },
    typical,
  };
}

/** Runs the battle `runs` times and summarizes it (the tool's worker calls `runBattle` itself to report progress). */
export function simulate(fight: Fight, setup: BattleSetup, runs: number, settings: SimSettings = DEFAULT_SIM_SETTINGS, random = Math.random): SimSummary {
  const list = Array.from({ length: Math.max(1, Math.floor(runs)) }, () => runBattle(fight, setup, settings, random));
  return summarize(list);
}
