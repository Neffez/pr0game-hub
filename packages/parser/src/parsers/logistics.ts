// Message parsers (no cheerio) for what a loot settlement needs beyond battles: transports between planets (the
// deliveries), interplanetary missile impacts and recyclers coming home.
import type { MissileImpactRecord, RecycleReturnRecord, TransportRecord } from '../types.js';
import { parseNumber, type LocalDateTime } from '../util.js';

const C = String.raw`\[(\d+):(\d+):(\d+)\]`;
const N = String.raw`([\d.,]+)\s*\S+`;
const n = (v: string) => parseNumber(v) ?? 0;
const coords = (m: RegExpMatchArray, i: number) => ({ g: Number(m[i]), s: Number(m[i + 1]), p: Number(m[i + 2]) });

/**
 * sys_tran_mess_owner (the sender's copy, DE/EN, pirate language with "Hafen"/"Insel"): "Eine deiner Flotten von NAME
 * [g:s:p] erreicht den Planeten NAME [g:s:p] und liefert 1.000 Metall, 0 Kristall und 0 Deuterium."
 */
const OWN_DE_RE = new RegExp(String.raw`Eine deiner Flotten von .*?${C}\s*erreicht den (\S+) .*?${C}\s*und liefert\s+${N},\s*${N}\s+und\s+${N}`);
const OWN_EN_RE = new RegExp(String.raw`One of your fleets from .*?${C}\s*reaches the (\S+) .*?${C}\s*and delivers\s+${N},\s*${N}\s+and\s+${N}`);
/** sys_tran_mess_user (the receiver's copy): "Eine friedliche Flotte von NAME [g:s:p] erreicht NAME [g:s:p] und liefert …" */
const FOREIGN_DE_RE = new RegExp(String.raw`Eine friedliche Flotte von .*?${C}\s*erreicht .*?${C}\s*und liefert\s+${N},\s*${N}\s+und\s+${N}`);
const FOREIGN_EN_RE = new RegExp(String.raw`A peaceful fleet of .*?${C}\s*reached .*?${C}\s*and delivers\s+${N},\s*${N}\s+and\s+${N}`);
export const TRANSPORT_START_RE = /(?:Eine deiner Flotten von|One of your fleets from|Eine friedliche Flotte von|A peaceful fleet of)/;

export function parseTransportText(text: string, msgId: number | null, time: LocalDateTime | null): TransportRecord | null {
  const flat = text.replace(/\s+/g, ' ');
  const own = flat.match(OWN_DE_RE) ?? flat.match(OWN_EN_RE);
  if (own) {
    return {
      kind: 'transport', msgId, time, side: 'own', from: coords(own, 1), to: coords(own, 5),
      toType: /^(Mond|Moon|Insel)$/i.test(own[4]) ? 'moon' : 'planet',
      metal: n(own[8]), crystal: n(own[9]), deuterium: n(own[10]),
    };
  }
  const foreign = flat.match(FOREIGN_DE_RE) ?? flat.match(FOREIGN_EN_RE);
  if (!foreign) return null;
  return {
    kind: 'transport', msgId, time, side: 'foreign', from: coords(foreign, 1), to: coords(foreign, 4), toType: null,
    metal: n(foreign[7]), crystal: n(foreign[8]), deuterium: n(foreign[9]),
  };
}

/**
 * sys_irak_mess (sender's and target's copy): "Interplanetarraketen (5) von PLANET [g:s:p] sind auf dem Planeten
 * NAME [g:s:p] eingeschlagen", pirate language "Brandbomben … auf dem Hafen", EN "Interplanetary rockets (5) from
 * PLANET [g:s:p] are on the planet NAME [g:s:p]".
 */
const MISSILE_DE_RE = new RegExp(String.raw`(?:Interplanetarraketen|Brandbomben) \((\d+)\) von .*?${C}\s*sind auf dem \S+ .*?${C}\s*eingeschlagen`);
const MISSILE_EN_RE = new RegExp(String.raw`Interplanetary rockets \((\d+)\) from .*?${C}\s*are on the planet .*?${C}`);
export const MISSILE_START_RE = /(?:Interplanetarraketen \(|Brandbomben \(|Interplanetary rockets \()/;

export function parseMissileImpactText(text: string, msgId: number | null, time: LocalDateTime | null): MissileImpactRecord | null {
  const flat = text.replace(/\s+/g, ' ');
  const m = flat.match(MISSILE_DE_RE) ?? flat.match(MISSILE_EN_RE);
  if (!m) return null;
  return { kind: 'missileImpact', msgId, time, count: Number(m[1]), from: coords(m, 2), target: coords(m, 5) };
}

/**
 * sys_recy_mess: "Eine deiner Recycler-Flotten kehrt nach NAME [g:s:p] mit 1.000 Metall, 500 Kristall und 0
 * Deuterium zurück." (pirate language "Wracktaucher-Gruppen"), EN "One of your recycler fleets returns to NAME [g:s:p]
 * with …".
 */
const RECYCLE_RETURN_DE_RE = new RegExp(String.raw`Eine deiner (?:Recycler-Flotten|Wracktaucher-Gruppen) kehrt nach .*?${C}\s*mit\s+${N},\s*${N}\s+und\s+${N}\s+zurück`);
const RECYCLE_RETURN_EN_RE = new RegExp(String.raw`One of your recycler fleets returns to .*?${C}\s*with\s+${N},\s*${N}\s+and\s+${N}`);
export const RECYCLE_RETURN_START_RE = /(?:Eine deiner (?:Recycler-Flotten|Wracktaucher-Gruppen) kehrt nach|One of your recycler fleets returns to)/;

export function parseRecycleReturnText(text: string, msgId: number | null, time: LocalDateTime | null): RecycleReturnRecord | null {
  const flat = text.replace(/\s+/g, ' ');
  const m = flat.match(RECYCLE_RETURN_DE_RE) ?? flat.match(RECYCLE_RETURN_EN_RE);
  if (!m) return null;
  return { kind: 'recycleReturn', msgId, time, home: coords(m, 1), metal: n(m[4]), crystal: n(m[5]), deuterium: n(m[6]) };
}
