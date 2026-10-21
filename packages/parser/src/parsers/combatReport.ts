import type { CombatFleet, CombatReportRecord } from '../types.js';
import { idByShortName } from '../tech.js';
import { parseGameDate, parseNumber } from '../util.js';

/**
 * Battle report page (page=raport), as public viewers see it. Works on the page text, so both the
 * classic and the "rust" template are covered: per round every fleet is listed as
 * "Angreifer NAME (…)", "Typ" + short names, "Anzahl" + amounts (or "Zerstört!").
 * The first round is the fleet before the battle, the last one what is left.
 */
const START_RE = /(?:Folgende Flotten stehen sich gegenüber am|The following fleets face each other on:?)\s*(.+)/;
const HEADER_RE = /^(Angreifer|Verteidiger|Attacker|Defender)\s+(.+?)\s*\((?:\[[^\]]*\]|[^)]*)\)/;
const END_RE = /(Der Angreifer hat die Schlacht gewonnen|Der Verteidiger hat die Schlacht gewonnen|Der Kampf endet mit einem Unentschieden|The attacker has won the battle|The defender has won the battle|The fight ends in a draw)/;

export function isCombatReportText(text: string): boolean {
  return START_RE.test(text) && END_RE.test(text);
}

export function parseCombatReportText(text: string, reportId: string | null): CombatReportRecord | null {
  const start = text.match(START_RE);
  const end = text.match(END_RE);
  if (!start || !end || end.index == null) return null;
  const tokens = text
    .slice(start.index! + start[0].length - start[1].length, end.index)
    .split(/[\n\t]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // blocks in order; a new round starts when an attacker follows a defender
  type Block = { side: 'attacker' | 'defender'; name: string; ships: Record<number, number> };
  const rounds: Block[][] = [[]];
  let cur: Block | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const h = t.match(HEADER_RE);
    if (h) {
      const side = /^(Angreifer|Attacker)$/.test(h[1]) ? 'attacker' : 'defender';
      const round = rounds.at(-1)!;
      if (side === 'attacker' && round.some((b) => b.side === 'defender')) rounds.push([]);
      cur = { side, name: h[2].trim(), ships: {} };
      rounds.at(-1)!.push(cur);
      continue;
    }
    if (cur && /^(Typ|Type)$/.test(t)) {
      const names: string[] = [];
      let j = i + 1;
      for (; j < tokens.length && !/^(Anzahl|Amount)$/.test(tokens[j]); j++) names.push(tokens[j]);
      const amounts: number[] = [];
      for (j++; j < tokens.length && amounts.length < names.length; j++) {
        if (/^\(.*\)$/.test(tokens[j])) continue; // "(-12)" loss of this round
        const n = parseNumber(tokens[j]);
        if (n != null) amounts.push(n);
      }
      names.forEach((name, k) => {
        const id = idByShortName(name);
        if (id != null && amounts[k] != null) cur!.ships[id] = amounts[k];
      });
      cur = null;
      i = j - 1;
    }
  }

  const first = rounds[0];
  const last = rounds.at(-1)!;
  const fleets: CombatFleet[] = first.map((b) => {
    // same position within the side in the last round (destroyed fleets are listed without ships)
    const sameSide = (r: Block[]) => r.filter((x) => x.side === b.side);
    const idx = sameSide(first).indexOf(b);
    const after = sameSide(last)[idx];
    return { side: b.side, name: b.name, start: b.ships, end: rounds.length > 1 ? (after?.ships ?? {}) : b.ships };
  });

  const tail = text.slice(end.index);
  const num = (re: RegExp) => parseNumber(tail.match(re)?.[1]) ?? 0;
  const winText = end[1];
  return {
    kind: 'combatReport',
    reportId,
    // public pages show "20 Oct 2026, 10:29:25" (server time in UTC)
    time: parseGameDate(start[1]) ?? parseGameDate(start[1].replace(/^(\d{1,2})\s+/, '$1. ')),
    winner: /Angreifer hat|attacker has/.test(winText) ? 'attacker' : /Verteidiger hat|defender has/.test(winText) ? 'defender' : 'draw',
    rounds: rounds.length - 1,
    lost: {
      attacker: num(/(?:Der Angreifer hat insgesamt|The attacker'?s losses:)\s*([\d.,]+)/),
      defender: num(/(?:Der Verteidiger hat insgesamt|The defender'?s losses:)\s*([\d.,]+)/),
    },
    debris: {
      metal: num(/(?:liegen nun|are now:)\s*([\d.,]+)/),
      crystal: num(/(?:liegen nun|are now:)\s*[\d.,]+\s*\S+\s+(?:und|and)\s+([\d.,]+)/),
    },
    fleets,
  };
}
