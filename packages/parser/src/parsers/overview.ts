import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { idByName } from '../tech.js';
import type { OverviewQueue, OverviewRecord, PlanetType } from '../types.js';
import { coordsKey, parseCoords, parseGameDate, type Coords } from '../util.js';
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
function catchUp(text: string): number | null {
  const m = text.match(/(?:Bauzeit-Bonus|construction time bonus)\s*:\s*(\d+(?:[.,]\d+)?)\s*%/i);
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

  return { kind: 'overview', pageTime: pageTime($), current: { coords, type }, queues, catchUp: catchUp($('.infos').text()) };
}

/** Copied overview page: "Position: [g:s:p]" of the current planet and its queue lines ("Gebäude: …"). */
export function isOverviewText(text: string): boolean {
  return /^Position\s*:\s*\[\d+:\d+:\d+\]/m.test(text) && /^(?:Gebäude|Buildings?)\s*:/m.test(text);
}

const TEXT_KIND: [RegExp, OverviewQueue['kind']][] = [
  [/^(?:Gebäude|Buildings?)\s*:\s*(.+)$/i, 'building'],
  [/^(?:Forschung|Research)\s*:\s*(.+)$/i, 'research'],
  [/^(?:Schiffswerft|Shipyard)\s*:\s*(.+)$/i, 'shipyard'],
];
const MOON_RE = /\((?:Mond|Moon|Insel)\)$/;
const OTHER_BODY_RE = /^.+ \((?:Planet|Mond|Moon|Insel)\)$/;

/** Timer text "1W 3d 20h 46m 59s" / "2m" -> seconds. */
export function parseDuration(text: string): number | null {
  const m = text.trim().match(/^(?:(\d+)\s*W\s*)?(?:(\d+)\s*d\s*)?(?:(\d+)\s*h\s*)?(?:(\d+)\s*m\s*)?(?:(\d+)\s*s)?$/i);
  if (!m || !text.trim()) return null;
  const [w, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
  return (((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s;
}

/**
 * Header clock "Serverzeit : Okt Do 22 17:29:38" (no year): the year is the one that puts the
 * time closest to `now`, so a copy from New Year's Eve pasted after midnight stays in the old year.
 */
export function parseServerClock(text: string, now = new Date()): string | null {
  const m = text.match(/(?:Serverzeit|Server time)\s*:\s*([A-Za-zäÄ]{3})\S*\s+\S+\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/i);
  if (!m) return null;
  const local = (y: number) => parseGameDate(`${m[2]}. ${m[1]} ${y}, ${m[3]}:${m[4]}:${m[5]}`);
  const y = now.getFullYear();
  const candidates = [y - 1, y, y + 1].map(local).filter((d): d is string => d != null);
  const dist = (d: string) => Math.abs(new Date(d.replace(' ', 'T')).getTime() - now.getTime());
  return candidates.sort((a, b) => dist(a) - dist(b))[0] ?? null;
}

/**
 * Plain-text overview (copied page, no timers' data-time): the remaining time comes from the timer
 * text, which is exact for the current planet and rounded ("2m") for the other planets.
 */
export function parseOverviewText(text: string): OverviewRecord | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const posIdx = lines.findIndex((l) => /^Position\s*:\s*\[/.test(l));
  const coords = posIdx >= 0 ? parseCoords(lines[posIdx]) : null;
  if (!coords) return null;

  // Box of the other body at the same position: "Schmausor (Planet)" when a moon is selected and vice versa.
  const otherIdx = lines.findIndex((l, i) => i < posIdx && OTHER_BODY_RE.test(l));
  const otherType: PlanetType | null = otherIdx < 0 ? null : MOON_RE.test(lines[otherIdx]) ? 'moon' : 'planet';
  const type: PlanetType = otherType === 'planet' ? 'moon' : 'planet';

  const queues: OverviewQueue[] = [];
  /** element line at `i` followed by its timer line */
  const add = (kind: OverviewQueue['kind'], c: Coords, t: PlanetType, i: number, itemText = lines[i]) => {
    const it = item(itemText ?? '');
    const secs = parseDuration(lines[i + 1] ?? '');
    if (it && secs != null) queues.push({ kind, coords: c, type: t, ...it, seconds: secs });
  };

  if (otherType) {
    let i = otherIdx + 1;
    while (lines[i] === lines[otherIdx]) i++;
    add('building', coords, otherType, i);
  }
  for (let i = 0; i < posIdx; i++) {
    for (const [re, kind] of TEXT_KIND) {
      const m = lines[i].match(re);
      if (m) add(kind, coords, type, i, m[1]);
    }
  }

  // Planets and moons: name (twice), [g:s:p], current building or "Frei" and its timer. A moon follows
  // its planet, so a position seen before (or the selected planet's) is a moon.
  const seen = new Set(type === 'planet' ? [coordsKey(coords)] : []);
  for (let i = posIdx + 1; i < lines.length; i++) {
    const c = /^\[\d+:\d+:\d+\]$/.test(lines[i]) ? parseCoords(lines[i]) : null;
    if (!c) continue;
    const key = coordsKey(c);
    add('building', c, seen.has(key) ? 'moon' : 'planet', i + 1);
    seen.add(key);
  }

  return { kind: 'overview', pageTime: parseServerClock(text), current: { coords, type }, queues, catchUp: catchUp(text) };
}
