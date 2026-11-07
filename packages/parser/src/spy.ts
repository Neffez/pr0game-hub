// Spy report parser for pasted text without the HTML parsers (no cheerio), for the static tools.
import { parseMessagesText } from './parsers/messages.js';
import type { SpyReportRecord } from './types.js';

export type { SpyReportRecord } from './types.js';

/** The spy reports of a pasted messages page (newest first, as the game lists them). */
export function parseSpyReportsText(text: string): SpyReportRecord[] {
  return parseMessagesText(text).filter((r): r is SpyReportRecord => r.kind === 'spy');
}

/** All values of a spy report in one map (element id -> amount), sections merged. */
export function spyValues(report: Pick<SpyReportRecord, 'sections'>): Record<number, number> {
  return Object.assign({}, ...Object.values(report.sections));
}

/** Sections a spy report shows, from the least probes needed to the most (the game's `MissionCaseSpy`). */
export const SPY_SECTIONS = ['fleet', 'defense', 'buildings', 'research'] as const;
export type SpySection = (typeof SPY_SECTIONS)[number];

/**
 * Probes needed to see each section of a spy report, like the game's `MissionCaseSpy`: the minimum amount is the
 * square of the espionage level difference (negative when the sender's level is higher), fleet needs at least that
 * many, defense one more, buildings three more, research five more; at least one probe always flies.
 */
export function spyProbes(ownLevel: number, targetLevel: number): Record<SpySection, number> {
  const own = Math.max(ownLevel, 1);
  const target = Math.max(targetLevel, 1);
  const diff = Math.abs(own - target);
  const min = (own > target ? -1 : 1) * diff * diff;
  const need = (extra: number) => Math.max(1, Math.ceil(min + extra));
  return { fleet: need(0), defense: need(1), buildings: need(3), research: need(5) };
}
