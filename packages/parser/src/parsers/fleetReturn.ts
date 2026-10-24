// Fleet return message parser (no cheerio): what an attack fleet brings home.
import type { FleetReturnRecord } from '../types.js';
import { parseNumber, type LocalDateTime } from '../util.js';

/**
 * sys_fleet_won (DE/EN, pirate language "beim Hafen"): "Eine deiner Flotten kehrt vom Angriff beim Planeten NAME
 * [g:s:p] zurück zu NAME [g:s:p]. Sie haben 0 Metall, 1.000 Kristall und 2.000 Deuterium erbeutet"; the coordinates are
 * links, resource names are words. The game names the whole cargo of the fleet (`fleet_resource_*`).
 */
const RETURN_DE_RE =
  /Eine deiner Flotten kehrt vom Angriff beim .*?\[(\d+):(\d+):(\d+)\].*?zurück zu .*?\[(\d+):(\d+):(\d+)\]\.?\s*Sie haben\s+([\d.,]+)\s*\S+,\s*([\d.,]+)\s*\S+\s+und\s+([\d.,]+)\s*\S+\s+erbeutet/;
const RETURN_EN_RE =
  /One of your fleets returns from a(?:n)? attack at the planet .*?\[(\d+):(\d+):(\d+)\].*?\bto .*?\[(\d+):(\d+):(\d+)\]\.?\s*You have captured\s+([\d.,]+)\s*\S+,\s*([\d.,]+)\s*\S+\s+and\s+([\d.,]+)\s*\S+/;
export const FLEET_RETURN_START_RE = /(?:Eine deiner Flotten kehrt vom Angriff beim|One of your fleets returns from an? attack at)/;

export function parseFleetReturnText(text: string, msgId: number | null, time: LocalDateTime | null): FleetReturnRecord | null {
  const flat = text.replace(/\s+/g, ' ');
  const m = flat.match(RETURN_DE_RE) ?? flat.match(RETURN_EN_RE);
  if (!m) return null;
  const n = (v: string) => parseNumber(v) ?? 0;
  return {
    kind: 'fleetReturn', msgId, time,
    target: { g: Number(m[1]), s: Number(m[2]), p: Number(m[3]) },
    home: { g: Number(m[4]), s: Number(m[5]), p: Number(m[6]) },
    metal: n(m[7]), crystal: n(m[8]), deuterium: n(m[9]),
  };
}
