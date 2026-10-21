import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { CLASS_FLEET, CLASS_RESOURCES, classOf, idByName, isClassHeader } from '../tech.js';
import type {
  BattleRecord,
  ExpeditionRecord,
  ExpoDepletion,
  ExpoEventType,
  ExpoSize,
  HostileSpyRecord,
  HubRecord,
  PlanetType,
  RecycleRecord,
  SpyReportRecord,
} from '../types.js';
import {
  COORDS_RE,
  GAME_DATE_RE,
  nodeToText,
  normalizeText,
  parseCoords,
  parseGameDate,
  parseNumber,
  type LocalDateTime,
} from '../util.js';

// ---------------------------------------------------------------- spy reports

/** sys_mess_spy_report_details_{1,3,4} DE/EN */
const SPY_TITLE_RE =
  /(?:Spionagebericht (vom Planeten|vom Mond|von)|Spy report from (planet|moon)?)\s*(.*?)\s*\(([^()]*)\)\s*\[(\d+):(\d+):(\d+)\]\s*(?:am|on)\s*(\d{1,2}\.?\s*\S{3}\s+\d{4},?\s+\d{1,2}:\d{2}:\d{2})/;

function spyTitle(text: string) {
  const m = text.match(SPY_TITLE_RE);
  if (!m) return null;
  const typeWord = (m[1] ?? m[2] ?? '').toLowerCase();
  return {
    planetType: (typeWord.includes('mond') || typeWord.includes('moon') ? 'moon' : 'planet') as PlanetType,
    planetName: m[3].trim(),
    playerName: m[4].trim(),
    coords: { g: Number(m[5]), s: Number(m[6]), p: Number(m[7]) },
    reportTime: parseGameDate(m[8]),
    index: m.index ?? 0,
    length: m[0].length,
  };
}

const DESTROY_CHANCE_RE = /(?:Zerstörung der Spionagesonde beträgt|discovery chance was)\s*:?\s*(\d+)\s*%/;
const DESTROYED_RE = /(Deine Spionagesonden wurden zerstört|Your spy probes were destroyed)/;

export function parseSpyHtml($: CheerioAPI, el: Element, msgId: number | null): SpyReportRecord | null {
  const root = $(el);
  const titleText = normalizeText(root.find('.spyRaportHead').first().text());
  const title = spyTitle(titleText);
  if (!title) return null;

  const sections: Record<number, Record<number, number>> = {};
  root.find('.spyRaportContainerHead').each((_, head) => {
    const m = ($(head).attr('class') ?? '').match(/spyRaportContainerHeadClass(\d+)/);
    if (m) sections[Number(m[1])] ??= {};
  });
  root.find('[data-info]').each((_, cell) => {
    const m = ($(cell).attr('data-info') ?? '').match(/^(\d+)_(\d+)$/);
    if (!m) return;
    const cls = Number(m[1]);
    // Value cell may contain "(+ N)" repair info; only take the leading number.
    const value = parseNumber($(cell).clone().children('span').remove().end().text());
    (sections[cls] ??= {})[Number(m[2])] = value ?? 0;
  });

  const footer = normalizeText(root.find('.spyRaportFooter').text());
  const chance = footer.match(DESTROY_CHANCE_RE);
  return {
    kind: 'spy',
    msgId,
    coords: title.coords,
    planetType: title.planetType,
    planetName: title.planetName,
    playerName: title.playerName,
    reportTime: title.reportTime,
    sections,
    destroyChance: chance ? Number(chance[1]) : null,
    probesDestroyed: DESTROYED_RE.test(footer),
  };
}

/** Parses the body (text following the title) of a plain-text spy report. */
function parseSpyBody(body: string): Pick<SpyReportRecord, 'sections' | 'destroyChance' | 'probesDestroyed'> {
  const sections: Record<number, Record<number, number>> = {};
  const tokens = body.split(/[\n\t]/).map((t) => t.trim()).filter(Boolean);
  let current: number | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (DESTROY_CHANCE_RE.test(tok) || DESTROYED_RE.test(tok)) break;
    const id = idByName(tok);
    if (id == null) continue;
    if (isClassHeader(id)) {
      current = id;
      sections[id] ??= {};
      continue;
    }
    // Responsive layout may render the name twice in a row.
    let j = i + 1;
    while (j < tokens.length && idByName(tokens[j]) === id) j++;
    const value = tokens[j] != null && /^-?[\d.,]+(\s*\(\+\s*[\d.,]+\))?$/.test(tokens[j]) ? parseNumber(tokens[j]) : null;
    if (value == null) continue;
    const cls = current ?? classOf(id);
    (sections[cls] ??= {})[id] = value;
    i = j;
  }
  const chance = body.match(DESTROY_CHANCE_RE);
  return { sections, destroyChance: chance ? Number(chance[1]) : null, probesDestroyed: DESTROYED_RE.test(body) };
}

// --------------------------------------------------------------- battle reports

/** sys_mess_attack_report / sys_debris: DE 'Kampfbericht' / 'Trümmerfeld', EN 'Attack report' / 'Debris field'. */
const BATTLE_TITLE_RE = /(?:Kampfbericht|Attack report|Fight report)\s*\[(\d+):(\d+):(\d+)\]\s*\((P|T|M|D|Pb)\)/;
const BATTLE_LOSSES_RE = /(?:Angreifer|Attacker)\s*:\s*([\d.,]+)\s*(?:Verteidiger|Defender)\s*:\s*([\d.,]+)/;
const BATTLE_LOOT_RE =
  /(?:Gewinn|Profit)\s*(?:Metall|Metal)\s*:\s*([\d.,]+)\s*(?:Kristall|Crystal)\s*:\s*([\d.,]+)\s*(?:Deuterium)\s*:\s*([\d.,]+)/;
const BATTLE_DEBRIS_RE = /(?:Trümmerfeld|Debris field|Rubblefield)\s*(?:Metall|Metal)\s*:\s*([\d.,]+)\s*(?:Kristall|Crystal)\s*:\s*([\d.,]+)/;

function parseBattleText(
  text: string,
  msgId: number | null,
  time: LocalDateTime | null,
  extra: Partial<BattleRecord> = {},
): BattleRecord | null {
  const flat = text.replace(/\s+/g, ' ');
  const t = flat.match(BATTLE_TITLE_RE);
  if (!t) return null;
  const losses = flat.match(BATTLE_LOSSES_RE);
  const loot = flat.match(BATTLE_LOOT_RE);
  const debris = flat.match(BATTLE_DEBRIS_RE);
  return {
    kind: 'battle',
    msgId,
    reportId: null,
    time,
    coords: { g: Number(t[1]), s: Number(t[2]), p: Number(t[3]) },
    planetType: t[4] === 'M' ? 'moon' : 'planet',
    outcome: null,
    lostAttacker: parseNumber(losses?.[1]) ?? 0,
    lostDefender: parseNumber(losses?.[2]) ?? 0,
    loot: {
      metal: parseNumber(loot?.[1]) ?? 0,
      crystal: parseNumber(loot?.[2]) ?? 0,
      deuterium: parseNumber(loot?.[3]) ?? 0,
    },
    debris: { metal: parseNumber(debris?.[1]) ?? 0, crystal: parseNumber(debris?.[2]) ?? 0 },
    ...extra,
  };
}

// ------------------------------------------------------------------ expeditions

const EXPO_START_RE = /(?:Expeditionsbericht der Flotte von|Expedition report of the fleet of)\s*(.*?)\s*\[\d+:\d+:\d+\]\s*(?:bei|at)\s*\[(\d+):(\d+):(\d+)\]\s*:?/;

/** Advanced_Stats.expo_* labels DE/EN -> card. Longest labels first is not needed: all are distinct. */
const EXPO_LABELS: Array<[RegExp, ExpoEventType, ExpoSize]> = [
  [/Kleine Ressourcenfunde|Small Resource Finds/, 'Res', 'Small'],
  [/Mittlere Ressourcenfunde|Medium Resource Finds/, 'Res', 'Medium'],
  [/Große Ressourcenfunde|Large Resource Finds/, 'Res', 'Big'],
  [/Kleine Schiffsfunde|Small Ship Finds/, 'Ships', 'Small'],
  [/Mittlere Schiffsfunde|Medium Ship Finds/, 'Ships', 'Medium'],
  [/Große Schiffsfunde|Large Ship Finds/, 'Ships', 'Big'],
  [/Kleine Piraten|Small Pirates/, 'Pirates', 'Small'],
  [/Mittlere Piraten|Medium Pirates/, 'Pirates', 'Medium'],
  [/Große Piraten|Large Pirates/, 'Pirates', 'Big'],
  [/Kleine Aliens|Small Aliens/, 'Aliens', 'Small'],
  [/Mittlere Aliens|Medium Aliens/, 'Aliens', 'Medium'],
  [/Große Aliens|Large Aliens/, 'Aliens', 'Big'],
  [/Schwarze Löcher|Black Holes/, 'BlackHole', 'None'],
  [/Schnelle Expeditionen|Fast Expeditions/, 'Fast', 'None'],
  [/Langsame Expeditionen|Slow Expeditions/, 'Slow', 'None'],
  [/Leere Expeditionen|Expeditions with no finds/, 'Nothing', 'None'],
];

const FACTOR_SIZE: Record<number, ExpoSize> = { 2: 'Small', 3: 'Medium', 5: 'Big' };

const DEPLETION: Array<[RegExp, ExpoDepletion]> = [
  [/Mehr als 50 Expeditionen|More than 50 expeditions/, 'many'],
  [/Mehr als 25 Expeditionen|More than 25 expeditions/, 'medium'],
  [/Mehr als 10 Expeditionen|More than 10 expeditions/, 'few'],
];

/** Logbook lines only appear when a probe flew with the fleet (sys_expe_depleted_*). */
const PROBE_LOGBOOK_RE = /(Logbuch|Logbook|log book)/i;

const FOUND_GOODS_RE = /(?:Es wurden\s+([\d.,]+)\s+(\S+)\s+abgebaut|([\d.,]+)\s+(\S+)\s+were mined)/;
const FOUND_SHIPS_HEAD_RE = /(Es wurden folgende Schiffe gefunden:|The following ships were found:)/;

function parseExpeditionText(text: string, msgId: number | null, time: LocalDateTime | null): ExpeditionRecord | null {
  const start = text.match(EXPO_START_RE);
  const flat = text.replace(/\s+/g, ' ');

  let event: ExpoEventType | null = null;
  let size: ExpoSize = 'None';
  // The label is the last bold line; search from the end so story texts don't match.
  let best = -1;
  for (const [re, ev, sz] of EXPO_LABELS) {
    const all = [...flat.matchAll(new RegExp(re.source, 'g'))];
    const last = all.at(-1);
    if (last && (last.index ?? -1) > best) {
      best = last.index ?? -1;
      event = ev;
      size = sz;
    }
  }
  if (!event) return null;

  const factorM = flat.match(/(?:Faktor|Factor)\s+(\d+)/);
  const factor = factorM ? Number(factorM[1]) : null;
  if ((event === 'Fast' || event === 'Slow') && factor) size = FACTOR_SIZE[factor] ?? 'None';

  let depletion: ExpoDepletion = null;
  for (const [re, d] of DEPLETION) {
    if (re.test(flat)) {
      depletion = d;
      break;
    }
  }
  if (!depletion && PROBE_LOGBOOK_RE.test(flat)) depletion = 'none';

  const foundResources: Record<number, number> = {};
  const goods = flat.match(FOUND_GOODS_RE);
  if (goods) {
    const id = idByName(goods[2] ?? goods[4]);
    const amount = parseNumber(goods[1] ?? goods[3]);
    if (id != null && amount != null) foundResources[id] = amount;
  }

  const foundShips: Record<number, number> = {};
  const head = text.search(FOUND_SHIPS_HEAD_RE);
  if (head >= 0) {
    for (const line of text.slice(head).split('\n').slice(1)) {
      const m = line.match(/^(.+?):\s*([\d.,]+)$/);
      if (!m) {
        if (Object.keys(foundShips).length) break;
        continue;
      }
      const id = idByName(m[1]);
      if (id == null || classOf(id) !== CLASS_FLEET) break;
      foundShips[id] = parseNumber(m[2]) ?? 0;
    }
  }

  return {
    kind: 'expedition',
    msgId,
    time,
    coords: start ? { g: Number(start[2]), s: Number(start[3]), p: Number(start[4]) } : null,
    event,
    size,
    factor,
    depletion,
    foundResources,
    foundShips,
  };
}

// --------------------------------------------------------------- hostile spying

const HOSTILE_RE =
  /(?:Feindliche Spionagesonden (vom Planeten|vom Mond)|Enemy spy probes from (planet|moon))\s*(.*?)\s*\(([^()]*)\)\s*\[(\d+):(\d+):(\d+)\]\s*(?:wurde in der Nähe von|have been sighted near)\s*(.*?)\s*\((\w+)\)\s*\[(\d+):(\d+):(\d+)\]/;

function parseHostileText(text: string, msgId: number | null, time: LocalDateTime | null): HostileSpyRecord | null {
  const m = text.replace(/\s+/g, ' ').match(HOSTILE_RE);
  if (!m) return null;
  const fromWord = (m[1] ?? m[2]).toLowerCase();
  return {
    kind: 'hostileSpy',
    msgId,
    time,
    fromType: fromWord.includes('mond') || fromWord.includes('moon') ? 'moon' : 'planet',
    fromPlanetName: m[3].trim(),
    fromPlayerName: m[4].trim(),
    fromCoords: { g: Number(m[5]), s: Number(m[6]), p: Number(m[7]) },
    targetPlanetName: m[8].trim(),
    targetType: m[9] === 'M' ? 'moon' : 'planet',
    targetCoords: { g: Number(m[10]), s: Number(m[11]), p: Number(m[12]) },
  };
}

// ------------------------------------------------------------ recycling reports

/** sys_recy_gotten (DE/EN); the coordinates are a link, resource names are words. */
const RECYCLE_DE_RE =
  /Deine Recycler haben an den Koordinaten.*?\[(\d+):(\d+):(\d+)\]\s*([\d.,]+)\s*\S+\s+und\s+([\d.,]+)\s*\S+\s+von insgesamt\s+([\d.,]+)\s*\S+\s+und\s+([\d.,]+)\s*\S+\s+gesammelt/;
const RECYCLE_EN_RE =
  /Your recyclers have collected\s+([\d.,]+)\s*\S+\s+and\s+([\d.,]+)\s*\S+\s+from a total of\s+([\d.,]+)\s*\S+\s+and\s+([\d.,]+)\s*\S+\s+at coordinates.*?\[(\d+):(\d+):(\d+)\]/;
const RECYCLE_START_RE = /(?:Deine Recycler haben an den Koordinaten|Your recyclers have collected)/;

function parseRecycleText(text: string, msgId: number | null, time: LocalDateTime | null): RecycleRecord | null {
  const flat = text.replace(/\s+/g, ' ');
  const n = (v: string) => parseNumber(v) ?? 0;
  const de = flat.match(RECYCLE_DE_RE);
  if (de) {
    return {
      kind: 'recycle', msgId, time, coords: { g: Number(de[1]), s: Number(de[2]), p: Number(de[3]) },
      metal: n(de[4]), crystal: n(de[5]), totalMetal: n(de[6]), totalCrystal: n(de[7]),
    };
  }
  const en = flat.match(RECYCLE_EN_RE);
  if (en) {
    return {
      kind: 'recycle', msgId, time, coords: { g: Number(en[5]), s: Number(en[6]), p: Number(en[7]) },
      metal: n(en[1]), crystal: n(en[2]), totalMetal: n(en[3]), totalCrystal: n(en[4]),
    };
  }
  return null;
}

// ---------------------------------------------------------------- page entries

export function isMessagesHtml($: CheerioAPI): boolean {
  return $('.message-item[id^="message_"]').length > 0 || $('.spyRaport').length > 0 || $('.raportMessage').length > 0;
}

export function parseMessagesHtml($: CheerioAPI): HubRecord[] {
  const records: HubRecord[] = [];
  const items = $('.message-item[id^="message_"]');

  if (!items.length) {
    // Fragment without message wrapper (e.g. a single report copied).
    $('.spyRaport').each((_, el) => {
      const r = parseSpyHtml($, el, null);
      if (r) records.push(r);
    });
    $('.raportMessage').each((_, el) => {
      const r = parseBattleHtml($, el, null, null);
      if (r) records.push(r);
    });
    return records;
  }

  items.each((_, item) => {
    const msgId = Number(($(item).attr('id') ?? '').replace('message_', '')) || null;
    const time = parseGameDate($(item).find('.message-date').first().text());
    const content = $(item).find('.message-content').first();

    const text = normalizeText(nodeToText(content.toArray()));
    // Expedition fights embed a battle summary, so check expeditions first.
    const expo = parseExpeditionIfReport(text, msgId, time);
    if (expo) {
      records.push(expo);
      return;
    }

    const spy = content.find('.spyRaport').first();
    if (spy.length) {
      const r = parseSpyHtml($, spy[0], msgId);
      if (r) records.push(r);
      return;
    }
    const battle = content.find('.raportMessage').first();
    if (battle.length) {
      const r = parseBattleHtml($, battle[0], msgId, time);
      if (r) records.push(r);
      return;
    }
    const r = parseHostileText(text, msgId, time) ?? parseRecycleText(text, msgId, time);
    if (r) records.push(r);
  });
  return records;
}

function parseExpeditionIfReport(text: string, msgId: number | null, time: LocalDateTime | null) {
  return EXPO_START_RE.test(text) ? parseExpeditionText(text, msgId, time) : null;
}

function parseBattleHtml($: CheerioAPI, el: Element, msgId: number | null, time: LocalDateTime | null): BattleRecord | null {
  const root = $(el);
  const link = root.find('a[href*="raport="]').first();
  const reportId = link.attr('href')?.match(/raport=([a-f0-9]+)/)?.[1] ?? null;
  const cls = link.find('span').first().attr('class') ?? '';
  const outcome = cls.includes('raportWin') ? 'win' : cls.includes('raportLose') ? 'lose' : cls.includes('raportDraw') ? 'draw' : null;
  const text = normalizeText(nodeToText(el));
  return parseBattleText(text, msgId, time, { reportId, outcome });
}

type Anchor = { index: number; kind: 'spy' | 'battle' | 'expedition' | 'hostile' | 'recycle' };

/**
 * Plain text copy of the messages page (or of single messages). Messages are
 * found by their content anchors; the message date preceding an anchor is used as time.
 */
export function parseMessagesText(text: string): HubRecord[] {
  const anchors: Anchor[] = [];
  const scan = (re: RegExp, kind: Anchor['kind']) => {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) anchors.push({ index: m.index ?? 0, kind });
  };
  scan(SPY_TITLE_RE, 'spy');
  scan(BATTLE_TITLE_RE, 'battle');
  scan(EXPO_START_RE, 'expedition');
  scan(/(?:Feindliche Spionagesonden|Enemy spy probes)/, 'hostile');
  scan(RECYCLE_START_RE, 'recycle');
  anchors.sort((a, b) => a.index - b.index);
  // A battle summary directly following an expedition start belongs to that expedition (pirates/aliens).
  for (let i = anchors.length - 1; i > 0; i--) {
    if (anchors[i].kind === 'battle' && anchors[i - 1].kind === 'expedition') anchors.splice(i, 1);
  }

  // Collapsed spy reports show the title twice (collapsed title + hidden content) - dedupe below by key.
  const records: HubRecord[] = [];
  const seenSpy = new Set<string>();
  anchors.forEach((a, i) => {
    const end = anchors[i + 1]?.index ?? text.length;
    const block = text.slice(a.index, end);
    const time = lastDateBefore(text, a.index);
    if (a.kind === 'spy') {
      const t = spyTitle(block);
      if (!t) return;
      const body = parseSpyBody(block.slice(t.index + t.length));
      const key = `${t.coords.g}:${t.coords.s}:${t.coords.p}|${t.reportTime}`;
      if (seenSpy.has(key)) {
        // Prefer the occurrence with data.
        const prev = records.find((r) => r.kind === 'spy' && `${r.coords.g}:${r.coords.s}:${r.coords.p}|${r.reportTime}` === key) as SpyReportRecord;
        if (prev && !Object.keys(prev.sections).length) Object.assign(prev, body);
        return;
      }
      seenSpy.add(key);
      records.push({
        kind: 'spy', msgId: null, coords: t.coords, planetType: t.planetType, planetName: t.planetName,
        playerName: t.playerName, reportTime: t.reportTime, ...body,
      });
    } else if (a.kind === 'battle') {
      const r = parseBattleText(block, null, time);
      if (r) records.push(r);
    } else if (a.kind === 'expedition') {
      const r = parseExpeditionText(block, null, time);
      if (r) records.push(r);
    } else if (a.kind === 'recycle') {
      const r = parseRecycleText(block, null, time);
      if (r) records.push(r);
    } else {
      const r = parseHostileText(block, null, time);
      if (r) records.push(r);
    }
  });
  return records;
}

function lastDateBefore(text: string, index: number): LocalDateTime | null {
  const window = text.slice(Math.max(0, index - 300), index);
  const all = [...window.matchAll(new RegExp(GAME_DATE_RE.source, 'g'))];
  const last = all.at(-1);
  return last ? parseGameDate(last[0]) : null;
}

export const _internal = { parseSpyBody, parseExpeditionText, parseBattleText, parseHostileText, spyTitle, COORDS_RE, CLASS_RESOURCES, parseCoords };
