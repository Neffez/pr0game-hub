import { withUnits, type UnitCatalog } from '@pr0hub/core/units';
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
  /** share of the runs (0-1) in which at least one unit of the type is lost for good (rebuilt defense not counted) */
  lossChance: Record<number, number>;
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
  /** share of the runs (0-1) per number of rounds fought */
  roundShares: Record<number, number>;
  attackers: FleetSummary[];
  defenders: FleetSummary[];
  debris: { metal: Range; crystal: Range };
  /** average over all runs (lost battles bring nothing) */
  loot: { metal: number; crystal: number; deuterium: number };
  moonChance: Range;
  lostValue: { attacker: Range; defender: Range };
  /** average costs of what each side lost for good, with deuterium */
  lostResources: { attacker: Resources; defender: Resources };
  /** the run closest to the average losses, with the engine's rounds for the report */
  typical: { run: RunResult; output: EngineOutput };
}

const ZERO_RES: Resources = { metal: 0, crystal: 0, deuterium: 0 };

/** One battle: engine, evaluation, loot of a won battle, moon chance. */
export function runBattle(fight: Fight, setup: BattleSetup, settings: SimSettings = DEFAULT_SIM_SETTINGS, random = Math.random, units?: UnitCatalog) {
  return withUnits(units, () => battleRun(fight, setup, settings, random));
}

function battleRun(fight: Fight, setup: BattleSetup, settings: SimSettings, random: () => number) {
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
  const out: FleetSummary = { lost: {}, repaired: {}, remaining: {}, lossChance: {} };
  for (const key of ['lost', 'repaired', 'remaining'] as const) {
    const ids = new Set(fleets.flatMap((f) => Object.keys(f[key]).map(Number)));
    for (const id of ids) out[key][id] = range(fleets.map((f) => f[key][id] ?? 0));
  }
  for (const id of Object.keys(out.remaining).map(Number)) {
    out.lossChance[id] = fleets.filter((f) => (f.lost[id] ?? 0) - (f.repaired[id] ?? 0) > 0).length / fleets.length;
  }
  return out;
}

/**
 * Summary of many runs of the same battle. `extra` are further runs kept without the engine's rounds: they count
 * like the others, the typical run is one of `runs`.
 */
export function summarize(runs: { run: RunResult; output: EngineOutput }[], extra: RunResult[] = []): SimSummary {
  const results = runs.map((r) => r.run).concat(extra);
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
    roundShares: results.reduce<Record<number, number>>((acc, r) => {
      acc[r.rounds] = (acc[r.rounds] ?? 0) + 1 / n;
      return acc;
    }, {}),
    attackers: results[0].attackers.map((_, i) => fleetSummary(results.map((r) => r.attackers[i]))),
    defenders: results[0].defenders.map((_, i) => fleetSummary(results.map((r) => r.defenders[i]))),
    debris: { metal: range(results.map((r) => r.debris.metal)), crystal: range(results.map((r) => r.debris.crystal)) },
    loot: { metal: avg((r) => r.loot.metal), crystal: avg((r) => r.loot.crystal), deuterium: avg((r) => r.loot.deuterium) },
    moonChance: range(results.map((r) => r.moonChance)),
    lostValue: { attacker: range(results.map((r) => r.lostValue.attacker)), defender: range(results.map((r) => r.lostValue.defender)) },
    lostResources: {
      attacker: { metal: avg((r) => r.lostResources.attacker.metal), crystal: avg((r) => r.lostResources.attacker.crystal), deuterium: avg((r) => r.lostResources.attacker.deuterium) },
      defender: { metal: avg((r) => r.lostResources.defender.metal), crystal: avg((r) => r.lostResources.defender.crystal), deuterium: avg((r) => r.lostResources.defender.deuterium) },
    },
    typical,
  };
}

/** Runs the battle `runs` times and summarizes it (the tool's worker calls `runBattle` itself to report progress). */
export function simulate(
  fight: Fight,
  setup: BattleSetup,
  runs: number,
  settings: SimSettings = DEFAULT_SIM_SETTINGS,
  random = Math.random,
  units?: UnitCatalog,
): SimSummary {
  const list = Array.from({ length: Math.max(1, Math.floor(runs)) }, () => runBattle(fight, setup, settings, random, units));
  return summarize(list);
}

/**
 * 95 % margin of a share measured over `runs` runs (Wilson score interval): how far the true chance is likely off at
 * most. A share of 0 or 1 keeps a margin too: 20 runs without a loss still allow a chance of 16 %.
 */
export function chanceMargin(share: number, runs: number): number {
  if (!(runs > 0)) return 1;
  const z = 1.96;
  const center = (share + (z * z) / (2 * runs)) / (1 + (z * z) / runs);
  const half = (z * Math.sqrt((share * (1 - share)) / runs + (z * z) / (4 * runs * runs))) / (1 + (z * z) / runs);
  return Math.max(center + half - share, share - (center - half));
}

/** The widest margin of the loss chances of a summary. */
export function lossMargin(summary: SimSummary): number {
  const chances = [...summary.attackers, ...summary.defenders].flatMap((f) => Object.values(f.lossChance));
  return chances.reduce((max, c) => Math.max(max, chanceMargin(c, summary.runs)), 0);
}

/** Refining of the loss chances: more runs than asked for while the battle is quick. */
export interface Refine {
  /** margin (0-1) the loss chances are refined to */
  margin: number;
  /** most runs in total */
  maxRuns: number;
  /** refining ends this long after the start, the runs asked for always finish */
  budgetMs: number;
}

export const DEFAULT_REFINE: Refine = { margin: 0.005, maxRuns: 10000, budgetMs: 2000 };

/**
 * Runs the battle at least `runs` times and goes on while the loss chances are less exact than `refine.margin` and
 * the time budget lasts: small battles, where one lost ship matters, get a steady chance, large ones stay at `runs`.
 * `progress` gets the share done (0-1) after every run.
 */
export function simulateRefined(
  fight: Fight,
  setup: BattleSetup,
  runs: number,
  settings: SimSettings = DEFAULT_SIM_SETTINGS,
  options: { refine?: Refine; random?: () => number; units?: UnitCatalog; now?: () => number; progress?: (share: number) => void } = {},
): SimSummary {
  const { refine = DEFAULT_REFINE, random = Math.random, units, now = Date.now, progress } = options;
  const base = Math.max(1, Math.floor(runs));
  const start = now();
  const list: ReturnType<typeof runBattle>[] = [];
  // runs beyond the ones asked for are kept without the engine's rounds, they would fill the memory
  const extra: RunResult[] = [];
  // the margin is checked when the runs have doubled, so summarizing stays cheap
  let check = base;
  for (;;) {
    const battle = runBattle(fight, setup, settings, random, units);
    if (list.length < base) list.push(battle);
    else extra.push(battle.run);
    const n = list.length + extra.length;
    if (n < base) {
      progress?.(n / base);
      continue;
    }
    const spent = (now() - start) / refine.budgetMs;
    if (n >= refine.maxRuns || spent >= 1) break;
    if (n >= check) {
      if (lossMargin(summarize(list, extra)) <= refine.margin) break;
      check = Math.min(refine.maxRuns, n * 2);
    }
    progress?.(Math.max(spent, n / refine.maxRuns));
  }
  return summarize(list, extra);
}
