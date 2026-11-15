import { withUnits, type UnitCatalog } from '@pr0hub/core/units';
import { engineInput, type BattleFleet } from './input.js';
import { battleResult, DEFAULT_DEBRIS, moonChance, type BattleResult, type DebrisSettings, type EngineOutput, type Resources3 } from './result.js';
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

/** Average, least and most of values added one by one; values left out count as 0. */
class Tally {
  private sum = 0;
  private min = Infinity;
  private max = -Infinity;
  private count = 0;

  add(value: number) {
    this.sum += value;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    this.count++;
  }

  range(runs: number): Range {
    if (!runs) return { avg: 0, min: 0, max: 0 };
    const zero = this.count < runs;
    return { avg: this.sum / runs, min: zero ? Math.min(this.min, 0) : this.min, max: zero ? Math.max(this.max, 0) : this.max };
  }
}

type FleetRun = RunResult['attackers'][number];

class FleetTally {
  private tallies = { lost: new Map<number, Tally>(), repaired: new Map<number, Tally>(), remaining: new Map<number, Tally>() };
  private losses = new Map<number, number>();

  add(fleet: FleetRun) {
    for (const key of ['lost', 'repaired', 'remaining'] as const) {
      for (const [id, n] of Object.entries(fleet[key])) {
        let tally = this.tallies[key].get(Number(id));
        if (!tally) this.tallies[key].set(Number(id), (tally = new Tally()));
        tally.add(n);
      }
    }
    for (const [id, n] of Object.entries(fleet.lost)) {
      if (n - (fleet.repaired[Number(id)] ?? 0) > 0) this.losses.set(Number(id), (this.losses.get(Number(id)) ?? 0) + 1);
    }
  }

  summary(runs: number): FleetSummary {
    const out: FleetSummary = { lost: {}, repaired: {}, remaining: {}, lossChance: {} };
    for (const key of ['lost', 'repaired', 'remaining'] as const) {
      for (const [id, tally] of this.tallies[key]) out[key][id] = tally.range(runs);
    }
    for (const id of Object.keys(out.remaining).map(Number)) out.lossChance[id] = (this.losses.get(id) ?? 0) / runs;
    return out;
  }
}

/**
 * Sums up runs of the same battle one by one, so many runs need no memory: a kept run costs kilobytes (its unit
 * records are keyed by element id).
 */
export class SimTally {
  private runs = 0;
  private wins = { attacker: 0, defender: 0, draw: 0 };
  private rounds = new Tally();
  private roundCounts: Record<number, number> = {};
  private attackers: FleetTally[] = [];
  private defenders: FleetTally[] = [];
  private debris = { metal: new Tally(), crystal: new Tally() };
  private loot = { metal: 0, crystal: 0, deuterium: 0 };
  private moonChance = new Tally();
  private lostValue = { attacker: new Tally(), defender: new Tally() };
  private lostResources = { attacker: { metal: 0, crystal: 0, deuterium: 0 }, defender: { metal: 0, crystal: 0, deuterium: 0 } };

  get count() {
    return this.runs;
  }

  add(run: RunResult) {
    this.runs++;
    this.wins[run.winner]++;
    this.rounds.add(run.rounds);
    this.roundCounts[run.rounds] = (this.roundCounts[run.rounds] ?? 0) + 1;
    run.attackers.forEach((f, i) => (this.attackers[i] ??= new FleetTally()).add(f));
    run.defenders.forEach((f, i) => (this.defenders[i] ??= new FleetTally()).add(f));
    this.debris.metal.add(run.debris.metal);
    this.debris.crystal.add(run.debris.crystal);
    this.moonChance.add(run.moonChance);
    for (const r of ['metal', 'crystal', 'deuterium'] as const) {
      this.loot[r] += run.loot[r];
      this.lostResources.attacker[r] += run.lostResources.attacker[r];
      this.lostResources.defender[r] += run.lostResources.defender[r];
    }
    this.lostValue.attacker.add(run.lostValue.attacker);
    this.lostValue.defender.add(run.lostValue.defender);
  }

  /** The widest margin of the loss chances so far. */
  lossMargin(): number {
    const n = this.runs;
    const chances = [...this.attackers, ...this.defenders].flatMap((f) => Object.values(f.summary(n).lossChance));
    return chances.reduce((max, c) => Math.max(max, chanceMargin(c, n)), 0);
  }

  /** The summary; the typical run is the one of `kept` closest to the average losses of all runs. */
  summary(kept: { run: RunResult; output: EngineOutput }[]): SimSummary {
    const n = this.runs;
    const avg = (res: Resources3) => ({ metal: res.metal / n, crystal: res.crystal / n, deuterium: res.deuterium / n });
    const lostAvg = this.lostValue.attacker.range(n).avg + this.lostValue.defender.range(n).avg;
    const off = (r: { run: RunResult }) => Math.abs(r.run.lostValue.attacker + r.run.lostValue.defender - lostAvg);
    return {
      runs: n,
      wins: { attacker: this.wins.attacker / n, defender: this.wins.defender / n, draw: this.wins.draw / n },
      rounds: this.rounds.range(n),
      roundShares: Object.fromEntries(Object.entries(this.roundCounts).map(([rounds, count]) => [rounds, count / n])),
      attackers: this.attackers.map((f) => f.summary(n)),
      defenders: this.defenders.map((f) => f.summary(n)),
      debris: { metal: this.debris.metal.range(n), crystal: this.debris.crystal.range(n) },
      loot: avg(this.loot),
      moonChance: this.moonChance.range(n),
      lostValue: { attacker: this.lostValue.attacker.range(n), defender: this.lostValue.defender.range(n) },
      lostResources: { attacker: avg(this.lostResources.attacker), defender: avg(this.lostResources.defender) },
      typical: kept.reduce((best, r) => (off(r) < off(best) ? r : best)),
    };
  }
}

/** Summary of many runs of the same battle. */
export function summarize(runs: { run: RunResult; output: EngineOutput }[]): SimSummary {
  const tally = new SimTally();
  for (const r of runs) tally.add(r.run);
  return tally.summary(runs);
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
  // the runs asked for are kept for the typical run, further ones are only counted
  const kept: ReturnType<typeof runBattle>[] = [];
  const tally = new SimTally();
  // the margin is checked when the runs have doubled
  let check = base;
  for (;;) {
    const battle = runBattle(fight, setup, settings, random, units);
    if (kept.length < base) kept.push(battle);
    tally.add(battle.run);
    const n = tally.count;
    if (n < base) {
      progress?.(n / base);
      continue;
    }
    const spent = (now() - start) / refine.budgetMs;
    if (n >= refine.maxRuns || spent >= 1) break;
    if (n >= check) {
      if (tally.lossMargin() <= refine.margin) break;
      check = Math.min(refine.maxRuns, n * 2);
    }
    progress?.(Math.max(spent, n / refine.maxRuns));
  }
  return tally.summary(kept);
}
