import type { CombatFleet, CombatReportRecord } from '../types.js';
import { idByShortName } from '../tech.js';
import { parseGameDate, parseNumber } from '../util.js';

/**
 * Battle report page (page=raport), as public viewers see it. Works on the page text, so both the
 * classic and the "rust" template are covered: per round every fleet is listed as
 * "Angreifer NAME (…)", "Typ" + short names, "Anzahl" + amounts (or "Zerstört!").
 * The first round is the fleet before the battle, the last one what is left.
 */
const MOON_DESTRUCTION_INTRO =
  /(?:zur (?:Mondzerstörung|Inselzerstörung) gegenüber|The following fleets face each other for a moon destruction:)/;
const START_RE =
  /(?:Folgende Flotten stehen sich(?: zur (?:Mondzerstörung|Inselzerstörung))? gegenüber am|The following fleets face each other on:?|The following fleets face each other for a moon destruction:)\s*(.+)/;

export function isMoonDestructionCombatText(text: string): boolean {
  return MOON_DESTRUCTION_INTRO.test(text);
}
const HEADER_RE = /^(Angreifer|Verteidiger|Attacker|Defender)\s+(.+?)\s*\((?:\[[^\]]*\]|[^)]*)\)/;
// coordinates in a header, "([3:195:5] (M))" on a moon; public pages hide them ("[XX:XX:XX]")
const HEADER_COORDS_RE = /\[(\d+):(\d+):(\d+)\](\s*\((?:M|Mond|Moon)\))?/;
// "Er erbeutet 1.000 Metall, 2.000 Kristall und 3.000 Deuterium" / "They loot 1,000 Metal, …" (the debris line has no
// deuterium, so three amounts only match the loot)
const LOOT_RE =
  /([\d.,]+)\s*(?:Metall|Metal|Holz)\s*,\s*([\d.,]+)\s*(?:Kristall|Crystal|Gold)\s*(?:,|und|and)\s*([\d.,]+)\s*(?:Deuterium|Rum)/;
// "Bewaff. 250% - Schilde 230% - Hülle 240%" below a fleet's header: 100 % base plus 10 % per research level
const TECH_RE = /^(?:Bewaff\.|Weapons?:?)\s*(\d+)\s*%\s*-?\s*(?:Schilde|Shields?:?)\s*(\d+)\s*%\s*-?\s*(?:Hülle|Armou?r:?|Hull:?)\s*(\d+)\s*%/;
const END_RE = /(Der Angreifer hat die Schlacht gewonnen|Der Verteidiger hat die Schlacht gewonnen|Der Kampf endet mit einem Unentschieden|The attacker has won the battle|The defender has won the battle|The fight ends in a draw)/;

// fleets of a battle simulation are only numbered ("Angreifer Nr.1"), its coordinates are placeholders
const SIM_NAME_RE = /^(?:Angreifer|Verteidiger|Attacker|Defender)\s+(?:Nr\.|No\.)\s*\d+$/;

/** A battle simulation, not a battle: every fleet only numbered. Its time and coordinates mean nothing. */
export function isCombatSimulation(r: CombatReportRecord): boolean {
  return r.fleets.length > 0 && r.fleets.every((f) => SIM_NAME_RE.test(f.name));
}

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
  type Block = { side: 'attacker' | 'defender'; name: string; from: CombatFleet['from']; research?: Record<number, number>; ships: Record<number, number> };
  const rounds: Block[][] = [[]];
  let cur: Block | null = null;
  let target: CombatReportRecord['target'] = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const h = t.match(HEADER_RE);
    if (h) {
      const side = /^(Angreifer|Attacker)$/.test(h[1]) ? 'attacker' : 'defender';
      const c = t.match(HEADER_COORDS_RE);
      const from: CombatFleet['from'] = c ? { coords: { g: Number(c[1]), s: Number(c[2]), p: Number(c[3]) }, type: c[4] ? 'moon' : 'planet' } : null;
      // the first defender is the attacked planet
      if (side === 'defender' && rounds.length === 1 && !target && from) target = from;
      const round = rounds.at(-1)!;
      if (side === 'attacker' && round.some((b) => b.side === 'defender')) rounds.push([]);
      cur = { side, name: h[2].trim(), from, ships: {} };
      rounds.at(-1)!.push(cur);
      continue;
    }
    const tech = cur && !cur.research ? t.match(TECH_RE) : null;
    if (tech) {
      const level = (pct: string) => Math.max(0, Math.round((Number(pct) - 100) / 10));
      cur!.research = { 109: level(tech[1]), 110: level(tech[2]), 111: level(tech[3]) };
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
    const fleet: CombatFleet = { side: b.side, name: b.name, from: b.from, start: b.ships, end: rounds.length > 1 ? (after?.ships ?? {}) : b.ships };
    if (b.research) fleet.research = b.research;
    return fleet;
  });

  const tail = text.slice(end.index);
  const num = (re: RegExp) => parseNumber(tail.match(re)?.[1]) ?? 0;
  const winText = end[1];
  const loot = tail.match(LOOT_RE);
  return {
    kind: 'combatReport',
    moonDestruction: isMoonDestructionCombatText(text),
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
    target,
    loot: { metal: parseNumber(loot?.[1]) ?? 0, crystal: parseNumber(loot?.[2]) ?? 0, deuterium: parseNumber(loot?.[3]) ?? 0 },
    fleets,
  };
}
