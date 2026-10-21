import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { GalaxyRecord, GalaxyRow, PlayerStatus } from '../types.js';
import { parseNumber } from '../util.js';

const STATUS_CLASSES: PlayerStatus[] = ['inactive', 'longinactive', 'vacation', 'banned', 'noob', 'strong'];

export function isGalaxyHtml($: CheerioAPI): boolean {
  return $('.galaxy-grid-row[data-info^="p_"]').length > 0;
}

/** `url` is used as fallback for galaxy/system when the inputs are not part of the copied HTML. */
export function parseGalaxyHtml($: CheerioAPI, url?: string): GalaxyRecord | null {
  let g = parseNumber($('input[name=galaxy]').attr('value'));
  let s = parseNumber($('input[name=system]').attr('value'));
  if (g == null || s == null) {
    const key = $.html().match(/galakey\s*=\s*"(\d+):(\d+)"/);
    if (key) [g, s] = [Number(key[1]), Number(key[2])];
  }
  if ((g == null || s == null) && url) {
    try {
      const q = new URL(url, 'https://pr0game.com/').searchParams;
      g = parseNumber(q.get('galaxy'));
      s = parseNumber(q.get('system'));
    } catch {
      /* invalid url: no fallback */
    }
  }
  if (g == null || s == null) return null;

  const rows: GalaxyRow[] = [];
  $('.galaxy-grid-row[data-info^="p_"]').each((_, el) => {
    const row = $(el);
    const position = Number((row.attr('data-info') ?? '').slice(2));
    const player = row.find('span[playerid]').first();
    const destroyed = row.hasClass('empty') && row.find('.span2').text().trim().length > 0;
    if (!player.length && !destroyed) {
      const debris = parseDebris(row.find('.galaxy-debris'));
      if (debris) rows.push(emptyRow(position, debris));
      return;
    }
    const status: PlayerStatus[] = [];
    row.find('span.galaxy-short').each((_, sp) => {
      for (const c of ($(sp).attr('class') ?? '').split(/\s+/)) {
        const st = c.replace('galaxy-short-', '') as PlayerStatus;
        if (c.startsWith('galaxy-short-') && STATUS_CLASSES.includes(st)) status.push(st);
      }
    });
    const ally = row.find('a[allyid]').first();
    const planetLink = row.find('.galaxy-planet a').first();
    const moonImg = row.find('.galaxy-moon img').first();
    rows.push({
      position,
      planetName: destroyed ? '' : planetLink.text().replace(/\s*\((\*|\d+\s*min)\)\s*$/, '').trim(),
      moon: moonImg.length > 0,
      moonName: moonImg.attr('alt')?.trim() || null,
      destroyed,
      playerId: parseNumber(player.attr('playerid')),
      playerName: player.text().trim() || null,
      status,
      allyId: parseNumber(ally.attr('allyid')),
      allyTag: ally.length ? ally.text().trim().replace(/^\[|\]$/g, '') : null,
      debris: parseDebris(row.find('.galaxy-debris')),
    });
  });
  return { kind: 'galaxy', g, s, rows };
}

function emptyRow(position: number, debris: GalaxyRow['debris']): GalaxyRow {
  return {
    position, planetName: '', moon: false, destroyed: false, playerId: null, playerName: null,
    status: [], allyId: null, allyTag: null, debris,
  };
}

/**
 * Debris of a galaxy row: exact amounts from the tooltip ("Metall: 0 / Kristall: 3.000"),
 * otherwise the abbreviated cell text ("0 / 3 k").
 */
function parseDebris(cell: Cheerio<AnyNode>): GalaxyRow['debris'] {
  const tooltip = cell.find('[data-tooltip-content]').first().attr('data-tooltip-content') ?? '';
  const metal = tooltip.match(/(?:Metall|Metal):\s*<\/td>\s*<td>\s*([\d.,]+)/i);
  const crystal = tooltip.match(/(?:Kristall|Crystal):\s*<\/td>\s*<td>\s*([\d.,]+)/i);
  if (metal && crystal) return { metal: metal[1], crystal: crystal[1] };
  const m = cell.text().match(/([\d.,]+\s*[KMB]?)\s*\/\s*([\d.,]+\s*[KMB]?)/i);
  return m ? { metal: m[1].replace(/\s/g, ''), crystal: m[2].replace(/\s/g, '') } : null;
}
