import type { CheerioAPI } from 'cheerio';
import { idByName } from '../tech.js';
import type { BuildingsEntry, BuildingsRecord, PlanetType, ResearchRecord } from '../types.js';
import { parseCoords, parseNumber, type Coords } from '../util.js';
import { pageTime } from './empire.js';

/**
 * The game's buildings page (page=buildings) and research page (page=research) share their layout: the selected
 * planet in the header with the resource bar, a queue (`#buildlist`) and one `.infos` block per element with its
 * level, the cost and the time of the next level. The filter buttons tell them apart.
 */

/** Buildings page: its filter buttons (`#btn1` …) or build forms. */
export function isBuildingsHtml($: CheerioAPI): boolean {
  return $('.infos .buildn').length > 0 && $('.planeto #btn1, form[action*="page=buildings"]').length > 0;
}

/** Research page: its filter buttons (`#lab1` …) or research forms. */
export function isResearchHtml($: CheerioAPI): boolean {
  return $('.infos .buildn').length > 0 && $('.planeto #lab1, form[action*="page=research"]').length > 0;
}

const RES_KEYS: [number, string][] = [
  [901, 'metal'],
  [902, 'crystal'],
  [903, 'deuterium'],
];

/** Element id of a `Dialog.info(<id>)` link inside the node. */
function infoId($: CheerioAPI, node: unknown): number | null {
  const m = ($(node as never).find('a[onclick*="Dialog.info"]').first().attr('onclick') ?? '').match(/Dialog\.info\((\d+)\)/);
  return m ? Number(m[1]) : null;
}

/** status of a building whose facility is in use */
const BUSY = /^(Beschäftigt|Busy)$/i;

/** "Abreißen" / "Demolish" after a queue entry */
const DESTROY = /\s+(?:Abreißen|Demolish|Dismantle)\s*$/i;

/** Planet selected in the header ("Name (Mond) [g:s:p]"). */
function selected($: CheerioAPI): { coords: Coords; type: PlanetType } | null {
  const opt = $('#planetSelector option[selected]').first();
  const coords = parseCoords(opt.text());
  return coords ? { coords, type: /\((Mond|Moon|Insel)\)/.test(opt.text()) ? 'moon' : 'planet' } : null;
}

/** The `.infos` blocks of elements with an id in [from, to). */
function entries($: CheerioAPI, from: number, to: number): BuildingsEntry[] {
  const list: BuildingsEntry[] = [];
  $('.infos').each((_, el) => {
    const head = $(el).children('.buildn').first();
    if (!head.length) return;
    const id = infoId($, head) ?? idByName(head.find('a').first().text());
    if (id == null || id < from || id >= to) return;
    const level = Number(head.text().match(/\((?:Stufe|Level|Lvl\.?)\s*([\d.,]+)/i)?.[1]?.replace(/[.,]/g, '') ?? 0);
    const cost: Record<number, number> = {};
    // the cost column: "<a>Metall</a>: <b><span>1.234</span></b>" per resource (the second .buildl)
    const costCell = $(el).children('.buildl').eq(1);
    costCell.children('span').first().find('a').each((_, a) => {
      const rid = Number(($(a).attr('onclick') ?? '').match(/Dialog\.info\((\d+)\)/)?.[1]) || idByName($(a).text());
      const value = parseNumber($(a).next('b').text());
      if (rid && value != null) cost[rid] = value;
    });
    const ts = costCell.find('.statictime').first().attr('timestamp');
    const busy = costCell.children('span.colorNeutral').toArray().some((sp) => BUSY.test($(sp).text().trim()));
    list.push({ id, level, cost, time: ts != null && ts !== '' ? Number(ts) : null, ...(busy ? { busy } : {}) });
  });
  return list;
}

/** Queue entries: "1.: Metallmine 21 [Abreißen]" / "1.: Spionagetechnik 10 @ Planet", with their end (epoch) when shown. */
function queue($: CheerioAPI): { id: number; level: number; destroy: boolean; end: number | null }[] {
  const list: { id: number; level: number; destroy: boolean; end: number | null }[] = [];
  $('#buildlist .buildb').each((_, el) => {
    const text = $(el)
      .clone().find('#progressbar').remove().end()
      .text().replace(/\s+/g, ' ').trim()
      .replace(/^\d+\.:\s*/, '')
      .replace(/\s+@\s+.*$/, '');
    const destroy = DESTROY.test(text);
    const m = text.replace(DESTROY, '').match(/^(.*?)\s+(\d+)$/);
    const id = m ? idByName(m[1]) : null;
    if (!m || id == null) return;
    const end = Number($(el).next('.bulida').find('[data-time][data-umode]').attr('data-time'));
    list.push({ id, level: Number(m[2]), destroy, end: end > 0 ? end : null });
  });
  return list;
}

/** Resource bar: amounts, storage capacity and production per hour (from the page's `resourceTicker` calls). */
function resourceBar($: CheerioAPI) {
  const resources: Record<number, number> = {};
  const storage: Record<number, number> = {};
  const perHour: Record<number, number> = {};
  const script = $('script').text();
  for (const [id, key] of RES_KEYS) {
    const cur = $(`#current_${key}, [data-ticker="current_${key}"]`).first();
    const v = Number(cur.attr('data-real'));
    if (cur.length && Number.isFinite(v)) resources[id] = v;
    else if (cur.length) resources[id] = parseNumber(cur.text()) ?? 0;
    const max = parseNumber($(`#max_${key}`).first().text());
    if (max != null) storage[id] = max;
    // resourceTicker({ available: …, limit: [0, …], production: 1234.5, valueElem: "current_metal" })
    const tick = script.match(new RegExp(`production:\\s*(-?[\\d.]+)\\s*,\\s*valueElem:\\s*["']current_${key}["']`));
    if (tick) perHour[id] = Number(tick[1]);
  }
  return { resources, storage, perHour };
}

/** "Kosten- und Bauzeit-Bonus: 10.18 %" below the filter buttons (only when the universe has it). */
function catchUp(head: string): number | null {
  const m = head.match(/(?:Bauzeit-Bonus|construction time bonus)\s*:\s*(\d+(?:[.,]\d+)?)\s*%/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function parseBuildingsHtml($: CheerioAPI): BuildingsRecord | null {
  const at = selected($);
  const buildings = entries($, 0, 100);
  if (!at || !buildings.length) return null;
  const head = $('.planeto').first().text();
  // "168 / 208 Felder"
  const fields = head.match(/([\d.,]+)\s*\/\s*([\d.,]+)\s*(?:Felder|Fields)/i);
  return {
    kind: 'buildings',
    ...at,
    pageTime: pageTime($),
    ...resourceBar($),
    catchUp: catchUp(head),
    fields: fields ? { used: parseNumber(fields[1]) ?? 0, max: parseNumber(fields[2]) ?? 0 } : null,
    buildings,
    queue: queue($),
  };
}

/** "Das Forschungslabor wird zurzeit ausgebaut!" / "You cannot research during lab upgrades." */
const LAB_BUSY = /Forschungslabor wird zurzeit ausgebaut|cannot research during lab upgrades/i;
/** "Auf diesem Planeten ist kein Labor vorhanden" / no lab on the planet */
const NO_LAB = /kein Labor vorhanden|no (?:research )?lab/i;

export function parseResearchHtml($: CheerioAPI): ResearchRecord | null {
  const at = selected($);
  const research = entries($, 100, 200);
  if (!at || !research.length) return null;
  const notes = $('.hidden-div').text();
  return {
    kind: 'research',
    ...at,
    pageTime: pageTime($),
    ...resourceBar($),
    catchUp: catchUp($('.planeto').first().text()),
    labBusy: LAB_BUSY.test(notes),
    noLab: NO_LAB.test(notes),
    research,
    queue: queue($).map(({ id, level, end }) => ({ id, level, end })),
    known: requirementLevels($),
  };
}

/** Own levels of the requirement lines: `<a onclick="Dialog.info(31)"><span>Forschungslabor (Stufe 10/5)</span></a>`. */
function requirementLevels($: CheerioAPI): Record<number, number> {
  const known: Record<number, number> = {};
  $('.infos').each((_, el) => {
    $(el).children('.buildl').first().children('a[onclick*="Dialog.info"]').each((_, a) => {
      const id = Number(($(a).attr('onclick') ?? '').match(/Dialog\.info\((\d+)\)/)?.[1]);
      const m = $(a).text().match(/\((?:Stufe|Level|Lvl\.?)\s*([\d.,]+)\s*\/\s*[\d.,]+\)/i);
      if (id && m) known[id] = Number(m[1].replace(/[.,]/g, ''));
    });
  });
  return known;
}
