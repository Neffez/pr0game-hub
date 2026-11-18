import {
  buildingCost, buildTime, labLevels, NANITE_FACTORY, RESEARCH_LAB, RESEARCH_NETWORK, researchTime, ROBOT_FACTORY, SHIPYARD, shipyardTime, TECHNO_DOME,
} from '@pr0hub/core/buildings';
import { productionOf, SOLAR_PLANT } from '@pr0hub/core/production';
import { STORAGE, storageCapacity } from '@pr0hub/core/tech';
import type { SimState } from '../simulate.js';
import { kindOf, requirementsOfElement } from './targets.js';
import { PRODUCERS, type Problem } from './problem.js';

/**
 * The greedy construction's estimate (pr0plan `planner/scoreCandidate.js`, `remainingWork.js`,
 * `discretionaryInvestment.js`): every candidate, a required step or a mine, is scored the same way: the time to
 * afford it at the production now, plus its build time, plus the time to afford what is left of the targets
 * afterwards at the production it leads to. A rough, comparative signal for one decision; the search after it
 * measures with the real simulation.
 */

const RES = [901, 902, 903] as const;

/** The planet as the greedy sees it: levels planned (queues included), the account's research planned, resources now. */
export interface View {
  levels: Record<number, number>;
  research: Record<number, number>;
  res: Record<number, number>;
  factors: Record<string, number>;
  /** research levels the other planets' lists still bring (requirements the simulation waits for) */
  pending?: Record<number, number>;
}

export interface Model {
  problem: Problem;
  temp: number;
  calibration: Record<number, number>;
  resourceSpeed: number;
  catchUp: number;
  buildingSpeed: number;
  researchSpeed: number;
  shipyardSpeed: number;
  /** lab levels of the account's other planets (research network) */
  otherLabs: number[];
  /** storage capacity now and the storage levels it is for */
  cap: Record<number, number>;
  storage: Record<number, number>;
}

export function modelOf(problem: Problem, state: SimState): Model {
  const p = state.planets[problem.planet];
  const hub = problem.hub;
  const buildingSpeed = hub.buildingSpeed ?? 2500;
  return {
    problem, temp: p.temp, calibration: p.calibration, resourceSpeed: state.resourceSpeed, catchUp: hub.catchUp ?? 0, buildingSpeed,
    researchSpeed: hub.researchSpeed ?? 2500, shipyardSpeed: hub.shipyardSpeed ?? buildingSpeed,
    otherLabs: Object.entries(state.planets).filter(([k, x]) => k !== problem.planet && x.type === 'planet').map(([, x]) => x.levels[RESEARCH_LAB] ?? 0),
    cap: { ...p.cap }, storage: Object.fromEntries(RES.map((r) => [r, p.levels[STORAGE[r]] ?? 0])),
  };
}

/** Storage capacity of a resource at the planned storage level. */
export function capOf(m: Model, v: View, r: number): number {
  const level = v.levels[STORAGE[r]] ?? 0;
  return level === m.storage[r] ? m.cap[r] : storageCapacity(level, m.problem.hub.storageFactor);
}

/** The storage to build first when `cost` does not fit into the planned storages, else null. */
export function storageFor(m: Model, v: View, cost: Record<number, number>): number | null {
  for (const r of RES) if ((cost[r] ?? 0) > capOf(m, v, r)) return STORAGE[r];
  return null;
}

/** The view of the planet at the simulation's state: queued levels count as built. */
export function viewOf(problem: Problem, state: SimState): View {
  const p = state.planets[problem.planet];
  const levels: Record<number, number> = {};
  for (const [id, v] of Object.entries(p.levels)) levels[Number(id)] = v;
  for (const q of p.build) levels[q.id] = q.level;
  for (const q of p.shipyard) levels[q.id] = (levels[q.id] ?? 0) + q.count;
  const research: Record<number, number> = {};
  for (const [id, v] of Object.entries(state.research)) research[Number(id)] = v;
  for (const q of state.researchQueue) research[q.id] = Math.max(research[q.id] ?? 0, q.level);
  return { levels, research, res: { ...p.res }, factors: { ...p.factors } };
}

export const levelIn = (v: View, id: number) => (kindOf(id) === 'research' ? (v.research[id] ?? 0) : (v.levels[id] ?? 0));

export function rateOf(m: Model, v: View): Record<number, number> {
  if (m.problem.planetType === 'moon') return { 901: 0, 902: 0, 903: 0 };
  const prod = productionOf({ levels: v.levels, research: v.research, temp: m.temp, factors: v.factors, resourceSpeed: m.resourceSpeed });
  return { 901: prod[901] * m.calibration[901], 902: prod[902] * m.calibration[902], 903: prod[903] * m.calibration[903] };
}

export function energyOf(m: Model, v: View): number {
  const prod = productionOf({ levels: v.levels, research: v.research, temp: m.temp, factors: v.factors, resourceSpeed: m.resourceSpeed });
  return prod.energy - prod.energyUsed;
}

/** Cost of the next level (buildings, research) or of `count` units. */
export function costOf(m: Model, v: View, id: number, count = 1): Record<number, number> {
  const kind = kindOf(id);
  if (kind === 'ship' || kind === 'defense') {
    const unit = buildingCost(id, 1);
    return { 901: (unit[901] ?? 0) * count, 902: (unit[902] ?? 0) * count, 903: (unit[903] ?? 0) * count };
  }
  return buildingCost(id, levelIn(v, id) + 1, m.catchUp);
}

/** Seconds to build the next level or `count` units at the planned levels. */
export function durationOf(m: Model, v: View, id: number, cost: Record<number, number>, count = 1): number {
  const kind = kindOf(id);
  if (kind === 'building') return buildTime(cost, v.levels[ROBOT_FACTORY] ?? 0, v.levels[NANITE_FACTORY] ?? 0, m.buildingSpeed);
  if (kind === 'research') {
    const labs = labLevels(id, v.levels[RESEARCH_LAB] ?? 0, m.otherLabs, v.research[RESEARCH_NETWORK] ?? 0);
    return researchTime(cost, labs, m.researchSpeed, v.levels[TECHNO_DOME] ?? 0, m.problem.hub.universityFactor);
  }
  return count * shipyardTime(buildingCost(id, 1), v.levels[SHIPYARD] ?? 0, v.levels[NANITE_FACTORY] ?? 0, m.shipyardSpeed);
}

/** Seconds until `cost` is there at `rate` (Infinity: never at this production). */
export function gatherTime(res: Record<number, number>, rate: Record<number, number>, cost: Record<number, number>): number {
  let t = 0;
  for (const r of RES) {
    const need = (cost[r] ?? 0) - res[r];
    if (need <= 1e-9) continue;
    if (rate[r] <= 0) return Infinity;
    t = Math.max(t, (need / rate[r]) * 3600);
  }
  return t;
}

/** Cost of what is left of the targets from the view's levels. */
export function remainingCost(m: Model, v: View): Record<number, number> {
  const out = { 901: 0, 902: 0, 903: 0 };
  for (const [key, target] of Object.entries(m.problem.targets)) {
    const id = Number(key);
    const kind = kindOf(id);
    const have = levelIn(v, id);
    if (have >= target) continue;
    if (kind === 'ship' || kind === 'defense') {
      const c = costOf(m, v, id, target - have);
      for (const r of RES) out[r] += c[r] ?? 0;
      continue;
    }
    for (let level = have + 1; level <= target; level++) {
      const c = buildingCost(id, level, m.catchUp);
      for (const r of RES) out[r] += c[r] ?? 0;
    }
  }
  return out;
}

/** The view after `id` is built (`count` units): its cost paid, its level counted. */
export function project(m: Model, v: View, id: number, cost: Record<number, number>, count = 1): View {
  const out: View = { levels: { ...v.levels }, research: { ...v.research }, res: { ...v.res }, factors: v.factors };
  for (const r of RES) out.res[r] -= cost[r] ?? 0;
  if (kindOf(id) === 'research') out.research[id] = (out.research[id] ?? 0) + 1;
  else out.levels[id] = (out.levels[id] ?? 0) + count;
  return out;
}

/** pr0plan `scoreCandidate`: own wait + build time + the rest's wait at the production afterwards. */
export function scoreOf(m: Model, v: View, cost: Record<number, number>, duration: number, after: View): number {
  const own = gatherTime(v.res, rateOf(m, v), cost);
  if (own === Infinity) return Infinity;
  return own + duration + gatherTime(after.res, rateOf(m, after), remainingCost(m, after));
}

/**
 * With a mine ratio: the mine to build before `id` so the mines stay within it (crystal before a metal mine that
 * would leave it too far behind, deuterium before such a crystal mine), else `id`.
 */
export function ratioFirst(m: Model, v: View, id: number): number {
  const r = m.problem.mineRatio;
  if (!r) return id;
  const lv = (x: number) => v.levels[x] ?? 0;
  let pick = id;
  for (let guard = 0; guard < 3; guard++) {
    if (pick === 1 && lv(1) + 1 - lv(2) > r.crystalBelowMetal + r.tolerance) pick = 2;
    else if (pick === 2 && lv(2) + 1 - lv(3) > r.deutBelowCrystal + r.tolerance) pick = 3;
    else break;
  }
  return pick;
}

const MINE_OF: Record<number, number> = { 901: 1, 902: 2, 903: 3 };

/**
 * Deviation from pr0plan (whose planets always have every resource): a step that needs a resource the planet has too
 * little of and no income of (a new planet: no deuterium, no synthesizer, but the robotics factory costs 200) can never
 * start. Then its mine comes first, and the solar plant first where the mine would have no energy. Returns the element
 * to build before `id` (its `cost`), else `id`.
 */
export function incomeFirst(m: Model, v: View, id: number, cost: Record<number, number>): number {
  if (m.problem.planetType === 'moon') return id;
  const rate = rateOf(m, v);
  for (const r of RES) {
    if ((cost[r] ?? 0) <= (v.res[r] ?? 0) || rate[r] > 0) continue;
    const mine = MINE_OF[r];
    if (!m.problem.economy.includes(mine) || !requirementsMet(v, mine)) continue;
    if ((v.levels[mine] ?? 0) > 0 && energyOf(m, v) < 0 && m.problem.economy.includes(SOLAR_PLANT)) return SOLAR_PLANT;
    if ((v.levels[mine] ?? 0) === 0) return mine;
  }
  return id;
}

/** Whether the requirements of `id` are met by the planned levels. */
export function requirementsMet(v: View, id: number): boolean {
  return Object.entries(requirementsOfElement(id)).every(([r, need]) => levelIn(v, Number(r)) + (v.pending?.[Number(r)] ?? 0) >= need);
}

const ENERGY_CONSUMERS = [1, 2, 3];

/**
 * The best economy building now (pr0plan `findBestEconomyCandidate`): each scored alone, and a mine that would leave
 * the energy short also bundled with the solar plant levels that cover it (the mine is still the step taken: it
 * starts producing, if throttled, as soon as it is done; the solar plant wins on its own at a later decision).
 */
export function bestEconomy(m: Model, v: View): { element: number; score: number } | null {
  let best: { element: number; score: number } | null = null;
  const solar = m.problem.economy.includes(SOLAR_PLANT);
  for (const id of m.problem.economy) {
    if (!PRODUCERS.includes(id) || !requirementsMet(v, id)) continue;
    const cost = costOf(m, v, id);
    const duration = durationOf(m, v, id, cost);
    const after = project(m, v, id, cost);
    let score = scoreOf(m, v, cost, duration, after);
    if (solar && ENERGY_CONSUMERS.includes(id) && energyOf(m, v) >= 0) {
      // only without a deficit already: else a bundle always looks better than fixing it and the fix never comes
      let topped = after;
      for (let i = 0; i < 50 && energyOf(m, topped) < 0; i++) topped = project(m, topped, SOLAR_PLANT, costOf(m, topped, SOLAR_PLANT));
      if (topped !== after) score = Math.min(score, scoreOf(m, v, cost, duration, topped));
    }
    if (score < Infinity && (!best || score < best.score)) best = { element: id, score };
  }
  return best;
}
