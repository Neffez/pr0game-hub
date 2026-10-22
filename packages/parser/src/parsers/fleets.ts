import type { CheerioAPI } from 'cheerio';
import { idByName } from '../tech.js';
import type { FleetBody, FleetMovement, FleetsRecord } from '../types.js';
import { COORDS_RE, parseCoords, parseNumber } from '../util.js';
import { pageTime } from './empire.js';
import { parseDuration, parseServerClock } from './overview.js';

/**
 * Fleet movements ("Ereignisse") of the game overview, as copied text or page source:
 * "00:18:43 | 17m 27s Eine deiner Flotten (1 Leichter Jäger) kehrt vom Mond X [1:129:11] zurück zum
 * Planet Ares [1:100:12]. Mission: Angreifen"
 */

/** mission names (DE/EN) -> game mission id */
const MISSIONS: [RegExp, number][] = [
  [/^(?:Verbandsangriff|ACS Attack)/i, 2],
  [/^(?:Angreifen|Angriff|Attack)/i, 1],
  [/^Transport/i, 3],
  [/^(?:Stationieren|Deploy)/i, 4],
  [/^(?:Halten|Verbandsverteidigung|Hold|ACS Defend)/i, 5],
  [/^(?:Spionage|Spionieren|Espionage|Spy)/i, 6],
  [/^(?:Kolonisieren|Colon)/i, 7],
  [/^(?:Abbauen|Recycl|Harvest)/i, 8],
  [/^(?:Zerstören|Mondzerstörung|Destroy|Moon destruction)/i, 9],
  [/^(?:Raketenangriff|Missile)/i, 10],
  [/^Expedition/i, 15],
];

const BODY_RE = new RegExp(
  String.raw`(Planeten|Planet|Mond|Moon|Trümmerfeld|Debris field|Position)\s+([^\[]*?)\s*` + COORDS_RE.source,
  'gi',
);
const LINE_RE = /^(?:(\d{1,2}:\d{2}:\d{2})\s*\|\s*)?((?:\d+\s*[Wdhms]\s*)+)(\S.*Mission\s*:.*)$/;
const EVENTS_HEAD_RE = /^(?:Ereignisse|Events)\s+(Ausblenden|Einblenden|Hide|Show)$/im;

function body(kind: string, name: string, coords: string): FleetBody {
  const type = /^(?:Mond|Moon)$/i.test(kind) ? 'moon' : /^(?:Trümmerfeld|Debris)/i.test(kind) ? 'debris' : /^Position$/i.test(kind) ? null : 'planet';
  return { coords: parseCoords(coords)!, type, name: name.trim() || null };
}

/** "3418 Leichter Jäger; 44 Schwerer Jäger" -> element id -> amount (unknown names are skipped) */
function amounts(list: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const part of list.split(/[;,](?=\s*\d)/)) {
    const m = part.trim().match(/^([\d.,]+)\s+(.+)$/);
    if (!m) continue;
    const id = idByName(m[2]);
    const n = parseNumber(m[1]);
    if (id != null && n != null) out[id] = (out[id] ?? 0) + n;
  }
  return out;
}

/** The event sentence without times; mission id and return flag override what the text says (HTML classes). */
export function parseFleetSentence(text: string, seconds: number, clock: string | null = null, hint: { mission?: number | null; returning?: boolean } = {}): FleetMovement | null {
  const s = text.replace(/\s+/g, ' ').trim();
  const bodies = [...s.matchAll(BODY_RE)].map((m) => body(m[1], m[2], m[0].slice(m[0].lastIndexOf('['))));
  const missionName = s.match(/Mission\s*:\s*([^(]+?)\s*(?:\(|$)/i)?.[1]?.replace(/\.$/, '').trim() ?? '';
  if (!bodies.length || !missionName) return null;
  const owner: FleetMovement['owner'] = /^(?:Eine deiner|One of your)/i.test(s) ? 'own' : /feindlich|hostile/i.test(s) ? 'hostile' : 'foreign';
  const ships = s.match(/^[^(]*?Flotten?\s*\(([^)]*)\)/i)?.[1] ?? s.match(/^[^(]*?fleets?\s*\(([^)]*)\)/i)?.[1] ?? '';
  const res = s.match(/(?:Rohstoffe|Resources)\s*:\s*([^)]*)/i)?.[1];
  const resources: Record<number, number> = {};
  if (res) {
    for (const [id, re] of [[901, /([\d.,]+)\s*(?:Metall|Metal)/i], [902, /([\d.,]+)\s*(?:Kristall|Crystal)/i], [903, /([\d.,]+)\s*Deuterium/i]] as const) {
      const n = parseNumber(res.match(re)?.[1]);
      if (n != null) resources[id] = n;
    }
  }
  const phase: FleetMovement['phase'] =
    hint.returning || /\b(?:kehrt|zurück|returns?|returning)\b/i.test(s) ? 'return' : /\b(?:im Orbit|hält|holds?|orbit)\b/i.test(s) ? 'hold' : 'out';
  return {
    owner,
    player: s.match(/(?:des Spielers|vom Spieler|of player|from player)\s+(.+?)\s+(?:vom|von|from)\s/i)?.[1] ?? null,
    mission: hint.mission ?? MISSIONS.find(([re]) => re.test(missionName))?.[1] ?? null,
    missionName,
    phase,
    from: bodies[0],
    to: bodies[1] ?? null,
    ships: amounts(ships),
    resources: res ? resources : null,
    seconds,
    clock,
  };
}

/** Copied text: one line per event ("HH:MM:SS | remaining sentence"). */
export function parseFleetLines(text: string): FleetMovement[] {
  const out: FleetMovement[] = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(LINE_RE);
    const secs = m ? parseDuration(m[2]) : null;
    const f = m && secs != null ? parseFleetSentence(m[3], secs, m[1]?.padStart(8, '0') ?? null) : null;
    if (f) out.push(f);
  }
  return out;
}

export function isFleetsText(text: string): boolean {
  return parseFleetLines(text).length > 0;
}

/**
 * Fleet movements in copied text. The event list of a copied overview page counts even when empty
 * ("Ereignisse Ausblenden" shown), but not when it was hidden in the game ("Einblenden").
 */
export function parseFleetsText(text: string, overview = false): FleetsRecord | null {
  const fleets = parseFleetLines(text);
  const head = text.match(EVENTS_HEAD_RE)?.[1];
  if (!fleets.length && !(overview && head && /^(?:Ausblenden|Hide)$/i.test(head))) return null;
  return { kind: 'fleets', pageTime: parseServerClock(text), fleets };
}

/** Page source: `.fleets` timers with the remaining seconds and the mission colour class of the event. */
export function parseFleetsHtml($: CheerioAPI): FleetsRecord | null {
  const list = $('#hidden-div2');
  const timers = $('span.fleets[data-fleet-time]');
  if (!list.length && !timers.length) return null;
  const fleets: FleetMovement[] = [];
  timers.each((_, el) => {
    const timer = $(el);
    const li = timer.closest('li').clone();
    const seconds = Number(timer.attr('data-fleet-time'));
    const cls = li.find('[class*="colorMission"]').first().attr('class') ?? '';
    const m = cls.match(/colorMission(\d+|Return)(?:Own|Foreign|friend)/i);
    li.find('.statictimer, .fleets').remove();
    const text = li.text().replace(/^\s*\|/, '');
    const f = Number.isFinite(seconds)
      ? parseFleetSentence(text, seconds, null, { mission: m && /^\d+$/.test(m[1]) ? Number(m[1]) : null, returning: m?.[1] === 'Return' })
      : null;
    if (f) fleets.push(f);
  });
  return { kind: 'fleets', pageTime: pageTime($), fleets };
}
