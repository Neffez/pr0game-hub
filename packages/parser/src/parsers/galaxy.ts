import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { GalaxyRecord, GalaxyRow, PlayerStatus } from '../types.js';
import { parseNumber } from '../util.js';
import { STATUS_LETTERS, statusFromSpans } from './stats.js';

/** Activity mark behind the planet name: "(*)" or "(15 min)". */
const ACTIVITY_RE = /\s*\((\*|\d+\s*min)\)\s*$/;

/** Minutes of the activity mark behind a planet name: 0 for "(*)", null without a mark. */
function activityOf(name: string): number | null {
  const m = name.match(ACTIVITY_RE);
  return m ? (m[1] === '*' ? 0 : parseInt(m[1], 10)) : null;
}

/** Moon diameter from the moon's tooltip (data-tooltip-content, row "Durchmesser"/"Diameter"); null without one. */
function moonDiameterOf(tooltip: string | undefined): number | null {
  const m = tooltip?.replace(/<[^>]*>/g, ' ').match(/(?:Durchmesser|Diameter)\s*:?\s*([\d.,]+)/i);
  return m ? parseNumber(m[1]) || null : null;
}

export function isGalaxyHtml($: CheerioAPI): boolean {
  return $('.galaxy-grid-row[data-info^="p_"]').length > 0;
}

/** `url`, then `system` (user input) are the fallback for galaxy/system when the inputs are not part of the copied HTML. */
export function parseGalaxyHtml($: CheerioAPI, url?: string, system?: { g: number; s: number } | null): GalaxyRecord | null {
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
  if ((g == null || s == null) && system) [g, s] = [system.g, system.s];
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
    const status = statusFromSpans($, row);
    const ally = row.find('a[allyid]').first();
    const planetLink = row.find('.galaxy-planet a').first();
    const moonImg = row.find('.galaxy-moon img').first();
    rows.push({
      position,
      planetName: destroyed ? '' : planetLink.text().replace(ACTIVITY_RE, '').trim(),
      moon: moonImg.length > 0,
      moonName: moonImg.attr('alt')?.trim() || null,
      moonDiameter: moonImg.length > 0 ? moonDiameterOf(row.find('.galaxy-moon [data-tooltip-content]').first().attr('data-tooltip-content')) : null,
      destroyed,
      playerId: parseNumber(player.attr('playerid')),
      playerName: player.text().trim() || null,
      status,
      allyId: parseNumber(ally.attr('allyid')),
      allyTag: ally.length ? ally.text().trim().replace(/^\[|\]$/g, '') : null,
      debris: parseDebris(row.find('.galaxy-debris')),
      activity: destroyed ? null : activityOf(planetLink.text().trim()),
    });
  });
  return { kind: 'galaxy', g, s, rows };
}

/** Copied galaxy view: the column header "Spieler (Status) [Allianz]" is part of the text. */
export function isGalaxyText(text: string): boolean {
  return /^(?:Spieler|Player) \(Status\) \[(?:Allianz|Alliance)\]$/m.test(text);
}

/** "g:s" (or "g:s:p") typed by the user. */
export function parseSystem(raw: string | null | undefined): { g: number; s: number } | null {
  const m = raw?.trim().match(/^\[?(\d{1,2})\s*:\s*(\d{1,3})(?::\d{1,2})?\]?$/);
  return m ? { g: Number(m[1]), s: Number(m[2]) } : null;
}

const DEBRIS_RE = /^([\d.,]+\s*[KMB]?)\s*\/\s*([\d.,]+\s*[KMB]?)$/i;
const DESTROYED_RE = /^(?:Planet zerstört|Planet destroyed)$/i;
/** Expedition (16) and trade zone (17) rows below the planets. */
const SPECIAL_RE = /unendlichen Weiten|Handelszone|infinite|endless|trad(?:e|ing) zone/i;
const STATUS_RE = /^\(([A-Za-z ]+)\)$/;

/**
 * Plain-text galaxy view. The galaxy/system inputs are not part of a copy, so `system` comes from the user.
 * One line per cell, a row starts with its position: planet name (with activity), moon name, debris,
 * player, "(status)", "[ally]". The player has no id, the hub matches the name.
 */
export function parseGalaxyText(text: string, system: { g: number; s: number }): GalaxyRecord | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => isGalaxyText(l));
  if (start < 0) return null;

  // Cells of each position; a line equal to the next position number starts the next row
  // (planet or player names like "4" are fine as long as they are not the next position).
  const cells: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (/Planeten besiedelt|planets colonized|^Legende$|^Legend$/i.test(line)) break;
    if (line === String(cells.length + 1)) cells.push([]);
    else cells[cells.length - 1]?.push(line);
  }

  const rows: GalaxyRow[] = [];
  cells.forEach((row, i) => {
    const position = i + 1;
    let rest = row.filter((l) => l !== '-');
    if (!rest.length || SPECIAL_RE.test(rest[0])) return;
    let allyTag: string | null = null;
    let status: PlayerStatus[] = [];
    const last = () => rest[rest.length - 1] ?? '';
    if (/^\[.+\]$/.test(last())) allyTag = rest.pop()!.slice(1, -1);
    const st = last().match(STATUS_RE);
    if (st) {
      rest.pop();
      status = st[1].split(/\s+/).map((s) => STATUS_LETTERS[s]).filter((s): s is PlayerStatus => !!s);
    }
    const debrisIdx = rest.findIndex((l) => DEBRIS_RE.test(l));
    const dm = debrisIdx >= 0 ? rest[debrisIdx].match(DEBRIS_RE) : null;
    const debris = dm ? { metal: dm[1].replace(/\s/g, ''), crystal: dm[2].replace(/\s/g, '') } : null;
    if (debrisIdx >= 0) rest = rest.filter((_, j) => j !== debrisIdx);

    if (rest.length && DESTROYED_RE.test(rest[0])) {
      rows.push({ ...emptyRow(position, debris), destroyed: true, moon: false, moonName: null });
      return;
    }
    // planet, [moon], player
    if (rest.length < 2) {
      if (debris) rows.push(emptyRow(position, debris));
      return;
    }
    const moonName = rest.length >= 3 ? rest[1] : null;
    rows.push({
      position,
      planetName: rest[0].replace(ACTIVITY_RE, '').trim(),
      moon: moonName != null,
      moonName,
      destroyed: false,
      playerId: null,
      playerName: rest[rest.length - 1],
      status,
      allyId: null,
      allyTag,
      debris,
      activity: activityOf(rest[0]),
    });
  });
  return { kind: 'galaxy', g: system.g, s: system.s, rows };
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
