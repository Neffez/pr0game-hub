/**
 * Upgrade advisor: which next upgrade pays off first. Per planet the next level of the mines, the energy that makes
 * them run (solar plant, fusion reactor, solar satellites) and, account wide, the research that raises production
 * (mining research 131-133, energy technology 113 for the fusion reactor), each ranked by its payback time: the cost
 * against the extra production per hour, both valued with a market rate. Production as the game computes it
 * (`productionOf`), scaled per resource to what the synced pages showed (`calibrate`: production settings, bonuses).
 */

import { buildingCost, BUILDINGS, requirementsOf, RESEARCH } from './buildings.js';
import {
  calibrate, CRYSTAL_MINE, DEUTERIUM_SYNTHESIZER, ENERGY_TECH, FUSION_REACTOR, METAL_MINE, productionOf, SOLAR_PLANT, SOLAR_SATELLITE,
  type Production,
} from './production.js';
import { unitCost } from './units.js';

export interface AdvisorPlanet {
  /** hub planet key (`g:s:p:planet`) */
  key: string;
  name: string;
  /** building levels after the build queue, and the number of solar satellites (212) */
  levels: Record<string, number>;
  /** max temperature */
  temp: number;
  /** production settings of the producers (0 … 1), default 1 */
  factors?: Record<string, number> | null;
  /** production per hour the synced page showed (901-903), to calibrate the formula */
  perHour?: Record<string, number> | null;
}

/** Market rate: metal and crystal per 1 deuterium (the hub's market rate). */
export interface ValueRate {
  m: number;
  k: number;
}

/** Without a market rate of the group: the usual 3 : 2 : 1. */
export const DEFAULT_RATE: ValueRate = { m: 3, k: 2 };

export interface AdvisorInput {
  planets: AdvisorPlanet[];
  research: Record<string, number>;
  /** resource multiplier as a factor (`resource_multiplier` / 2500) */
  resourceSpeed: number;
  energySpeed?: number;
  rate?: ValueRate | null;
  /** catch-up bonus in percent (lowers building and research costs) */
  catchUp?: number;
}

export type AdviceKind = 'building' | 'research' | 'satellites';

/** One step of an advice: a level of a building or research, or a number of solar satellites. */
export interface AdviceStep {
  kind: AdviceKind;
  element: number;
  /** target level (building, research) or the satellites to build */
  level: number;
}

export interface Advice {
  /** planet of the step; null for research (account wide) */
  key: string | null;
  step: AdviceStep;
  /** energy that has to come with it so the mine runs at full power (same planet) */
  with: AdviceStep[];
  cost: Record<number, number>;
  /** cost in deuterium by the rate */
  costValue: number;
  /** extra production per hour (901-903, all planets for research) */
  gain: Record<number, number>;
  gainValue: number;
  /** hours until the cost is produced back */
  payback: number;
}

const RES = [901, 902, 903] as const;
const ENERGY_BUILDINGS = [SOLAR_PLANT, FUSION_REACTOR];
const MINES = [METAL_MINE, CRYSTAL_MINE, DEUTERIUM_SYNTHESIZER];
const RESEARCH_IDS = [131, 132, 133, ENERGY_TECH];
/** at most this many levels or satellites to cover an energy gap */
const MAX_ENERGY_LEVELS = 5;
const MAX_SATELLITES = 2000;

const add = (a: Record<number, number>, b: Record<number, number>) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[Number(k)] = (out[Number(k)] ?? 0) + v;
  return out;
};

/** Value of resources in deuterium by the rate. */
export const valueOf = (r: Record<number, number>, rate: ValueRate = DEFAULT_RATE) => (r[901] ?? 0) / rate.m + (r[902] ?? 0) / rate.k + (r[903] ?? 0);

/** The next upgrades ranked by payback time, shortest first; upgrades that bring nothing are left out. */
export function upgradeAdvice(i: AdvisorInput): Advice[] {
  const rate = i.rate && i.rate.m > 0 && i.rate.k > 0 ? i.rate : DEFAULT_RATE;
  const catchUp = i.catchUp ?? 0;
  const out: Advice[] = [];
  const prod = (p: AdvisorPlanet, levels: Record<string, number>, research: Record<string, number>): Production =>
    productionOf({ levels, research, temp: p.temp, factors: p.factors ?? undefined, resourceSpeed: i.resourceSpeed, energySpeed: i.energySpeed });
  // per planet: the formula's production now and the factors to what the synced page showed
  const base = i.planets.map((p) => {
    const now = prod(p, p.levels, i.research);
    return { p, now, calib: p.perHour ? calibrate(p.perHour, now) : { 901: 1, 902: 1, 903: 1 } };
  });
  const delta = (b: (typeof base)[number], next: Production) => {
    const g: Record<number, number> = {};
    for (const r of RES) g[r] = (next[r] - b.now[r]) * b.calib[r];
    return g;
  };
  const allowed = (id: number, levels: Record<string, number>, research: Record<string, number>, level: number) => {
    const max = (BUILDINGS[String(id)] ?? RESEARCH[String(id)])?.max ?? Infinity;
    return level <= max && requirementsOf(id, levels, research).every((r) => r.own >= r.need);
  };
  const push = (key: string | null, step: AdviceStep, withSteps: AdviceStep[], cost: Record<number, number>, gain: Record<number, number>) => {
    const gainValue = valueOf(gain, rate);
    if (!(gainValue > 1e-9)) return;
    const costValue = valueOf(cost, rate);
    out.push({ key, step, with: withSteps, cost, costValue, gain, gainValue, payback: costValue / gainValue });
  };
  const costOfStep = (s: AdviceStep, levels: Record<string, number>): Record<number, number> => {
    if (s.kind === 'satellites') {
      const c = unitCost(SOLAR_SATELLITE) ?? [0, 2000, 500];
      return { 901: c[0] * s.level, 902: c[1] * s.level, 903: c[2] * s.level };
    }
    // several levels of one building (energy gap): every level's cost
    let cost: Record<number, number> = {};
    const from = s.kind === 'research' ? (i.research[s.element] ?? 0) : (levels[s.element] ?? 0);
    for (let l = from + 1; l <= s.level; l++) cost = add(cost, buildingCost(s.element, l, catchUp));
    return cost;
  };
  const withStep = (levels: Record<string, number>, s: AdviceStep) =>
    s.kind === 'satellites' ? { ...levels, [SOLAR_SATELLITE]: (levels[SOLAR_SATELLITE] ?? 0) + s.level } : { ...levels, [s.element]: s.level };

  for (const b of base) {
    const { p } = b;
    const lvl = (id: number) => p.levels[id] ?? 0;
    // the ways to cover an energy gap of `need` on this planet after `levels` (the cheapest is chosen per mine)
    const energyFixes = (levels: Record<string, number>, need: number): AdviceStep[] => {
      const fixes: AdviceStep[] = [];
      for (const id of ENERGY_BUILDINGS) {
        for (let n = 1; n <= MAX_ENERGY_LEVELS; n++) {
          const level = (levels[id] ?? 0) + n;
          if (!allowed(id, levels, i.research, level)) break;
          const e = prod(p, { ...levels, [id]: level }, i.research);
          if (e.energy >= e.energyUsed) {
            fixes.push({ kind: 'building', element: id, level });
            break;
          }
        }
      }
      if (requirementsOf(SOLAR_SATELLITE, levels, i.research).every((r) => r.own >= r.need)) {
        const one = prod(p, { ...levels, [SOLAR_SATELLITE]: (levels[SOLAR_SATELLITE] ?? 0) + 1 }, i.research).energy - prod(p, levels, i.research).energy;
        const count = one > 0 ? Math.ceil(need / one) : Infinity;
        if (count <= MAX_SATELLITES) fixes.push({ kind: 'satellites', element: SOLAR_SATELLITE, level: count });
      }
      return fixes;
    };

    for (const id of MINES) {
      const level = lvl(id) + 1;
      if (!allowed(id, p.levels, i.research, level)) continue;
      const step: AdviceStep = { kind: 'building', element: id, level };
      const levels = withStep(p.levels, step);
      const next = prod(p, levels, i.research);
      const cost = costOfStep(step, p.levels);
      const gap = next.energyUsed - next.energy;
      if (gap <= 0) {
        push(p.key, step, [], cost, delta(b, next));
        continue;
      }
      // short of energy: the mine with the cheapest energy that covers the gap (the alternative without it runs slower)
      let best: { fix: AdviceStep; cost: Record<number, number>; gain: Record<number, number>; payback: number } | null = null;
      for (const fix of energyFixes(levels, gap)) {
        const after = withStep(levels, fix);
        const g = delta(b, prod(p, after, i.research));
        const c = add(cost, costOfStep(fix, levels));
        const pay = valueOf(c, rate) / Math.max(valueOf(g, rate), 1e-9);
        if (!best || pay < best.payback) best = { fix, cost: c, gain: g, payback: pay };
      }
      if (best) push(p.key, step, [best.fix], best.cost, best.gain);
      else push(p.key, step, [], cost, delta(b, next));
    }

    // energy alone pays off only while the mines are short of it
    // (one level more, or the satellites that close the gap; a level may close it only partly)
    if (b.now.energyUsed > b.now.energy) {
      const fixes: AdviceStep[] = ENERGY_BUILDINGS.filter((id) => allowed(id, p.levels, i.research, lvl(id) + 1)).map((id) => ({ kind: 'building', element: id, level: lvl(id) + 1 }));
      fixes.push(...energyFixes(p.levels, b.now.energyUsed - b.now.energy).filter((f) => f.kind === 'satellites'));
      for (const fix of fixes) push(p.key, fix, [], costOfStep(fix, p.levels), delta(b, prod(p, withStep(p.levels, fix), i.research)));
    }
  }

  // research: one level more on every planet
  for (const id of RESEARCH_IDS) {
    const level = (i.research[id] ?? 0) + 1;
    const anyPlanet = i.planets[0]?.levels ?? {};
    if (!allowed(id, anyPlanet, i.research, level) && !i.planets.some((p) => allowed(id, p.levels, i.research, level))) continue;
    const research = { ...i.research, [id]: level };
    let gain: Record<number, number> = {};
    for (const b of base) gain = add(gain, delta(b, prod(b.p, b.p.levels, research)));
    push(null, { kind: 'research', element: id, level }, [], buildingCost(id, level, catchUp), gain);
  }

  return out.sort((a, b) => a.payback - b.payback);
}
