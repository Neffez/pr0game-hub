/* ACS loot calculator: glue between the page (../acs-loot/main.js) and @pr0hub/loot. */
import { parseCombatReportText } from '@pr0hub/core/combat';
import { TECH_NAMES } from '@pr0hub/core/tech';
import { CAPACITY } from '@pr0hub/flight';
import { battleFromReport as fromReport, type LootState } from '@pr0hub/loot';

export {
  cleanState,
  decodeShare,
  DEFAULT_RATES,
  emptyState,
  encodeShare,
  lostShips,
  lootShares,
  MAX_HELPER_KEEP,
  MAX_PARTICIPANTS,
  newId,
  planTransfers,
  remaining,
  settle,
  SHARE_WITHIN,
} from '@pr0hub/loot';
export { parseAmount } from './core';

export type ToolLang = 'de' | 'en';

/** Ships that can fly in an ACS, in game order. */
export const LOOT_SHIPS: number[] = Object.keys(CAPACITY).map(Number).sort((a, b) => a - b);

/** Ship name in the page language (short name in tables). */
export function shipName(id: number, lang: ToolLang, short = false): string {
  const names = TECH_NAMES as unknown as Record<string, Record<string, string>>;
  return names[short ? `${lang}Short` : lang]?.[id] ?? names[lang]?.[id] ?? String(id);
}

export type ReportResult = ({ ok: true } & ReturnType<typeof fromReport>) | { ok: false };

/**
 * Takes a pasted battle report into the state (see `battleFromReport` of @pr0hub/loot): times are read as the
 * player's local time, as the game shows them.
 */
export function battleFromReport(state: LootState, text: string): ReportResult {
  const report = parseCombatReportText(text, null);
  return report ? { ok: true, ...fromReport(state, report) } : { ok: false };
}

/** Thousands separators like the game: 1.234.567 (German) or 1,234,567 (English). */
export function fmtNum(n: number, lang: ToolLang): string {
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'de' ? '.' : ',');
  return (n < 0 && Math.round(n) !== 0 ? '-' : '') + s;
}

/** Short amounts for transfer texts: 1,2 Mio / 633k. */
export function fmtShort(n: number, lang: ToolLang): string {
  const a = Math.abs(n);
  const dec = (v: number) => (lang === 'de' ? String(v).replace('.', ',') : String(v));
  if (a >= 1e6) return dec(Math.round(n / 1e5) / 10) + (lang === 'de' ? ' Mio' : 'M');
  if (a >= 1e4) return Math.round(n / 1e3) + 'k';
  return fmtNum(n, lang);
}
