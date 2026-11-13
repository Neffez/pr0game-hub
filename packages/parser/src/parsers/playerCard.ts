import type { CheerioAPI } from 'cheerio';
import type { PlayerCardRecord } from '../types.js';
import { COORDS_RE, normalizeText, parseCoords } from '../util.js';

const NAME = /^Username$/i;
const HOME = /^(Heimatplanet|Home planet)$/i;
const ALLY = /^(Allianz|Alliance)$/i;

/** Player profile popup: home planet row plus the Username label of the card. */
export function isPlayerCardText(text: string): boolean {
  return /(Heimatplanet|Home planet)/i.test(text) && /(^|\n)Username(\t| )/m.test(text) && COORDS_RE.test(text);
}

export function isPlayerCardHtml($: CheerioAPI): boolean {
  if ($('body#playerCard, body#playercard').length) return true;
  return cellAfter($, NAME) != null && cellAfter($, HOME) != null && parseCoords(cellAfter($, HOME) ?? '') != null;
}

export function parsePlayerCardHtml($: CheerioAPI): PlayerCardRecord | null {
  const rec = fromCells((label) => cellAfter($, label), $.html());
  return rec;
}

export function parsePlayerCardText(text: string): PlayerCardRecord | null {
  return fromCells((label) => cellAfterText(text, label), text);
}

function fromCells(value: (label: RegExp) => string | null, source: string): PlayerCardRecord | null {
  const name = value(NAME);
  const home = value(HOME);
  const coords = home ? parseCoords(home) : null;
  if (!name || !home || !coords) return null;
  const allyRaw = value(ALLY);
  const allyName = !allyRaw || allyRaw === '-' ? null : allyRaw.replace(/\s+/g, ' ').trim();
  return {
    kind: 'playerCard',
    ingameId: playerId(source),
    name,
    planetName: home.replace(COORDS_RE, '').replace(/\s+/g, ' ').trim() || null,
    coords,
    allyId: allyId(source),
    allyName,
  };
}

/** Label of a copied table row: the next tab cell, or the rest of the line after the label (spaces when tabs were lost). */
function cellAfterText(text: string, label: RegExp): string | null {
  const start = new RegExp(`^(?:${label.source.replace(/^\^/, '').replace(/\$$/, '')})[\\t ]+(.+)$`, label.flags);
  for (const line of text.split('\n')) {
    const cells = line.split('\t').map((c) => c.trim());
    const i = cells.findIndex((c) => label.test(c));
    if (i >= 0) {
      const rest = cells.slice(i + 1).find((c) => c.length > 0 && !label.test(c));
      if (rest) return rest;
    }
    const m = line.trim().match(start);
    if (m) return m[m.length - 1].trim();
  }
  return null;
}

function cellAfter($: CheerioAPI, label: RegExp): string | null {
  let found: string | null = null;
  $('tr').each((_, tr) => {
    if (found) return;
    const cells = $(tr)
      .children('td, th')
      .toArray()
      .map((td) => normalizeText($(td).text()).replace(/\s+/g, ' '));
    const i = cells.findIndex((c) => label.test(c));
    if (i < 0) return;
    const rest = cells.slice(i + 1).find((c) => c.length > 0 && !label.test(c));
    if (rest) found = rest;
  });
  return found;
}

/** In-game id from PM/Buddy links or the card URL, not from achievement icons (`Dialog.ach`). */
function playerId(source: string): number | null {
  const m = source.match(/Dialog\.(?:PM|Buddy)\((\d+)/) ?? source.match(/page=playerCard[^"'<\s]*[?&]id=(\d+)/i);
  return m ? Number(m[1]) : null;
}

function allyId(source: string): number | null {
  const m = source.match(/page=alliance[^"'<\s]*[?&;]id=(\d+)/i);
  return m ? Number(m[1]) : null;
}
