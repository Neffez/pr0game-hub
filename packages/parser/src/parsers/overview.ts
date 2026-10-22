import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { idByName } from '../tech.js';
import type { OverviewQueue, OverviewRecord, PlanetType } from '../types.js';
import { parseCoords, type Coords } from '../util.js';
import { pageTime } from './empire.js';

/** Game overview page (page=overview): build/research/shipyard queues with their remaining time. */
export function isOverviewHtml($: CheerioAPI): boolean {
  return $('.planeth').length > 0 && $('.planeto').length > 0;
}

/** "Metallmine (25)" / "Metallmine Abreißen (25)" -> element and level (amount for the shipyard). */
function item(text: string): { id: number; level: number; destroy: boolean } | null {
  const m = text.replace(/\s+/g, ' ').trim().match(/^(.*?)(\s+(?:Abreißen|Dismantle))?\s*\(([\d.,]+)\)$/i);
  if (!m) return null;
  const id = idByName(m[1]);
  return id == null ? null : { id, level: Number(m[3].replace(/[.,]/g, '')), destroy: !!m[2] };
}

const KIND: [RegExp, OverviewQueue['kind']][] = [
  [/page=buildings/, 'building'],
  [/page=research/, 'research'],
  [/page=shipyard/, 'shipyard'],
];

/** Catch-up bonus line under the points: "Kosten- und Bauzeit-Bonus: 12.34 %" (only when the universe has it). */
function catchUp($: CheerioAPI): number | null {
  const m = $('.infos').text().match(/(?:Bauzeit-Bonus|construction time bonus)\s*:\s*(\d+(?:[.,]\d+)?)\s*%/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function parseOverviewHtml($: CheerioAPI): OverviewRecord | null {
  const opt = $('#planetSelector option[selected]').first();
  const coords = parseCoords(opt.text());
  if (!coords) return null;
  const type: PlanetType = /\((Mond|Moon|Insel)\)/.test(opt.text()) ? 'moon' : 'planet';
  const queues: OverviewQueue[] = [];
  const add = (kind: OverviewQueue['kind'], c: Coords, t: PlanetType, text: string, seconds: string | undefined) => {
    const it = item(text);
    const secs = Number(seconds);
    if (it && Number.isFinite(secs)) queues.push({ kind, coords: c, type: t, ...it, seconds: secs });
  };

  // Current planet: "<a href=…page=buildings>Gebäude:</a> Metallmine (25)<br><div class="timer" data-time="…">"
  let kind: OverviewQueue['kind'] | null = null;
  let text = '';
  for (const node of $('.planeth').first().contents().toArray()) {
    if (node.type === 'text') {
      text += (node as unknown as { data: string }).data;
      continue;
    }
    const el = $(node as Element);
    if (el.is('a')) {
      kind = KIND.find(([re]) => re.test(el.attr('href') ?? ''))?.[1] ?? null;
      text = '';
    } else if (el.is('div') && el.hasClass('timer') && kind) {
      add(kind, coords, type, text, el.attr('data-time'));
      kind = null;
    }
  }

  // The moon of the current planet (or the planet when a moon is selected).
  const moon = $('.moon').first();
  if (moon.length) {
    const timer = moon.find('.timershort').first();
    if (timer.length) {
      const lines = moon.text().split('\n').map((l) => l.trim()).filter(Boolean);
      const other: PlanetType = lines.some((l) => /\((Mond|Moon|Insel)\)$/.test(l)) ? 'moon' : 'planet';
      add('building', coords, other, lines.find((l) => /\(\d[\d.,]*\)$/.test(l)) ?? '', timer.attr('data-time'));
    }
  }

  // All other planets and moons: name, [g:s:p], current building and timer.
  $('.planetl').each((_, el) => {
    const box = $(el);
    const c = parseCoords(box.text());
    const timer = box.find('.timershort').first();
    if (!c || !timer.length) return;
    const t: PlanetType = /\/mond\d*[._]/i.test(box.find('img').attr('src') ?? '') ? 'moon' : 'planet';
    const line = box.text().split('\n').map((l) => l.trim()).find((l) => /\(\d[\d.,]*\)$/.test(l) && !/^\[/.test(l));
    add('building', c, t, line ?? '', timer.attr('data-time'));
  });

  return { kind: 'overview', pageTime: pageTime($), current: { coords, type }, queues, catchUp: catchUp($) };
}
