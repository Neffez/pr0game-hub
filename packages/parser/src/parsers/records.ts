import type { CheerioAPI } from 'cheerio';
import { idByName } from '../tech.js';
import type { RecordsRecord } from '../types.js';
import { parseNumber } from '../util.js';
import { pageTime } from './empire.js';

/**
 * The game's records page (page=records, `ShowRecordsPage`): per building, research, ship and defense the players with
 * the highest level and that level, rebuilt with each statistics update. The catch-up bonus compares the level built
 * with these records (`getCatchUpFactorForElement`), so only buildings and research are kept.
 */

export const isRecordsHtml = ($: CheerioAPI): boolean => $('table.recordtable').length > 0;

/** Rows "element | players | level | own": the element's `Dialog.info(<id>)` link and its record level ("-": none). */
export function parseRecordsHtml($: CheerioAPI): RecordsRecord | null {
  const levels: Record<number, number> = {};
  $('table.recordtable tr').each((_, tr) => {
    const cells = $(tr).children('td');
    if (cells.length < 3) return;
    // the `Dialog.info(<id>)` link, else the name (a copy of the page keeps no onclick)
    const id = Number(cells.eq(0).find('a[onclick*="Dialog.info"]').first().attr('onclick')?.match(/Dialog\.info\((\d+)\)/)?.[1]) || idByName(cells.eq(0).text().trim());
    // buildings and research only (ships and defense get no catch-up bonus)
    if (!id || id >= 200) return;
    const text = cells.eq(2).text().trim();
    // nobody has the element: no record, and the game then grants no bonus for it
    const level = text === '-' ? 0 : parseNumber(text);
    if (level != null) levels[id] = level;
  });
  if (!Object.keys(levels).length) return null;
  return { kind: 'records', pageTime: pageTime($), levels };
}
