import { withUnits, type UnitCatalog } from '@pr0hub/core/units';
import { threatOutcome, type DefenseRate, type DefenseThreat, type ThreatOutcome } from './defense.js';
import type { BattleFleet } from './input.js';
import { DEFAULT_SIM_SETTINGS, type Fight, type SimSettings } from './simulate.js';
import type { Resources } from './steal.js';

/**
 * Raid risk: per planet the expected profit of the known attackers against the planet as it is (no search), the worst
 * of them is the planet's risk. Few runs per battle, as many as the engine budget allows for all planets together.
 */
export interface RiskPlanet {
  key: string;
  planet: BattleFleet;
  resources: Resources;
  threats: DefenseThreat[];
}

export interface RiskInput {
  planets: RiskPlanet[];
  rate: DefenseRate;
  debris: boolean;
  /** most runs per battle */
  runs: number;
  /** most pieces × runs of all battles */
  work: number;
}

export interface PlanetRisk {
  key: string;
  outcomes: ThreatOutcome[];
  /** the most profitable attack (null without threats or when all were skipped) */
  worst: ThreatOutcome | null;
  /** battles left out for the engine budget */
  skipped: number;
}

export interface RiskResult {
  planets: PlanetRisk[];
  runs: number;
  battles: number;
}

const pieces = (units: Record<string, number>) => Object.values(units).reduce((a, b) => a + Math.max(0, b), 0);

export function raidRisk(fight: Fight, input: RiskInput, settings: SimSettings = DEFAULT_SIM_SETTINGS, units?: UnitCatalog): RiskResult {
  return withUnits(units, () => {
    const per = (p: RiskPlanet, t: DefenseThreat) => pieces(t.units) + pieces(p.planet.units);
    const total = input.planets.reduce((sum, p) => sum + p.threats.reduce((a, t) => a + per(p, t), 0), 0);
    const runs = Math.max(1, Math.min(Math.floor(input.runs), total > 0 ? Math.floor(input.work / total) : input.runs));
    let work = 0;
    let battles = 0;
    const planets = input.planets.map((p): PlanetRisk => {
      const outcomes: ThreatOutcome[] = [];
      let skipped = 0;
      for (const t of p.threats) {
        const cost = per(p, t) * runs;
        if (work + cost > input.work) {
          skipped++;
          continue;
        }
        work += cost;
        battles += runs;
        outcomes.push(threatOutcome(fight, p.planet, p.resources, t, runs, input.rate, input.debris, settings, units));
      }
      const worst = outcomes.reduce<ThreatOutcome | null>((best, o) => (!best || o.profit > best.profit ? o : best), null);
      return { key: p.key, outcomes, worst, skipped };
    });
    return { planets, runs, battles };
  });
}
