import { unitCost, withUnits, type UnitCatalog } from '@pr0hub/core/units';
import type { BattleFleet } from './input.js';
import { runBattle, DEFAULT_SIM_SETTINGS, type Fight, type SimSettings } from './simulate.js';
import type { Resources } from './steal.js';

/**
 * Defense advisor: which defense makes an attack on a planet cost the attacker more than it brings in. The attacker's
 * profit of one attack is the average over the runs of loot + debris field (when the attacker is expected to recycle
 * it) − the costs of the ships lost − the deuterium of the flight, all valued in deuterium with the market rate. The
 * search adds a mix of the defense units that cut the worst attacker's profit most per resource spent and scales it
 * until no attacker profits any more.
 */

/** Metal and crystal per 1 deuterium. */
export interface DefenseRate {
  m: number;
  k: number;
}

export interface DefenseThreat {
  key: string;
  units: Record<string, number>;
  research: Record<string, number>;
  /** deuterium of the flight to the planet (paid by the attacker) */
  fuel: number;
}

export interface DefenseCandidate {
  id: number;
  /** most units that may be added (1 for a shield dome not built yet) */
  max: number;
}

export interface DefenseSearch {
  /** the defending planet: its ships (if they stay) and defense, combat research */
  planet: BattleFleet;
  /** resources on the planet at the attack */
  resources: Resources;
  threats: DefenseThreat[];
  /** defense units the planet can build */
  candidates: DefenseCandidate[];
  rate: DefenseRate;
  /** the attacker recycles the debris field (counts as profit) */
  debris: boolean;
  /** the advice may cost at most this many times the profit of the worst attack */
  maxFactor: number;
  /** runs per battle (fewer when the battles are large, see `work`) */
  runs: number;
  /** most pieces × runs of the whole search (engine work) */
  work: number;
}

export interface ThreatOutcome {
  key: string;
  /** expected profit of one attack in deuterium value (negative: a loss for the attacker) */
  profit: number;
  loot: Resources;
  debris: { metal: number; crystal: number };
  /** costs of the attacker's ships lost for good */
  lost: Resources;
  /** costs of the defender's units lost for good (rebuilt defense not counted) */
  defenderLost: Resources;
  fuel: number;
  /** share of the runs (0-1) won by the attacker */
  wins: number;
}

export type DefenseStatus =
  /** no attacker profits already */
  | 'safe'
  /** the defense in `add` makes every attack unprofitable */
  | 'found'
  /** no buildable defense cuts the profit, or the needed defense would cost more than `maxFactor` × the profit */
  | 'limit'
  /** the battles are too large for the engine budget: `add` is the best found so far */
  | 'budget';

export interface DefenseAdvice {
  status: DefenseStatus;
  before: ThreatOutcome[];
  /** with the added defense (null when nothing is added) */
  after: ThreatOutcome[] | null;
  /** defense units to add */
  add: Record<number, number>;
  cost: Resources;
  /** cost in deuterium value */
  costValue: number;
  /** battles run */
  battles: number;
  /** runs per battle used */
  runs: number;
}

/** Defense types mixed (the most efficient ones). */
const MIX_TYPES = 2;
const BISECT = 4;
const MIN_RUNS = 3;
/**
 * The engine draws its own random numbers, so a defense found is confirmed with twice the runs against all threats;
 * when an attacker still profits, the mix grows by `GROW` (at most `CONFIRM` times).
 */
const CONFIRM = 3;
const GROW = 1.25;

const ZERO: Resources = { metal: 0, crystal: 0, deuterium: 0 };

export const valueIn = (r: { metal: number; crystal: number; deuterium?: number }, rate: DefenseRate) => r.metal / rate.m + r.crystal / rate.k + (r.deuterium ?? 0);

/** Same random numbers for the rebuilt defense in every variant (the engine itself draws its own). */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pieces = (units: Record<string, number>) => Object.values(units).reduce((a, b) => a + Math.max(0, b), 0);

function costOfUnits(units: Record<number, number>): Resources {
  const out = { ...ZERO };
  for (const [id, n] of Object.entries(units)) {
    const c = unitCost(id);
    if (!c || n <= 0) continue;
    out.metal += c[0] * n;
    out.crystal += c[1] * n;
    out.deuterium += c[2] * n;
  }
  return out;
}

const plus = (a: Record<string, number>, b: Record<number, number>) => {
  const out: Record<string, number> = { ...a };
  for (const [id, n] of Object.entries(b)) if (n > 0) out[id] = (out[id] ?? 0) + n;
  return out;
};

/** Runs the search (synchronously: in a worker on the server). `units`: the universe's unit catalog. */
export function defenseAdvice(fight: Fight, search: DefenseSearch, settings: SimSettings = DEFAULT_SIM_SETTINGS, units?: UnitCatalog): DefenseAdvice {
  return withUnits(units, () => adviceOf(fight, search, settings, units));
}

function adviceOf(fight: Fight, s: DefenseSearch, settings: SimSettings, units?: UnitCatalog): DefenseAdvice {
  let battles = 0;
  let work = 0;
  let runs = Math.max(1, Math.floor(s.runs));
  let outOfBudget = false;

  /** One attacker against the planet with `extra` defense: the average profit over the runs. */
  function outcome(t: DefenseThreat, extra: Record<number, number>, n: number): ThreatOutcome {
    const planet = { units: plus(s.planet.units, extra), research: s.planet.research };
    const random = seeded(0x5eed);
    const sum = { loot: { ...ZERO }, debris: { metal: 0, crystal: 0 }, lost: { ...ZERO }, defenderLost: { ...ZERO }, wins: 0 };
    for (let i = 0; i < n; i++) {
      const { run } = runBattle(fight, { attackers: [{ units: t.units, research: t.research }], defenders: [planet], resources: s.resources }, settings, random, units);
      for (const k of ['metal', 'crystal', 'deuterium'] as const) {
        sum.loot[k] += run.loot[k];
        sum.lost[k] += run.lostResources.attacker[k];
        sum.defenderLost[k] += run.lostResources.defender[k];
      }
      sum.debris.metal += run.debris.metal;
      sum.debris.crystal += run.debris.crystal;
      if (run.winner === 'attacker') sum.wins++;
    }
    const avg = <T extends Record<string, number>>(r: T) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v / n])) as T;
    const loot = avg(sum.loot);
    const debris = avg(sum.debris);
    const lost = avg(sum.lost);
    const profit = valueIn(loot, s.rate) + (s.debris ? valueIn(debris, s.rate) : 0) - valueIn(lost, s.rate) - t.fuel;
    return { key: t.key, profit, loot, debris, lost, defenderLost: avg(sum.defenderLost), fuel: t.fuel, wins: sum.wins / n };
  }

  /** All `threats` against the planet with `extra` (`factor` × the runs); null when the engine budget is used up. */
  function evaluate(threats: DefenseThreat[], extra: Record<number, number>, factor = 1): ThreatOutcome[] | null {
    const defender = pieces(s.planet.units) + pieces(extra);
    const per = threats.reduce((a, t) => a + pieces(t.units) + defender, 0);
    // fewer runs when the budget runs short, down to MIN_RUNS
    while (runs > MIN_RUNS && work + per * runs * factor > s.work) runs--;
    const n = runs * factor;
    if (work + per * n > s.work) {
      outOfBudget = true;
      return null;
    }
    work += per * n;
    battles += threats.length * n;
    return threats.map((t) => outcome(t, extra, n));
  }
  const worst = (list: ThreatOutcome[]) => Math.max(...list.map((o) => o.profit));

  const before = evaluate(s.threats, {});
  const result = (status: DefenseStatus, add: Record<number, number>, after: ThreatOutcome[] | null): DefenseAdvice => {
    const cost = costOfUnits(add);
    return { status, before: before ?? [], after, add, cost, costValue: valueIn(cost, s.rate), battles, runs };
  };
  if (!before) return result('budget', {}, null);
  if (!before.length || worst(before) <= 0) return result('safe', {}, null);

  // every attacker that profits is to be stopped
  const targets = before.filter((o) => o.profit > 0).map((o) => s.threats.find((t) => t.key === o.key)!);
  const valueOfUnit = (id: number) => {
    const c = unitCost(id);
    return c ? valueIn({ metal: c[0], crystal: c[1], deuterium: c[2] }, s.rate) : Infinity;
  };
  const candidates = s.candidates.filter((c) => c.max > 0 && Number.isFinite(valueOfUnit(c.id)) && valueOfUnit(c.id) > 0);
  /** the result with `add` measured against all threats */
  const finish = (status: DefenseStatus, add: Record<number, number>) => {
    if (!Object.keys(add).length) return result(status, {}, null);
    const after = evaluate(s.threats, add);
    return result(after ? status : 'budget', add, after);
  };

  let base: Record<number, number> = {};
  let profit = worst(before);

  // shield domes first: one each, kept when they cut the profit
  for (const c of candidates.filter((c) => c.max === 1)) {
    const next = evaluate(targets, { ...base, [c.id]: 1 });
    if (!next) break;
    if (worst(next) < profit) {
      base = { ...base, [c.id]: 1 };
      profit = worst(next);
    }
  }
  if (outOfBudget) return finish('budget', base);
  if (profit <= 0) {
    const check = evaluate(s.threats, base, 2);
    if (!check) return finish('budget', base);
    if (worst(check) <= 0) return result('found', base, check);
    profit = worst(check);
  }

  // probe: each type for about the value of the profit, the drop of the worst profit per deuterium spent
  const many = candidates.filter((c) => c.max > 1);
  const probe = Math.max(profit, 1000);
  const amountFor = (id: number, value: number, max: number) => Math.min(max, Math.max(1, Math.round(value / valueOfUnit(id))));
  const efficiency: { id: number; max: number; gain: number }[] = [];
  for (const c of many) {
    const n = amountFor(c.id, probe, c.max);
    const next = evaluate(targets, plus(base, { [c.id]: n }));
    if (!next) break;
    const gain = (profit - worst(next)) / (n * valueOfUnit(c.id));
    if (gain > 0) efficiency.push({ id: c.id, max: c.max, gain });
  }
  if (outOfBudget && !efficiency.length) return finish('budget', base);
  if (!efficiency.length) return finish('limit', base);

  // the mix: the most efficient types, shares of the value by their efficiency
  const mix = efficiency.sort((a, b) => b.gain - a.gain).slice(0, MIX_TYPES);
  const total = mix.reduce((a, m) => a + m.gain, 0);
  const unitsFor = (value: number) => {
    const add: Record<number, number> = { ...base };
    for (const m of mix) add[m.id] = (add[m.id] ?? 0) + amountFor(m.id, (value * m.gain) / total, m.max);
    return add;
  };
  const atMax = (add: Record<number, number>) => mix.every((m) => (add[m.id] ?? 0) - (base[m.id] ?? 0) >= m.max);

  // scale: double until no attacker profits (or the cap), then bisect
  let low = 0;
  let high = probe;
  const cap = (Number.isFinite(s.maxFactor) && s.maxFactor > 0 ? s.maxFactor : 20) * profit;
  let best: Record<number, number> = base;
  // at most 40 doublings: the cap is reached long before
  for (let i = 0; ; i++) {
    const add = unitsFor(Math.min(high, cap));
    const next = evaluate(targets, add);
    if (!next) return finish('budget', best);
    best = add;
    if (worst(next) <= 0) break;
    if (atMax(add)) return finish('limit', add);
    if (high >= cap || i >= 40) return finish('limit', add);
    low = high;
    high = Math.min(high * 2, cap);
  }
  for (let i = 0; i < BISECT; i++) {
    const mid = (low + high) / 2;
    const next = evaluate(targets, unitsFor(mid));
    if (!next) break;
    if (worst(next) <= 0) high = mid;
    else low = mid;
  }

  // confirm against all threats with more runs, grow the mix while an attacker still profits
  let value = high;
  for (let i = 0; i < CONFIRM; i++) {
    const add = unitsFor(value);
    const check = evaluate(s.threats, add, 2);
    if (!check) return result('budget', add, null);
    if (worst(check) <= 0) return result('found', add, check);
    if (atMax(add) || value >= cap) return result('limit', add, check);
    value = Math.min(value * GROW, cap);
  }
  return finish('limit', unitsFor(value));
}
