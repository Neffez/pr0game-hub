// Recycling report parser without the HTML parsers (no cheerio), shared by the message page and the static tools.
import type { RecycleRecord } from '../types.js';
import { GAME_DATE_RE, parseGameDate, parseNumber, type LocalDateTime } from '../util.js';

/**
 * sys_recy_gotten (DE/EN, pirate language: "Wracktaucher"); the coordinates are a link, resource names are words. The
 * field's totals may be empty: game versions since September 2026 leave them out ("von insgesamt  Metall und  Kristall").
 */
const RECYCLE_DE_RE =
  /Deine (?:Recycler|Wracktaucher) haben an den Koordinaten.*?\[(\d+):(\d+):(\d+)\]\s*([\d.,]+)\s*\S+\s+und\s+([\d.,]+)\s*\S+\s+von insgesamt\s*([\d.,]*)\s*\S+\s+und\s*([\d.,]*)\s*\S+\s+gesammelt/;
const RECYCLE_EN_RE =
  /Your recyclers have collected\s+([\d.,]+)\s*\S+\s+and\s+([\d.,]+)\s*\S+\s+from a total of\s*([\d.,]*)\s*\S+\s+and\s*([\d.,]*)\s*\S+\s+at coordinates.*?\[(\d+):(\d+):(\d+)\]/;
export const RECYCLE_START_RE = /(?:Deine (?:Recycler|Wracktaucher) haben an den Koordinaten|Your recyclers have collected)/;
/** bs_derbis_raport, the line after the report: recyclers still needed for what is left of the field. */
const NEEDED_DE_RE = /Es werden\s+([\d.,]+)\s+\S+\s+für das Trümmerfeld benötigt/;
const NEEDED_EN_RE = /Required for recycling debris:\s*([\d.,]+)/;

/**
 * The report's numbers to a record. Without the field's totals they follow from the recyclers still needed: none means
 * the field was emptied (totals = collected); otherwise they stay unknown (null) and the server estimates the rest
 * from the recyclers needed. Without totals and that line nothing is known about the field: no record.
 */
function record(
  msgId: number | null, time: LocalDateTime | null, coords: RecycleRecord['coords'], metal: number, crystal: number,
  totalMetal: number | null, totalCrystal: number | null, recyclersNeeded: number | null,
): RecycleRecord | null {
  const r: RecycleRecord = { kind: 'recycle', msgId, time, coords, metal, crystal, totalMetal, totalCrystal };
  if (recyclersNeeded != null) r.recyclersNeeded = recyclersNeeded;
  if (totalMetal != null && totalCrystal != null) return r;
  if (recyclersNeeded == null) return null;
  if (recyclersNeeded === 0) return { ...r, totalMetal: metal, totalCrystal: crystal };
  return { ...r, totalMetal: null, totalCrystal: null };
}

export function parseRecycleText(text: string, msgId: number | null, time: LocalDateTime | null): RecycleRecord | null {
  const flat = text.replace(/\s+/g, ' ');
  const n = (v: string) => parseNumber(v) ?? 0;
  const opt = (v: string | undefined) => (v ? parseNumber(v) : null);
  const needed = opt((flat.match(NEEDED_DE_RE) ?? flat.match(NEEDED_EN_RE))?.[1]);
  const de = flat.match(RECYCLE_DE_RE);
  if (de) {
    return record(msgId, time, { g: Number(de[1]), s: Number(de[2]), p: Number(de[3]) }, n(de[4]), n(de[5]), opt(de[6]), opt(de[7]), needed);
  }
  const en = flat.match(RECYCLE_EN_RE);
  if (en) {
    return record(msgId, time, { g: Number(en[5]), s: Number(en[6]), p: Number(en[7]) }, n(en[1]), n(en[2]), opt(en[3]), opt(en[4]), needed);
  }
  return null;
}

/**
 * Every recycling report in a pasted text (one or more messages copied from the game), in text order; the time is the
 * last date between the previous report and this one (the message header).
 */
export function parseRecycleReportsText(text: string): RecycleRecord[] {
  const starts = [...text.matchAll(new RegExp(RECYCLE_START_RE.source, 'g'))].map((m) => m.index!);
  return starts
    .map((at, i) => {
      const head = text.slice(i ? starts[i - 1] : 0, at);
      const date = [...head.matchAll(new RegExp(GAME_DATE_RE.source, 'g'))].at(-1);
      return parseRecycleText(text.slice(at, starts[i + 1] ?? text.length), null, date ? parseGameDate(date[0]) : null);
    })
    .filter((r): r is RecycleRecord => r !== null);
}
