/* ACS loot calculator: glue between the page (../acs-loot/main.js) and @pr0hub/loot. */
import { parseCombatReportText } from '@pr0hub/core/combat';
import { TECH_NAMES } from '@pr0hub/core/tech';
import { CAPACITY } from '@pr0hub/flight';
import { MAX_PARTICIPANTS, type Battle, type LootState, type Ships } from '@pr0hub/loot';

export {
  cleanState,
  decodeShare,
  DEFAULT_RATES,
  emptyState,
  encodeShare,
  lostShips,
  lootShares,
  MAX_PARTICIPANTS,
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

let nextId = 0;
/** Fresh id for a participant or helper that is not used in `state`. */
export function newId(state: LootState, prefix: 'p' | 'h'): string {
  const used = new Set([...state.participants, ...state.helpers].map((p) => p.id));
  let id: string;
  do id = `${prefix}${++nextId}`;
  while (used.has(id));
  return id;
}

const addShips = (a: Ships, b: Ships): Ships => {
  const out: Ships = { ...a };
  for (const [id, n] of Object.entries(b)) out[Number(id)] = (out[Number(id)] ?? 0) + n;
  return out;
};

export type ReportResult = { ok: true; battle: Battle; added: string[]; skipped: string[] } | { ok: false };

/**
 * Takes a pasted battle report into the state: attackers are matched to participants by name (new ones are added
 * up to the ACS limit, an unnamed participant row is filled first), several fleets of one player are summed up.
 * Changes only `state.participants`; the caller puts the returned battle in place.
 */
export function battleFromReport(state: LootState, text: string): ReportResult {
  const report = parseCombatReportText(text, null);
  if (!report) return { ok: false };
  const added: string[] = [];
  const skipped: string[] = [];
  const byName = new Map(state.participants.filter((p) => p.name).map((p) => [p.name.toLowerCase(), p.id]));
  const fleets = new Map<string, { start: Ships; end: Ships }>();
  for (const f of report.fleets) {
    if (f.side !== 'attacker') continue;
    let id = byName.get(f.name.toLowerCase());
    if (!id) {
      const blank = state.participants.find((p) => !p.name);
      if (blank) {
        blank.name = f.name;
        id = blank.id;
      } else if (state.participants.length < MAX_PARTICIPANTS) {
        id = newId(state, 'p');
        state.participants.push({ id, name: f.name, flightDeut: 0, recDeut: 0, missiles: 0 });
      } else {
        skipped.push(f.name);
        continue;
      }
      byName.set(f.name.toLowerCase(), id);
      added.push(f.name);
    }
    const cur = fleets.get(id) ?? { start: {}, end: {} };
    fleets.set(id, { start: addShips(cur.start, f.start), end: addShips(cur.end, f.end) });
  }
  // public report pages show the server time in UTC
  const time = report.time ? Date.parse(report.time.replace(' ', 'T') + 'Z') / 1000 : NaN;
  return {
    ok: true,
    battle: {
      time: Number.isFinite(time) ? time : null,
      loot: { m: report.loot.metal, k: report.loot.crystal, d: report.loot.deuterium },
      fleets: [...fleets].map(([participant, f]) => ({ participant, start: f.start, end: f.end })),
    },
    added,
    skipped,
  };
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
