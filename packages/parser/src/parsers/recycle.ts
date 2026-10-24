// Recycling report parser without the HTML parsers (no cheerio), shared by the message page and the static tools.
import type { RecycleRecord } from '../types.js';
import { parseNumber, type LocalDateTime } from '../util.js';

/** sys_recy_gotten (DE/EN, pirate language: "Wracktaucher"); the coordinates are a link, resource names are words. */
const RECYCLE_DE_RE =
  /Deine (?:Recycler|Wracktaucher) haben an den Koordinaten.*?\[(\d+):(\d+):(\d+)\]\s*([\d.,]+)\s*\S+\s+und\s+([\d.,]+)\s*\S+\s+von insgesamt\s+([\d.,]+)\s*\S+\s+und\s+([\d.,]+)\s*\S+\s+gesammelt/;
const RECYCLE_EN_RE =
  /Your recyclers have collected\s+([\d.,]+)\s*\S+\s+and\s+([\d.,]+)\s*\S+\s+from a total of\s+([\d.,]+)\s*\S+\s+and\s+([\d.,]+)\s*\S+\s+at coordinates.*?\[(\d+):(\d+):(\d+)\]/;
export const RECYCLE_START_RE = /(?:Deine (?:Recycler|Wracktaucher) haben an den Koordinaten|Your recyclers have collected)/;

export function parseRecycleText(text: string, msgId: number | null, time: LocalDateTime | null): RecycleRecord | null {
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

/** Every recycling report in a pasted text (one or more messages copied from the game), in text order. */
export function parseRecycleReportsText(text: string): RecycleRecord[] {
  const starts = [...text.matchAll(new RegExp(RECYCLE_START_RE.source, 'g'))].map((m) => m.index!);
  return starts
    .map((at, i) => parseRecycleText(text.slice(at, starts[i + 1] ?? text.length), null, null))
    .filter((r): r is RecycleRecord => r !== null);
}
