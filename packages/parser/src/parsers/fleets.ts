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
/** "13:14:00 | 27m 10s <sentence>" (overview), "21:25:37  03h 14m 57s <sentence>" (phalanx: tabs, no bar) */
const LINE_RE = /^(?:(\d{1,2}:\d{2}:\d{2})\s*(?:\|\s*|\s+))?((?:\d+\s*[Wdhms]\s*)+)(\S.*Mission\s*:.*)$/;
/** Head of a copied phalanx (INGAME.yaml px_scan_position): "Scan Position [3:4:1] (Kolonie)" */
const PHALANX_RE = /^\s*(?:Scan Position|Investigate position)\s*\[(\d+):(\d+):(\d+)\]/im;
const EVENTS_HEAD_RE = /^(?:Ereignisse|Events)\s+(Ausblenden|Einblenden|Hide|Show)$/im;

/**
 * Owner from the game's sentence templates (INGAME.yaml cff_mission_*): "Eine deiner …" is own, "Eine feindliche …"
 * (spying, destroying, …) hostile. An attack or ACS attack of someone else on the viewer reads "Eine Flotten(…)"
 * without player name (cff_mission_acs with ov_fleet); one on another player, e.g. a friendly ACS, "Eine
 * Verbandsflotte(…)" (cff_acs_fleet).
 */
const OWN_RE = /^(?:Eine deiner|One of your)\b/i;
const HOSTILE_RE = /^(?:Eine feindliche|A hostile)\b|^(?:Eine|A)\s+(?:Flotten|Fleets)\s*\(/i;

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
  const owner: FleetMovement['owner'] = OWN_RE.test(s) ? 'own' : HOSTILE_RE.test(s) ? 'hostile' : 'foreign';
  const ships = s.match(/^[^(]*?(?:Flotten?|Fleets?(?: in ACS)?)\s*\(([^)]*)\)/i)?.[1] ?? '';
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
    player: s.match(/(?:des Spielers|vom Spieler|of player|from player)\s+(.+?)(?:\s+\[(?:PN|PM)\])?\s+(?:vom|von|from)\s/i)?.[1] ?? null,
    mission: hint.mission ?? MISSIONS.find(([re]) => re.test(missionName))?.[1] ?? null,
    missionName,
    phase,
    from: bodies[0],
    to: bodies[1] ?? null,
    ships: amounts(ships),
    resources: res ? resources : null,
    seconds,
    clock,
    acs: null,
  };
}

/**
 * Copied text: one line per event ("HH:MM:SS | remaining sentence"); clock and timer may sit on lines of their own.
 * An ACS is one event: its further fleets follow on lines without time and share the timer of the first (the lead).
 */
export function parseFleetLines(text: string): FleetMovement[] {
  const out: FleetMovement[] = [];
  let prefix = '';
  /** last event with a timer, for the ACS fleets below it */
  let event: { index: number; seconds: number; clock: string | null } | null = null;
  let acs = 0;
  for (const raw of text.split('\n')) {
    const line = `${prefix} ${raw.trim()}`.trim();
    if (!line) continue;
    if (/^[\d:|\sWdhms]+$/.test(line) && /\d/.test(line)) {
      prefix = line;
      continue;
    }
    prefix = '';
    const m = line.match(LINE_RE);
    if (m) {
      const secs = parseDuration(m[2]);
      const clock = m[1]?.padStart(8, '0') ?? null;
      const f = secs != null ? parseFleetSentence(m[3], secs, clock) : null;
      event = f ? { index: out.length, seconds: f.seconds, clock } : null;
      if (f) out.push(f);
      continue;
    }
    const member = event && /Mission\s*:/i.test(line) ? parseFleetSentence(line, event.seconds, event.clock) : null;
    if (!event || !member) {
      event = null;
      continue;
    }
    const lead = out[event.index];
    lead.acs ??= acs++;
    member.acs = lead.acs;
    out.push(member);
  }
  return out;
}

/**
 * A copied phalanx result: the movements at the scanned planet, the scanned player's fleets written as "yours". It
 * must not be stored as the member's own fleet list; the raid planner takes it ("Phalanx einfügen").
 */
export function isPhalanxText(text: string): boolean {
  return PHALANX_RE.test(text);
}

/** Position of the scanned planet in a phalanx text. */
export function phalanxPosition(text: string): { g: number; s: number; p: number } | null {
  const m = text.match(PHALANX_RE);
  return m ? { g: Number(m[1]), s: Number(m[2]), p: Number(m[3]) } : null;
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

/**
 * Page source: `.fleets` timers with the remaining seconds; every fleet sentence sits in a span with the mission colour
 * class. An ACS is one event with one span per fleet.
 */
export function parseFleetsHtml($: CheerioAPI): FleetsRecord | null {
  const list = $('#hidden-div2');
  const timers = $('span.fleets[data-fleet-time]');
  if (!list.length && !timers.length) return null;
  const fleets: FleetMovement[] = [];
  let acs = 0;
  timers.each((_, el) => {
    const timer = $(el);
    const seconds = Number(timer.attr('data-fleet-time'));
    if (!Number.isFinite(seconds)) return;
    const li = timer.closest('li').clone();
    li.find('.statictimer, .fleets').remove();
    const spans = li.find('[class*="colorMission"]').toArray();
    const parts = spans.length
      ? spans.map((s) => ({ text: $(s).text(), cls: $(s).attr('class') ?? '' }))
      : [{ text: li.text().replace(/^\s*\|/, ''), cls: '' }];
    const event = parts
      .map(({ text, cls }) => {
        const m = cls.match(/colorMission(\d+|Return)(?:Own|Foreign|friend)/i);
        return parseFleetSentence(text, seconds, null, { mission: m && /^\d+$/.test(m[1]) ? Number(m[1]) : null, returning: m?.[1] === 'Return' });
      })
      .filter((f): f is FleetMovement => !!f);
    if (event.length > 1) {
      const n = acs++;
      for (const f of event) f.acs = n;
    }
    fleets.push(...event);
  });
  return { kind: 'fleets', pageTime: pageTime($), fleets };
}
