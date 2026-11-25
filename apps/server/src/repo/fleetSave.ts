import { fleetSaveTime, positionTemp, SOLAR_SATELLITE } from '@pr0hub/core/production';
import { CLASS_BUILDINGS, CLASS_FLEET, CLASS_RESEARCH, CLASS_RESOURCES } from '@pr0hub/core/tech';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { economyOf } from './economy.js';

type Sections = Record<string, Record<string, number>>;

/** A spy report as the lists load it (sections parsed). */
export interface SpyRow {
  id: number;
  g: number;
  s: number;
  p: number;
  planet_type: string;
  player_id: number | null;
  report_time: number;
  sections: Sections;
}

/** When a spied player last took all metal and crystal from the planet (see `fleetSaveTime`), absolute times. */
export interface FleetSaveGuess {
  /** earliest and latest second of the departure (epoch seconds) */
  from: number;
  to: number;
  /** deuterium points to the same second too; null when it cannot tell */
  deuterium: boolean | null;
  /** production per hour the calculation used (metal, crystal, deuterium) */
  perHour: { 901: number; 902: number; 903: number };
  /** report time of the buildings used (the report itself or the nearest one of the position) */
  buildingsTime: number;
  /** report time of the research used; null when none is known (calculated without mining research) */
  researchTime: number | null;
}

/**
 * Fleet save guesses for spy reports of planets: the mine, power plant and storage levels of the report or of the
 * position's report with buildings nearest before it (else after), satellites of that report, the player's research
 * likewise, the position bonus of the universe and its resource speed. Null for moons, reports without resources and
 * when metal and crystal do not point to the same second.
 */
export function fleetSaveGuesses<T extends SpyRow>(db: DB, ctx: GroupContext, rows: T[]): (T & { fleetSave: FleetSaveGuess | null })[] {
  const g = ctx.groupId;
  const settings = ctx.universe.settings;
  let economy: ReturnType<typeof economyOf> | null = null;
  // nearest report with the section: the newest at or before the time, else the oldest after it
  const nearestAt = db.prepare(
    `SELECT report_time, sections FROM spy_reports
     WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = 'planet' AND json_extract(sections, '$."${CLASS_BUILDINGS}"') IS NOT NULL
     ORDER BY report_time > ?, ABS(report_time - ?) LIMIT 1`,
  );
  const nearestResearch = db.prepare(
    `SELECT report_time, sections FROM spy_reports
     WHERE group_id = ? AND player_id = ? AND json_extract(sections, '$."${CLASS_RESEARCH}"') IS NOT NULL
     ORDER BY report_time > ?, ABS(report_time - ?) LIMIT 1`,
  );
  const research = new Map<string, { time: number; values: Record<string, number> } | null>();
  return rows.map((r) => {
    const resources = r.sections[CLASS_RESOURCES];
    if (r.planet_type !== 'planet' || !resources) return { ...r, fleetSave: null };
    let built: { time: number; sections: Sections } | null = r.sections[CLASS_BUILDINGS] ? { time: r.report_time, sections: r.sections } : null;
    if (!built) {
      const row = nearestAt.get(g, r.g, r.s, r.p, r.report_time, r.report_time) as { report_time: number; sections: string } | undefined;
      if (row) built = { time: row.report_time, sections: JSON.parse(row.sections) as Sections };
    }
    if (!built) return { ...r, fleetSave: null };
    let tech: { time: number; values: Record<string, number> } | null = r.sections[CLASS_RESEARCH] ? { time: r.report_time, values: r.sections[CLASS_RESEARCH] } : null;
    if (!tech && r.player_id != null) {
      const key = `${r.player_id}:${r.report_time}`;
      if (!research.has(key)) {
        const row = nearestResearch.get(g, r.player_id, r.report_time, r.report_time) as { report_time: number; sections: string } | undefined;
        research.set(key, row ? { time: row.report_time, values: (JSON.parse(row.sections) as Sections)[CLASS_RESEARCH] } : null);
      }
      tech = research.get(key)!;
    }
    economy ??= economyOf(db, ctx);
    const bonus = settings.positionBonus?.[String(r.p)];
    const levels = { ...built.sections[CLASS_BUILDINGS], [SOLAR_SATELLITE]: (r.sections[CLASS_FLEET] ?? built.sections[CLASS_FLEET])?.[SOLAR_SATELLITE] ?? 0 };
    const res = fleetSaveTime({
      resources,
      levels,
      research: tech?.values,
      temp: positionTemp(r.p),
      resourceSpeed: economy.resourceSpeed,
      storageFactor: economy.storageFactor,
      bonus: bonus ? { 901: bonus[0], 902: bonus[1], 903: bonus[2] } : undefined,
    });
    if (!res) return { ...r, fleetSave: null };
    return {
      ...r,
      fleetSave: {
        from: r.report_time - res.ago.max,
        to: r.report_time - res.ago.min,
        deuterium: res.deuterium,
        perHour: { 901: Math.round(res.perHour[901]), 902: Math.round(res.perHour[902]), 903: Math.round(res.perHour[903]) },
        buildingsTime: built.time,
        researchTime: tech?.time ?? null,
      },
    };
  });
}
