import type { CheerioAPI } from 'cheerio';
import { idByName } from '../tech.js';
import type { BuildingsEntry, BuildingsRecord, PlanetType } from '../types.js';
import { parseCoords, parseNumber } from '../util.js';
import { pageTime } from './empire.js';

/** Buildings page (page=buildings): the element blocks link the building ids below 100, the build forms post to it. */
export function isBuildingsHtml($: CheerioAPI): boolean {
  return $('.infos .buildn').length > 0 && $('form[action*="page=buildings"], #buildlist').length > 0;
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

export function parseBuildingsHtml($: CheerioAPI): BuildingsRecord | null {
  const opt = $('#planetSelector option[selected]').first();
  const coords = parseCoords(opt.text());
  if (!coords) return null;
  const type: PlanetType = /\((Mond|Moon|Insel)\)/.test(opt.text()) ? 'moon' : 'planet';

  const buildings: BuildingsEntry[] = [];
  $('.infos').each((_, el) => {
    const head = $(el).children('.buildn').first();
    if (!head.length) return;
    const id = infoId($, head) ?? idByName(head.find('a').first().text());
    if (id == null || id >= 100) return;
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
    buildings.push({ id, level, cost, time: ts != null && ts !== '' ? Number(ts) : null, ...(busy ? { busy } : {}) });
  });
  if (!buildings.length) return null;

  const queue: BuildingsRecord['queue'] = [];
  $('#buildlist .buildb').each((_, el) => {
    // "1.: Metallmine 21" (the name may be a button to move it up)
    const text = $(el).clone().find('#progressbar').remove().end().text().replace(/\s+/g, ' ').trim().replace(/^\d+\.:\s*/, '');
    const destroy = DESTROY.test(text);
    const m = text.replace(DESTROY, '').match(/^(.*?)\s+(\d+)$/);
    const id = m ? idByName(m[1]) : null;
    if (!m || id == null) return;
    const end = Number($(el).next('.bulida').find('.timer[data-time]').attr('data-time'));
    queue.push({ id, level: Number(m[2]), destroy, end: end > 0 ? end : null });
  });

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

  const bonus = $('.planeto').first().text().match(/(\d+(?:[.,]\d+)?)\s*%/);
  return {
    kind: 'buildings',
    coords,
    type,
    pageTime: pageTime($),
    resources,
    storage,
    perHour,
    catchUp: bonus ? Number(bonus[1].replace(',', '.')) : null,
    buildings,
    queue,
  };
}
