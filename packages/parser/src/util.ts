import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

export type Lang = 'de' | 'en';

export interface Coords {
  g: number;
  s: number;
  p: number;
}

/** "1.234.567", "1,234,567", "-12" -> number. Thousands separator depends on the user's game setting. */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const m = String(raw).replace(/ /g, ' ').match(/-?\d[\d.,]*/);
  if (!m) return null;
  const n = Number(m[0].replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export const COORDS_RE = /\[(\d{1,2}):(\d{1,3}):(\d{1,2})\]/;

export function parseCoords(raw: string): Coords | null {
  const m = raw.match(COORDS_RE);
  return m ? { g: Number(m[1]), s: Number(m[2]), p: Number(m[3]) } : null;
}

export function coordsKey(c: Coords): string {
  return `${c.g}:${c.s}:${c.p}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8,
  sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};

/** Game date format (php_tdformat): DE `d. M Y, H:i:s`, EN `j M Y, H:i:s` (no dot after the day). */
export const GAME_DATE_RE = /\b(\d{1,2})\.?\s*([A-Za-zäÄ]{3})\s+(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/;

/** Wall-clock time as shown in game: `YYYY-MM-DD HH:MM:SS` (no timezone). */
export type LocalDateTime = string;

export function parseGameDate(raw: string): LocalDateTime | null {
  const m = raw.match(GAME_DATE_RE);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const pad = (n: number | string) => String(n).padStart(2, '0');
  return `${m[3]}-${pad(month)}-${pad(m[1])} ${pad(m[4])}:${m[5]}:${m[6]}`;
}

/** Converts a wall-clock time in the given IANA timezone to unix seconds. */
export function localToEpoch(local: LocalDateTime, timeZone = 'Europe/Berlin'): number {
  const [d, t] = local.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s] = t.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, da, h, mi, s);
  // Offset of the zone at that instant; iterate once to settle DST edges.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    guess = asUtc - zoneOffsetMs(guess, timeZone);
  }
  return Math.round(guess / 1000);
}

/** Formatters per time zone; creating one is expensive and this runs per message. */
const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    zoneFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const zoned = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return zoned - utcMs;
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol',
  'p', 'pre', 'section', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'ul', 'option',
]);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'select']);

/**
 * Renders a DOM subtree to text roughly the way a browser copy does:
 * block elements become line breaks, table cells become tabs.
 */
export function nodeToText(nodes: AnyNode | AnyNode[]): string {
  let out = '';
  const walk = (node: AnyNode) => {
    if (node.type === 'text') {
      out += (node as unknown as { data: string }).data.replace(/[ \t\r\n]+/g, ' ');
      return;
    }
    if (node.type !== 'tag') return;
    const el = node as Element;
    const tag = el.name.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'td' || tag === 'th') out += '\t';
    if (BLOCK_TAGS.has(tag)) out += '\n';
    for (const child of el.children) walk(child);
    if (BLOCK_TAGS.has(tag) && tag !== 'br') out += '\n';
  };
  for (const n of Array.isArray(nodes) ? nodes : [nodes]) walk(n);
  return out;
}

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  return normalizeText(nodeToText($.root().children().toArray()));
}

/** Normalizes line endings and nbsp, trims each line, drops empty lines. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/ +/g, ' ').replace(/ *\t */g, '\t').replace(/^\t+|\t+$/g, '').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

export function detectLang(text: string): Lang {
  // German incl. the German based pirate language of the SetSail theme ("Papageienbericht", "Treibgut-Feld", …)
  const de = /(Spionagebericht|Papageienbericht|Statistiken|Aktualisiert am|Kampfbericht|Expeditionsbericht|Imperiumsübersicht|Sonnensystem|Spieler|Treibgut-Feld|Wahrscheinlichkeit)/;
  const en = /(Intelligence report|Spy report|Statistics|Updated|Fight report|Expedition report|Empire|Solar system|Player)/;
  const d = (text.match(new RegExp(de, 'g')) ?? []).length;
  const e = (text.match(new RegExp(en, 'g')) ?? []).length;
  return e > d ? 'en' : 'de';
}

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Debris amount as shown in the galaxy view: "1.2K", "3,5M", "300" or "1.234" (thousands separator). */
export function debrisAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const m = String(raw).trim().match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!m) return parseNumber(raw) ?? 0;
  if (!m[2]) return parseNumber(m[1]) ?? 0;
  const factor = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as 'K' | 'M' | 'B'];
  return Math.round(Number(m[1].replace(',', '.')) * factor);
}
