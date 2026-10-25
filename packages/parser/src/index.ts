import * as cheerio from 'cheerio';
import { isBuildingsHtml, isResearchHtml, parseBuildingsHtml, parseResearchHtml } from './parsers/buildings.js';
import { isEmpireHtml, isEmpireText, parseEmpireHtml, parseEmpireText } from './parsers/empire.js';
import { isGalaxyHtml, isGalaxyText, parseGalaxyHtml, parseGalaxyText, parseSystem } from './parsers/galaxy.js';
import { looksLikeUniverseJson, parseUniverseJson } from './parsers/universeJson.js';
import { isMessagesHtml, parseMessagesHtml, parseMessagesText } from './parsers/messages.js';
import { isFleetsText, isPhalanxText, parseFleetsHtml, parseFleetsText } from './parsers/fleets.js';
import { isOverviewHtml, isOverviewText, parseOverviewHtml, parseOverviewText } from './parsers/overview.js';
import { isBattleHallHtml, parseBattleHallHtml } from './parsers/battleHall.js';
import { isCombatReportText, isCombatSimulation, parseCombatReportText } from './parsers/combatReport.js';
import { isStatsText, parseStatsHtml, parseStatsText } from './parsers/stats.js';
import type { HubRecord, PageType, ParseResult, StatsType } from './types.js';
import { detectLang, nodeToText, normalizeText } from './util.js';

export * from './types.js';
export * from './util.js';
export * from './tech.js';
export * from './buildings.js';
export * from './deck.js';
export { looksLikeUniverseJson, UNIVERSE_JSON_STATUS } from './parsers/universeJson.js';
export { isPhalanxText, parseFleetsText, phalanxPosition } from './parsers/fleets.js';

export interface ParseInput {
  /** text/html from the clipboard, a saved page or the page source */
  html?: string | null;
  /** text/plain from the clipboard */
  text?: string | null;
  /** game URL when known (battle report crawler) */
  url?: string | null;
  /** user override for the stats category when it can't be detected */
  statsType?: StatsType | null;
  /** user input "g:s" for a galaxy view whose galaxy/system are not part of the copy */
  system?: string | null;
}

/** Page source pasted into the text field is treated as HTML. */
function looksLikeHtml(s: string): boolean {
  return /<(html|body|div|table|tr)[\s>]/i.test(s.slice(0, 20000));
}

export function parsePage(input: ParseInput): ParseResult {
  let html = input.html?.trim() || null;
  let text = input.text?.trim() || null;
  if (text && looksLikeUniverseJson(text)) {
    const records = parseUniverseJson(text);
    if (records) return { pageType: 'galaxy', lang: 'de', source: 'json', records, warnings: [] };
  }
  // Page source pasted as text. Copying from Chrome's view-source also puts the
  // *rendered source view* on the clipboard as text/html - the plain text is the real page then.
  if (text && looksLikeHtml(text)) {
    html = text;
    text = null;
  }

  const warnings: string[] = [];
  // the document is loaded once and shared by the parsers (they only change clones). htmlparser2 instead of cheerio's
  // default parse5: the DOM takes less than half the memory (~11× the HTML instead of ~28×) and loads twice as fast;
  // it adds no missing <tbody>, which no parser relies on (rows are found by descendant or child selectors).
  const $ = html ? cheerio.load(html, { xml: { xmlMode: false, decodeEntities: true } }) : null;
  const htmlText = $ ? normalizeText(nodeToText($.root().children().toArray())) : '';
  const plain = normalizeText(text ?? htmlText);
  const lang = detectLang(plain);

  if ($) {
    const res = parseHtml($, htmlText, input, warnings);
    if (res.records.length || !text) {
      return { ...res, lang, source: 'html', warnings };
    }
    warnings.push('html_no_data');
  }

  const res = parseText(plain, input, warnings);
  return { ...res, lang, source: 'text', warnings };
}

function queryParam(url: string | undefined, name: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'https://pr0game.com/').searchParams.get(name);
  } catch {
    return null;
  }
}

function parseHtml($: cheerio.CheerioAPI, htmlText: string, input: ParseInput, warnings: string[]): { pageType: PageType; records: HubRecord[] } {
  const url = input.url ?? undefined;
  const page = queryParam(url, 'page')?.toLowerCase() ?? null;

  if (page === 'raport' || isCombatReportText(htmlText)) {
    const reportId = queryParam(url, 'raport');
    const r = parseCombatReportText(htmlText, reportId);
    if (r && isCombatSimulation(r)) {
      warnings.push('simulation_use_raid_planner');
      return { pageType: 'combatReport', records: [] };
    }
    if (r) return { pageType: 'combatReport', records: [r] };
  }
  if (page === 'battlehall' || isBattleHallHtml($)) {
    return { pageType: 'battleHall', records: [parseBattleHallHtml($)] };
  }
  if (page === 'research' || isResearchHtml($)) {
    const r = parseResearchHtml($);
    if (r) return { pageType: 'research', records: [r] };
  }
  if (page === 'buildings' || isBuildingsHtml($)) {
    const r = parseBuildingsHtml($);
    if (r) return { pageType: 'buildings', records: [r] };
  }
  // The ranking form (who/type selects) only exists on the statistics page; alliance rankings have no player links.
  const statsForm = $('select#who').length > 0 && $('select#type').length > 0;
  if (
    page === 'statistics' ||
    (!page && (statsForm || $('a[onclick*="Dialog.Playercard"]').length > 0) && $('.galaxy-grid-row').length === 0 && !isMessagesHtml($) && !isOverviewHtml($))
  ) {
    const r = parseStatsHtml($);
    if (r) {
      if (r.type == null) {
        if (input.statsType) r.type = input.statsType;
        else warnings.push('stats_category_unknown');
      }
      return { pageType: 'stats', records: [r] };
    }
  }
  if (page === 'galaxy' || isGalaxyHtml($)) {
    const r = parseGalaxyHtml($, url, parseSystem(input.system));
    if (r) return { pageType: 'galaxy', records: [r] };
    warnings.push('galaxy_position_missing');
  }
  if (page === 'empire' || isEmpireHtml($)) {
    const r = parseEmpireHtml($);
    if (r) return { pageType: 'empire', records: [r] };
  }
  if (page === 'overview' || isOverviewHtml($)) {
    const r = parseOverviewHtml($);
    const fleets = parseFleetsHtml($);
    if (r) return { pageType: 'overview', records: fleets ? [r, fleets] : [r] };
  }
  if (page === 'messages' || isMessagesHtml($)) {
    return { pageType: 'messages', records: parseMessagesHtml($) };
  }
  return { pageType: 'unknown', records: [] };
}

function parseText(text: string, input: ParseInput, warnings: string[]): { pageType: PageType; records: HubRecord[] } {
  // a phalanx lists the scanned player's fleets as "yours": never the member's own fleet list
  if (isPhalanxText(text)) {
    warnings.push('phalanx_use_raid_planner');
    return { pageType: 'phalanx', records: [] };
  }
  // copied battle report: without the report id (only the URL has it)
  if (isCombatReportText(text)) {
    const r = parseCombatReportText(text, null);
    // a simulation is no battle: its time and placeholder coordinates would be stored as one
    if (r && isCombatSimulation(r)) {
      warnings.push('simulation_use_raid_planner');
      return { pageType: 'combatReport', records: [] };
    }
    if (r) return { pageType: 'combatReport', records: [r] };
  }
  if (isStatsText(text)) {
    const r = parseStatsText(text);
    if (r) {
      if (r.type == null) {
        if (input.statsType) r.type = input.statsType;
        else warnings.push('stats_category_unknown');
      }
      if (r.who === 'player') warnings.push('plaintext_players_by_name');
      return { pageType: 'stats', records: [r] };
    }
  }
  if (isEmpireText(text)) {
    const r = parseEmpireText(text);
    if (r) return { pageType: 'empire', records: [r] };
  }
  if (isOverviewText(text)) {
    const r = parseOverviewText(text);
    const fleets = parseFleetsText(text, true);
    if (r) return { pageType: 'overview', records: fleets ? [r, fleets] : [r] };
  }
  if (isFleetsText(text)) {
    return { pageType: 'fleets', records: [parseFleetsText(text)!] };
  }
  const msgs = parseMessagesText(text);
  if (msgs.length) return { pageType: 'messages', records: msgs };
  if (isGalaxyText(text)) {
    const system = parseSystem(input.system);
    const r = system ? parseGalaxyText(text, system) : null;
    if (r) return { pageType: 'galaxy', records: [r] };
    warnings.push('galaxy_position_missing');
    return { pageType: 'galaxy', records: [] };
  }
  if (/(Sonnensystem|Solar system)/.test(text)) {
    warnings.push('galaxy_needs_html');
  }
  return { pageType: 'unknown', records: [] };
}
