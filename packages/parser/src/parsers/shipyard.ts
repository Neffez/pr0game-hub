import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { ShipyardRecord } from '../types.js';
import { isUnitId } from '../units.js';
import { resourceBar, selected } from './buildings.js';
import { pageTime } from './empire.js';

/**
 * The game's shipyard page (page=shipyard, `mode` fleet or defense) of the selected planet: one `.infos` block per
 * unit of the list with the amount on the planet (`#val_<id>`, nothing shown for 0), and the planet's shipyard queue.
 * The queue is not in the markup: the page script gets it as `data = {"Queue": [[name, count, seconds per unit, id],
 * …], …}` and fills the cancel list (`#auftr`) from it every second, raising the shown amounts as units are done.
 */

/** Shipyard or defense page: its unit blocks (`#s202`, `#s401` …) with a build form, the ship filters or a known unit. */
export function isShipyardHtml($: CheerioAPI): boolean {
  return $('.infos[id^="s"] .buildn').length > 0 && $('form[action*="page=shipyard"], .planeto #ship1, #hangar-filters, #s401, #s202, #s210').length > 0;
}

type Queue = { id: number; count: number }[];

/** The queue as the page was loaded with it; null without the page script. */
function loadedQueue(script: string): Queue | null {
  const m = script.match(/\bdata\s*=\s*([[{][\s\S]*?[\]}])\s*;\s*bd_operating\b/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as { Queue?: unknown } | unknown[];
    // without a queue the game writes `data = [];`
    const raw = Array.isArray(data) ? [] : data.Queue;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
    return list.flatMap((q) => {
      if (!Array.isArray(q)) return [];
      const id = Number(q[3]);
      const count = Number(q[1]);
      return isUnitId(id) && count > 0 ? [{ id, count }] : [];
    });
  } catch {
    return null;
  }
}

/**
 * The queue as the page shows it now. A page saved from a running tab has the amounts already raised by the units
 * built since it was loaded, so the queue has to be the one of the same moment: the cancel list the script keeps
 * ("3 Kleiner Transporter in Arbeit" per entry - the rest of the loaded queue, the first entry counted down; one
 * entry without an amount once everything is built). Untouched (its empty placeholder), the loaded queue holds.
 */
function shownQueue($: CheerioAPI, loaded: Queue): Queue {
  const shown = $('#auftr option, #auftrumode option').toArray()
    .map((o) => $(o).text().replace(/ /g, ' ').trim())
    .filter(Boolean);
  if (!shown.length) return loaded;
  const counts = shown.map((text) => text.match(/^([\d.,]+)\s+\S/)?.[1].replace(/\D/g, '') ?? null);
  if (shown.length === 1 && counts[0] == null) return [];
  if (counts.some((c) => c == null) || counts.length > loaded.length) return loaded;
  return loaded.slice(loaded.length - counts.length).flatMap((q, i) => (Number(counts[i]) > 0 ? [{ id: q.id, count: Number(counts[i]) }] : []));
}

export function parseShipyardHtml($: CheerioAPI): ShipyardRecord | null {
  const at = selected($);
  const units: Record<number, number> = {};
  $('.infos[id^="s"]').each((_, el) => {
    const id = Number(($(el).attr('id') ?? '').slice(1));
    if (!isUnitId(id)) return;
    // " (Vorhanden: 1.234)" - the game's own script reads the amount the same way
    units[id] = Number($(el).find(`#val_${id}`).first().text().replace(/\D/g, '')) || 0;
  });
  const ids = Object.keys(units).map(Number);
  if (!at || !ids.length) return null;
  const script = $('script').text();
  const mode = ($('form[action*="page=shipyard"]').first().attr('action') ?? '').match(/mode=(fleet|defense)/)?.[1]
    ?? script.match(/queryString\s*=\s*"[^"]*mode=(fleet|defense)/)?.[1]
    ?? (ids.every((id) => id >= 400) ? 'defense' : 'fleet');
  const loaded = loadedQueue(script);
  return {
    kind: 'shipyard',
    ...at,
    pageTime: pageTime($),
    mode: mode as ShipyardRecord['mode'],
    ...resourceBar($),
    units,
    queue: loaded ? shownQueue($, loaded) : null,
  };
}

/** Parses the page source of a shipyard or defense page; null when it is none (or no planet is selected in it). */
export function parseShipyardPage(html: string): ShipyardRecord | null {
  const $ = cheerio.load(html, { xml: { xmlMode: false, decodeEntities: true } });
  return isShipyardHtml($) ? parseShipyardHtml($) : null;
}
