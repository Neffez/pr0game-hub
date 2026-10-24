// Battle and recycling report parsers without the HTML parsers (no cheerio), for the static tools.
export { isCombatReportText, parseCombatReportText } from './parsers/combatReport.js';
export { parseRecycleReportsText } from './parsers/recycle.js';
export type { CombatFleet, CombatReportRecord, RecycleRecord } from './types.js';
