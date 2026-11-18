import * as cheerio from 'cheerio/slim';
import type { CheerioAPI } from 'cheerio';
import type { Coords } from '../util.js';
import { isBuildingsHtml, isResearchHtml, parseBuildingsHtml, parseResearchHtml } from './buildings.js';

/**
 * Levels of one planet and the account's research from the pasted source of the game's buildings or research page,
 * for the tools (the auto plan starts a planet from them). A small entry point on `cheerio/slim` so the tools load
 * the page parser only when a page is pasted, without the whole `parsePage`.
 */

export interface PlanetPage {
  kind: 'buildings' | 'research';
  coords: Coords;
  type: 'planet' | 'moon';
  /** element id -> level, with the levels of the queue counted as built (a level torn down as one less) */
  levels: Record<number, number>;
  /** resources of the resource bar (901-903) */
  resources: Record<number, number>;
}

/** The buildings or research page in `html` (its source), else null. */
export function parsePlanetPage(html: string): PlanetPage | null {
  if (!/<(html|body|div)[\s>]/i.test(html.slice(0, 20000))) return null;
  const $ = cheerio.load(html, { xml: { xmlMode: false, decodeEntities: true } }) as unknown as CheerioAPI;
  const rec = isBuildingsHtml($) ? parseBuildingsHtml($) : isResearchHtml($) ? parseResearchHtml($) : null;
  if (!rec) return null;
  const levels: Record<number, number> = {};
  for (const e of rec.kind === 'buildings' ? rec.buildings : rec.research) levels[e.id] = e.level;
  for (const q of rec.queue) {
    const after = 'destroy' in q && q.destroy ? q.level - 1 : q.level;
    levels[q.id] = 'destroy' in q && q.destroy ? Math.min(levels[q.id] ?? after, after) : Math.max(levels[q.id] ?? 0, after);
  }
  return { kind: rec.kind, coords: rec.coords, type: rec.type, levels, resources: { ...rec.resources } };
}
