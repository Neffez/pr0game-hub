import { ELEMENT_COSTS } from '@pr0hub/core/tech';
import combatData from './data/combat.json' with { type: 'json' };
import { LIVE_BIGSHIELD, LIVE_RAPIDFIRE_AGAINST, LIVE_STUN, LIVE_UNITS } from './live.js';

/** Combat values of a unit before research (the game's `CombatCaps` plus the hull from the costs). */
export interface CombatUnit {
  attack: number;
  shield: number;
  /** hull points: (metal + crystal) / 10 */
  hull: number;
  /** target id -> shots */
  rapidfire: Record<number, number>;
  /** stun factor (0: none) */
  stun: number;
  /** ship shield (shield domes): must fall before other units can be hit */
  bigshield: boolean;
}

type Raw = Record<string, { attack: number; shield: number; rapidfire: Record<string, number> }>;

/** Ships 202-215 and defense 401-408 from install.sql, the later ships and engine abilities from `live.ts`. */
function build(): Record<number, CombatUnit> {
  const units: Record<number, CombatUnit> = {};
  const raw = combatData as Raw;
  const ids = [...Object.keys(raw), ...Object.keys(LIVE_UNITS)].map(Number);
  for (const id of ids) {
    const base = raw[id];
    const live = LIVE_UNITS[id];
    const [metal, crystal] = ELEMENT_COSTS[id] ?? [0, 0];
    const rapidfire: Record<number, number> = {};
    for (const [target, shots] of Object.entries(live?.rapidfire ?? base?.rapidfire ?? {})) rapidfire[Number(target)] = shots;
    Object.assign(rapidfire, LIVE_RAPIDFIRE_AGAINST[id]);
    units[id] = {
      attack: live?.attack ?? base?.attack ?? 0,
      shield: live?.shield ?? base?.shield ?? 0,
      hull: (metal + crystal) / 10,
      rapidfire,
      stun: LIVE_STUN[id] ?? 0,
      bigshield: LIVE_BIGSHIELD.includes(id),
    };
  }
  return units;
}

export const UNITS: Record<number, CombatUnit> = build();

/** Ships in the order of the game (solar satellite included: it fights as a defender). */
export const SHIP_IDS = Object.keys(UNITS).map(Number).filter((id) => id < 300).sort((a, b) => a - b);
export const DEFENSE_IDS = Object.keys(UNITS).map(Number).filter((id) => id >= 400).sort((a, b) => a - b);
