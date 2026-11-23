import type { CheerioAPI } from 'cheerio';
import type { PlayerCardCombat, PlayerCardRecord, PlayerCardUnits } from '../types.js';
import { COORDS_RE, normalizeText, parseCoords, parseNumber } from '../util.js';

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
  const lines = $('tr')
    .toArray()
    .map((tr) => $(tr).children('td, th').toArray().map((td) => normalizeText($(td).text()).replace(/\s+/g, ' ').trim()).filter(Boolean).join('\t'));
  return rec && withCombat(rec, lines);
}

export function parsePlayerCardText(text: string): PlayerCardRecord | null {
  const rec = fromCells((label) => cellAfterText(text, label), text);
  return rec && withCombat(rec, text.split('\n'));
}

// fight statistics: the two unit blocks under their headings ("<name> war an folgenden Zerstörungen beteiligt",
// "<name> hat real folgendes selbst zerstört"), each with the same four rows; wins, draws and losses above them
const INVOLVED = /(war an folgenden Zerstörungen beteiligt|was involved in the following destructions)/i;
const REAL = /(hat real folgendes selbst zerstört|has actually destroyed the following himself)/i;
const UNIT_ROWS: [keyof PlayerCardUnits, RegExp][] = [
  ['destroyed', /^(Geschossene Units|Units Killed)\s+(-?\d[\d.,]*)/i],
  ['lost', /^(Verlorene Units|Units Lost)\s+(-?\d[\d.,]*)/i],
  ['debrisMetal', /^(Gesamt Trümmerfeld Metall|Recycled Metal)\s+(-?\d[\d.,]*)/i],
  ['debrisCrystal', /^(Gesamt Trümmerfeld Kristall|Recycled Crystal)\s+(-?\d[\d.,]*)/i],
];
const FIGHT_ROWS: [keyof Pick<PlayerCardCombat, 'wins' | 'draws' | 'losses'>, RegExp][] = [
  ['wins', /^(Siege|Won)\s+(\d[\d.,]*)/i],
  ['draws', /^(Unentschieden|Drawn)\s+(\d[\d.,]*)/i],
  ['losses', /^(Verloren|Lost)\s+(\d[\d.,]*)/i],
];

/** The record with the fight statistics when both unit blocks are complete (hidden statistics show "-"). */
function withCombat(rec: PlayerCardRecord, lines: string[]): PlayerCardRecord {
  const blocks: Record<'involved' | 'real', Partial<PlayerCardUnits>> = { involved: {}, real: {} };
  const fights: Partial<Record<'wins' | 'draws' | 'losses', number>> = {};
  let block: 'involved' | 'real' | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (INVOLVED.test(line)) block = 'involved';
    else if (REAL.test(line)) block = 'real';
    else if (block) {
      const row = UNIT_ROWS.find(([, re]) => re.test(line));
      if (row) blocks[block][row[0]] = parseNumber(line.match(row[1])![2])!;
      else if (!/\d/.test(line)) block = null; // the next heading
    } else {
      const row = FIGHT_ROWS.find(([, re]) => re.test(line));
      if (row && fights[row[0]] == null) fights[row[0]] = parseNumber(line.match(row[1])![2])!;
    }
  }
  const complete = (u: Partial<PlayerCardUnits>): u is PlayerCardUnits => UNIT_ROWS.every(([k]) => u[k] != null);
  if (!complete(blocks.involved) || !complete(blocks.real)) return rec;
  return { ...rec, combat: { wins: fights.wins ?? 0, draws: fights.draws ?? 0, losses: fights.losses ?? 0, involved: blocks.involved, real: blocks.real } };
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
