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
