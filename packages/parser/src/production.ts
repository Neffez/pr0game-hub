/**
 * Resource production of a planet like the game's `ResourceUpdate::ReBuildCache` with the formulas of the `vars`
 * table: mines, solar and fusion power plant, solar satellites, the energy factor when energy is short, the mining
 * research (131-133, +2 % per level), the resource multiplier and the basic income. The hub otherwise takes production
 * from synced pages; this is for planning levels that are not built yet (build orders).
 */

import { STORAGE, storageCapacity } from './tech.js';

export const METAL_MINE = 1;
export const CRYSTAL_MINE = 2;
export const DEUTERIUM_SYNTHESIZER = 3;
export const SOLAR_PLANT = 4;
export const FUSION_REACTOR = 12;
export const SOLAR_SATELLITE = 212;
export const ENERGY_TECH = 113;

/** Elements with a production setting on the game's resources page. */
export const PRODUCERS = [METAL_MINE, CRYSTAL_MINE, DEUTERIUM_SYNTHESIZER, SOLAR_PLANT, FUSION_REACTOR, SOLAR_SATELLITE];

/** Game defaults of `metal_basic_income`, `crystal_basic_income`, `deuterium_basic_income` (per hour at 1x). */
export const BASIC_INCOME: Record<number, number> = { 901: 20, 902: 10, 903: 0 };

export interface ProductionInput {
  /** building levels and the number of solar satellites (212) */
  levels: Record<string, number>;
  /** research levels of the account (113 energy, 131-133 mining) */
  research: Record<string, number>;
  /** max temperature of the planet */
  temp: number;
  /** production setting per producer, 0 … 1 (game: 0 … 10 × 10 %); default 1 */
  factors?: Record<string, number>;
  /** resource multiplier as a factor (game `resource_multiplier` / 2500) */
  resourceSpeed: number;
  /** game `energy_multiplier`, default 1 */
  energySpeed?: number;
  basicIncome?: Record<number, number>;
}

export interface Production {
  /** metal, crystal, deuterium per hour (basic income included) */
  901: number;
  902: number;
  903: number;
  /** energy produced and used (positive), like the game's resource bar */
  energy: number;
  energyUsed: number;
}

/** Production per hour of a planet. */
export function productionOf(i: ProductionInput): Production {
  const lvl = (id: number) => i.levels[id] ?? 0;
  const f = (id: number) => i.factors?.[id] ?? 1;
  const tech = (id: number) => i.research[id] ?? 0;
  const grow = (base: number, l: number) => base * l * Math.pow(1.1, l);

  const plus = { 901: 0, 902: 0, 903: 0, 911: 0 };
  const minus = { 901: 0, 902: 0, 903: 0, 911: 0 };
  const m = lvl(METAL_MINE);
  plus[901] += grow(30, m) * f(METAL_MINE);
  minus[911] += grow(10, m) * f(METAL_MINE);
  const c = lvl(CRYSTAL_MINE);
  plus[902] += grow(20, c) * f(CRYSTAL_MINE);
  minus[911] += grow(10, c) * f(CRYSTAL_MINE);
  const d = lvl(DEUTERIUM_SYNTHESIZER);
  plus[903] += Math.floor(grow(10, d) * (1.44 - 0.004 * i.temp)) * f(DEUTERIUM_SYNTHESIZER);
  minus[911] += grow(20, d) * f(DEUTERIUM_SYNTHESIZER);
  plus[911] += grow(20, lvl(SOLAR_PLANT)) * f(SOLAR_PLANT);
  const fu = lvl(FUSION_REACTOR);
  minus[903] += grow(10, fu) * f(FUSION_REACTOR);
  plus[911] += 30 * fu * Math.pow(1.05 + tech(ENERGY_TECH) * 0.01, fu) * f(FUSION_REACTOR);
  plus[911] += ((i.temp + 160) / 6) * f(SOLAR_SATELLITE) * lvl(SOLAR_SATELLITE);

  const es = i.energySpeed ?? 1;
  const energy = Math.round(plus[911] * es);
  const energyUsed = minus[911] * es;
  const income = i.basicIncome ?? BASIC_INCOME;
  const out: Production = { 901: 0, 902: 0, 903: 0, energy, energyUsed };
  const level = energyUsed === 0 ? 0 : Math.min(1, energy / energyUsed);
  ([901, 902, 903] as const).forEach((r, k) => {
    const mine = energyUsed === 0 ? 0 : (plus[r] * (1 + 0.02 * tech(131 + k)) * level - minus[r]) * i.resourceSpeed;
    out[r] = mine + (income[r] ?? 0) * i.resourceSpeed;
  });
  return out;
}

/**
 * Factor per resource between the production a synced page showed and the formula for the same levels: it carries
 * what the hub does not know (production settings, planet bonus) over to planned levels. 1 when either is 0.
 */
export function calibrate(synced: Record<string, number>, formula: Production): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of [901, 902, 903] as const) {
    const s = synced[r];
    const p = formula[r];
    out[r] = s != null && p > 0 && s > 0 ? s / p : 1;
  }
  return out;
}

/**
 * Max temperature range per position as the game's default `planet_data` (install.sql): a new colony gets a random
 * max temperature within it, the min temperature is 40 °C lower.
 */
export const POSITION_TEMP: Record<number, readonly [number, number]> = {
  1: [220, 260], 2: [170, 210], 3: [120, 160], 4: [70, 110], 5: [60, 100], 6: [50, 90], 7: [40, 80], 8: [30, 70],
  9: [20, 60], 10: [10, 50], 11: [0, 40], 12: [-10, 30], 13: [-50, -10], 14: [-90, -50], 15: [-130, -90],
};

/** Expected max temperature of a planet at `position` (the middle of its range; unknown positions count as 8). */
export function positionTemp(position: number): number {
  const [min, max] = POSITION_TEMP[position] ?? POSITION_TEMP[8];
  return Math.floor((min + max) / 2);
}

export interface ProjectionInput {
  /** metal, crystal, deuterium seen (e.g. in a spy report) */
  resources: Record<number, number>;
  /** building levels and the number of solar satellites (212) */
  levels: Record<string, number>;
  /** research levels (113 energy, 131-133 mining); unknown = 0 */
  research?: Record<string, number>;
  /** max temperature; `positionTemp` when unknown */
  temp: number;
  /** resource multiplier as a factor (game `resource_multiplier` / 2500) */
  resourceSpeed: number;
  /** storage capacity factor of the universe (game `storage_multiplier`), default 1 */
  storageFactor?: number;
  /** hours since the resources were seen */
  hours: number;
  /** production setting per producer, 0 … 1; default 1 (inactive players rarely change it) */
  factors?: Record<string, number>;
}

export interface Projection {
  /** expected metal, crystal, deuterium after `hours` */
  resources: Record<901 | 902 | 903, number>;
  /** production per hour used */
  perHour: Record<901 | 902 | 903, number>;
  /** storage capacity per resource */
  capacity: Record<901 | 902 | 903, number>;
  /** the storage is full (production stopped) */
  full: Record<901 | 902 | 903, boolean>;
}

/**
 * Resources of a planet some hours after they were seen, like the game's `ResourceUpdate`: production per hour from
 * the levels, which stops at the storage capacity; resources already above it (loot, transports) stay.
 */
export function projectResources(i: ProjectionInput): Projection {
  const prod = productionOf({ levels: i.levels, research: i.research ?? {}, temp: i.temp, factors: i.factors, resourceSpeed: i.resourceSpeed });
  const hours = Math.max(0, i.hours);
  const out: Projection = { resources: { 901: 0, 902: 0, 903: 0 }, perHour: { 901: 0, 902: 0, 903: 0 }, capacity: { 901: 0, 902: 0, 903: 0 }, full: { 901: false, 902: false, 903: false } };
  for (const r of [901, 902, 903] as const) {
    const seen = Math.max(0, i.resources[r] ?? 0);
    const capacity = storageCapacity(i.levels[STORAGE[r]] ?? 0, i.storageFactor ?? 1);
    const perHour = Math.max(0, prod[r]);
    out.perHour[r] = perHour;
    out.capacity[r] = capacity;
    out.resources[r] = seen >= capacity ? seen : Math.min(capacity, seen + perHour * hours);
    out.full[r] = out.resources[r] >= capacity;
  }
  return out;
}

/**
 * The universe's resource multiplier (as a factor) from synced production: per planet the metal per hour a page
 * showed against the formula at 1x for the same levels; the median of the planets, rounded to 0.01. Null without
 * a planet that tells (no production shown, no temperature, no metal mine, not enough energy for the known levels).
 */
export function deriveResourceSpeed(planets: { levels: Record<string, number>; research: Record<string, number>; temp?: number | null; perHour?: Record<number, number> }[]): number | null {
  const ratios: number[] = [];
  for (const p of planets) {
    const shown = p.perHour?.[901];
    if (shown == null || shown <= 0 || p.temp == null || !(p.levels[METAL_MINE] > 0)) continue;
    // the production settings are unknown here: only full production on every producer tells, and only with enough
    // energy (a page without the power plants would make the formula's mines produce nothing)
    const formula = productionOf({ levels: p.levels, research: p.research, temp: p.temp, resourceSpeed: 1 });
    if (formula.energyUsed > 0 && formula.energy >= formula.energyUsed && formula[901] > 0) ratios.push(shown / formula[901]);
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  const mid = ratios[Math.floor(ratios.length / 2)];
  return Math.round(mid * 100) / 100;
}
