import * as cheerio from 'cheerio/slim';
import type { CheerioAPI } from 'cheerio/slim';
import { idByName } from '../tech.js';
import { isUnitId, type ShipDrives } from '../units.js';
import { parseNumber, type Lang } from '../util.js';

/**
 * Unit values from the page sources of the game, for the unit catalog of a universe (admin, pasted by hand):
 * - shipyard and defense page (`page=shipyard`): id, name and costs of every unit, requirements while unmet,
 * - tech tree (`page=techTree`): the requirements of every element,
 * - info page of a unit (`page=information&id=…`): structure, attack, shield, cargo, drives, rapidfire. It has no id,
 *   so the name is looked up (also in `known`, e.g. names from a shipyard page pasted before).
 */

export type UnitPageKind = 'shipyard' | 'techtree' | 'info';

export interface ParsedUnit {
  id: number;
  /** name in the page's language */
  name?: string;
  cost?: [number, number, number];
  req?: Record<string, number>;
  one?: boolean;
  /** metal + crystal (info page) */
  structure?: number;
  attack?: number;
  shield?: number;
  capacity?: number;
  drives?: ShipDrives | null;
  /** rapidfire of this unit: target id -> shots */
  rapidfire?: Record<string, number>;
  /** rapidfire of other units against this one: shooter id -> shots */
  rapidfireFrom?: Record<string, number>;
}

export interface UnitPage {
  kind: UnitPageKind;
  lang: Lang;
  units: ParsedUnit[];
  /** names that could not be matched to an id */
  unknown: string[];
  /**
   * Shipyard page: which list it is. The game lists every ship (fleet) or every defense unit and missile (defense)
   * of the universe there, whether buildable or not, so units missing on it do not exist in the universe.
   */
  mode?: 'fleet' | 'defense';
}

const LEVEL_RE = /\((?:Stufe|Level|Lvl\.?)\s*([\d.,]+)\s*\/\s*([\d.,]+)\)/i;
const ONLY_ONE_RE = /nur eine Schildkuppel|only build one shield/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function infoId(onclick: string | undefined): number | null {
  const m = (onclick ?? '').match(/Dialog\.info\((\d+)\)/);
  return m ? Number(m[1]) : null;
}

function langOf($: CheerioAPI, html: string): Lang {
  const attr = $('html').attr('lang');
  if (attr) return attr.startsWith('en') ? 'en' : 'de';
  return /Strukturpunkte|Benötigt|Schiffswerft|Verteidigung|Stufe/.test(html) ? 'de' : 'en';
}

/** Requirements from `Dialog.info(id)` links with "(Stufe own/need)". */
function requirements($: CheerioAPI, links: cheerio.Cheerio<never>): Record<string, number> {
  const req: Record<string, number> = {};
  links.each((_, a) => {
    const id = infoId($(a).attr('onclick'));
    const m = clean($(a).text()).match(LEVEL_RE);
    if (id != null && m) req[id] = parseNumber(m[2]) ?? 0;
  });
  return req;
}

function shipyard($: CheerioAPI): ParsedUnit[] {
  const out: ParsedUnit[] = [];
  $('.infos[id^="s"]').each((_, el) => {
    const id = Number(($(el).attr('id') ?? '').slice(1));
    if (!isUnitId(id)) return;
    const unit: ParsedUnit = { id };
    const name = clean($(el).find('.buildn a').first().text());
    if (name) unit.name = name;
    const cost: [number, number, number] = [0, 0, 0];
    $(el).find('.buildl').last().find('a[onclick*="Dialog.info"]').each((_, a) => {
      const res = infoId($(a).attr('onclick'));
      if (res == null || res < 901 || res > 903) return;
      const amount = parseNumber($(a).nextAll('b').first().text());
      if (amount != null) cost[res - 901] = amount;
    });
    unit.cost = cost;
    const req = requirements($, $(el).find('.buildl').first().find('a[onclick*="Dialog.info"]').filter((_, a) => LEVEL_RE.test($(a).text())) as never);
    if (Object.keys(req).length) unit.req = req;
    if (ONLY_ONE_RE.test($(el).text())) unit.one = true;
    out.push(unit);
  });
  return out;
}

function techTree($: CheerioAPI): ParsedUnit[] {
  const out: ParsedUnit[] = [];
  $('.techi').each((_, el) => {
    const id = Number(($(el).attr('id') ?? '').replace(/^h/, '')) || infoId($(el).find('a[onclick*="Dialog.info"]').first().attr('onclick'));
    if (id == null || !isUnitId(id)) return;
    const links = $(el).find('a[onclick*="Dialog.info"]').filter((_, a) => LEVEL_RE.test($(a).text()));
    const name = clean($(el).find('a[onclick*="Dialog.info"]').first().text());
    out.push({ id, ...(name ? { name } : {}), req: requirements($, links as never) });
  });
  return out;
}

/** Values of a row by its label (the first cell): the second cell's text. */
function row($: CheerioAPI, labels: RegExp): cheerio.Cheerio<never> | null {
  let found: cheerio.Cheerio<never> | null = null;
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td');
    if (found || cells.length < 2) return;
    if (labels.test(clean(cells.first().text()))) found = cells.eq(1) as never;
  });
  return found;
}

/** Numbers of a speed or consumption cell: the first plain, the next ones in "(…)" spans. */
function numbers(cell: cheerio.Cheerio<never> | null): number[] {
  if (!cell) return [];
  return (clean(cell.text()).match(/\d[\d.,]*/g) ?? []).map((n) => parseNumber(n) ?? 0);
}

const DRIVE_NAMES: [number, RegExp][] = [
  [0, /Verbrennungstriebwerk|Combustion/i],
  [1, /Impulstriebwerk|Impulse/i],
  [2, /Hyperraumantrieb|Hyperspace Drive|Hyperspace Engine/i],
];

/** Drives of the engine cell: the first is always used (1), the others from "(drive ≥ level)". */
function drives($: CheerioAPI, cell: cheerio.Cheerio<never> | null, speeds: number[], consumptions: number[]): ShipDrives | null {
  if (!cell) return null;
  const parts = (cell.html() ?? '').split(/<br\s*\/?>/i).map((p) => clean(cheerio.load(p).text())).filter(Boolean);
  const d: ShipDrives = { speed: [0, 0, 0], tech: [0, 0, 0], consumption: [0, 0, 0] };
  let n = 0;
  for (const part of parts) {
    const drive = DRIVE_NAMES.find(([, re]) => re.test(part));
    if (!drive) continue;
    const i = drive[0];
    const level = part.match(/≥\s*(\d+)/);
    d.tech[i] = level ? Number(level[1]) : 1;
    d.speed[i] = speeds[n] ?? 0;
    d.consumption[i] = consumptions[n] ?? 0;
    n++;
  }
  return n ? d : null;
}

/** shots from the percentage the info page shows: p = (shots − 1) / shots × 100 */
const shotsOf = (percent: number) => Math.round(100 / (100 - percent));

function rapidfire($: CheerioAPI, label: RegExp, known: (name: string) => number | null, unknown: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const text = $('td.transparent, td.left').first().html() ?? $('body').html() ?? '';
  for (const line of text.split(/<br\s*\/?>|<\/?p>/i)) {
    const t = clean(cheerio.load(line).text());
    const m = t.match(label);
    if (!m) continue;
    const id = known(m[1].trim());
    const percent = Number(m[2].replace(',', '.'));
    if (id == null) unknown.push(m[1].trim());
    else if (percent > 0 && percent < 100) out[id] = shotsOf(percent);
  }
  return out;
}

function info($: CheerioAPI, known: (name: string) => number | null, unknown: string[]): ParsedUnit[] {
  const name = clean($('th').first().text());
  const id = name ? known(name) : null;
  if (id == null || !isUnitId(id)) {
    if (name) unknown.push(name);
    return [];
  }
  const value = (labels: RegExp) => {
    const cell = row($, labels);
    return cell ? parseNumber(clean(cell.text())) : null;
  };
  const unit: ParsedUnit = { id, name };
  const structure = value(/^(Strukturpunkte|Structural Integrity)$/i);
  if (structure != null) unit.structure = structure;
  const attack = value(/^(Angriffswert|Attack Power)$/i);
  if (attack != null) unit.attack = attack;
  const shield = value(/^(Schildstärke|Shield Power)$/i);
  if (shield != null) unit.shield = shield;
  if (id < 300) {
    unit.capacity = value(/^(Ladekapazität|Cargo Capacity)$/i) ?? 0;
    const speeds = numbers(row($, /^(Geschwindigkeit|Base Speed)$/i));
    const consumptions = numbers(row($, /^(Deuteriumverbrauch|Fuel Consumption)$/i));
    unit.drives = drives($, row($, /^(Antrieb|Engine)$/i), speeds, consumptions);
  }
  unit.rapidfire = rapidfire($, /^(?:Rapidfire gegen|Rapidfire against)\s+(.+?):\s*([\d.,]+)\s*%/i, known, unknown);
  unit.rapidfireFrom = rapidfire($, /^(?:Rapidfire von|Rapidfire from)\s+(.+?):\s*([\d.,]+)\s*%/i, known, unknown);
  return [unit];
}

/** Kind of a pasted page source, null when it is none of them. */
export function unitPageKind($: CheerioAPI): UnitPageKind | null {
  if ($('.techi').length && $('.techb').length) return 'techtree';
  if ($('.infos[id^="s"] .buildn').length && $('form[action*="page=shipyard"], .planeto #ship1, #s401, #s202, #s210').length) return 'shipyard';
  if (row($, /^(Strukturpunkte|Structural Integrity)$/i)) return 'info';
  return null;
}

/**
 * Parses a shipyard, defense, tech tree or unit info page. `known`: names → id beyond the hub's (case-insensitive),
 * e.g. units of a shipyard page pasted before. Null when the page is none of them.
 */
export function parseUnitPage(html: string, known: Record<string, number> = {}): UnitPage | null {
  const $ = cheerio.load(html);
  const kind = unitPageKind($);
  if (!kind) return null;
  const extra = new Map(Object.entries(known).map(([n, id]) => [clean(n).toLowerCase(), id]));
  const lookup = (name: string) => extra.get(clean(name).toLowerCase()) ?? idByName(name);
  const unknown: string[] = [];
  const units = kind === 'shipyard' ? shipyard($) : kind === 'techtree' ? techTree($) : info($, lookup, unknown);
  const page: UnitPage = { kind, lang: langOf($, html), units, unknown: [...new Set(unknown)] };
  if (kind === 'shipyard') {
    const m = html.match(/page=shipyard(?:&amp;|&)mode=(fleet|defense)/);
    page.mode = m ? (m[1] as 'fleet' | 'defense') : units.every((u) => u.id >= 400) ? 'defense' : 'fleet';
  }
  return page;
}
