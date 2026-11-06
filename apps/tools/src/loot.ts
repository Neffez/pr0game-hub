/* ACS loot calculator: glue between the page (../acs-loot/main.js) and @pr0hub/loot. */
import { parseCombatReportText, parseRecycleReportsText } from '@pr0hub/core/combat';
import { activeUnits } from '@pr0hub/core/units';
import { DEFAULT_UNI, elementLabel, universe, type UniSettings } from './core';
import {
  applyDerived,
  applyPaste,
  battleFromReport as fromReport,
  deriveFromSync,
  localEpoch,
  type Derived,
  type LootState,
  type PasteOptions,
  type PasteResult,
  type PasteSync,
  type ReportSide,
} from '@pr0hub/loot';

export {
  autoPath,
  cleanState,
  cleanSync,
  emptySync,
  pruneSync,
  setManual,
  debrisSummary,
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
  profitPercents,
  remaining,
  settle,
  SHARE_WITHIN,
} from '@pr0hub/loot';
export { DEFAULT_UNI, parseAmount } from './core';

export type ToolLang = 'de' | 'en';

/** Ships that can carry loot in an ACS (active unit catalog), in game order. */
export const lootShips = (): number[] => Object.keys(activeUnits().capacity).map(Number).sort((a, b) => a - b);

/** Ship name in the page language (short name in tables). */
export function shipName(id: number, lang: ToolLang, short = false): string {
  return elementLabel(id, lang, short);
}

export type ReportResult = ({ ok: true } & ReturnType<typeof fromReport>) | { ok: false };

/**
 * Takes a pasted battle report into the state (see `battleFromReport` of @pr0hub/loot): the attackers, or the
 * defenders of a hold (ACS defence); times are read as the player's local time, as the game shows them.
 */
export function battleFromReport(state: LootState, text: string, side: ReportSide = 'attacker'): ReportResult {
  const report = parseCombatReportText(text, null);
  return report ? { ok: true, ...fromReport(state, report, localEpoch, 'p', side) } : { ok: false };
}

/** Metal and crystal of every recycling report in a pasted text (one or more reports copied from the game), with the field it collected from. */
export function recyclingFromReports(text: string): { m: number; k: number; field: { m: number; k: number } }[] {
  return parseRecycleReportsText(text).map((r) => ({ m: r.metal, k: r.crystal, field: { m: r.totalMetal, k: r.totalCrystal } }));
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

/** Takes a pasted page (battle report, messages, empire page, marketplace) into the settlement, times as local time. */
export function pasteInto(state: LootState, sync: PasteSync, text: string, opts: Omit<PasteOptions, 'toEpoch'> = {}): PasteResult {
  return applyPaste(state, sync, text, { ...opts, toEpoch: localEpoch });
}

/**
 * Computes what the pasted pages give (flight and recycler deuterium, missiles, loot per fleet) with the universe
 * settings and the active unit catalog and puts it into the settlement, except values typed by hand.
 */
export function deriveInto(state: LootState, sync: PasteSync, uni: Partial<UniSettings>): { derived: Derived; set: Set<string> } {
  const cfg = { ...DEFAULT_UNI, ...uni };
  const derived = deriveFromSync(state, sync, universe(cfg), activeUnits(), Number(cfg.honor_boost) || 1);
  return { derived, set: applyDerived(state, sync, derived) };
}
