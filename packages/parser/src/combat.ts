// Battle report parser without the HTML parsers (no cheerio), for the static tools.
export { isCombatReportText, parseCombatReportText } from './parsers/combatReport.js';
export type { CombatFleet, CombatReportRecord } from './types.js';
