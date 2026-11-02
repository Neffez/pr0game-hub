/**
 * Resource production of a planet like the game's `ResourceUpdate::ReBuildCache` with the formulas of the `vars`
 * table: mines, solar and fusion power plant, solar satellites, the energy factor when energy is short, the mining
 * research (131-133, +2 % per level), the resource multiplier and the basic income. The hub otherwise takes production
 * from synced pages; this is for planning levels that are not built yet (build orders).
 */

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
