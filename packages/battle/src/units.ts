import { activeUnits, DEFAULT_UNITS, type UnitCatalog } from '@pr0hub/core/units';
import { LIVE_BIGSHIELD, LIVE_STUN } from './live.js';

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

const cache = new WeakMap<UnitCatalog, Record<number, CombatUnit>>();

/**
 * Units that fight (ships and defense, not missiles) of a unit catalog: attack, shield and rapidfire from the
 * catalog, the hull from its costs, the engine abilities (stun, shield domes) from `live.ts`.
 */
export function combatUnits(catalog: UnitCatalog = activeUnits()): Record<number, CombatUnit> {
  let units = cache.get(catalog);
  if (units) return units;
  units = {};
  for (const u of Object.values(catalog.units)) {
    if (u.id >= 500) continue;
    const rapidfire: Record<number, number> = {};
    for (const [target, shots] of Object.entries(u.rapidfire)) rapidfire[Number(target)] = shots;
    units[u.id] = {
      attack: u.attack,
      shield: u.shield,
      hull: (u.cost[0] + u.cost[1]) / 10,
      rapidfire,
      stun: LIVE_STUN[u.id] ?? 0,
      bigshield: LIVE_BIGSHIELD.includes(u.id),
    };
  }
  cache.set(catalog, units);
  return units;
}

/** Combat values of the default catalog. */
export const UNITS: Record<number, CombatUnit> = combatUnits(DEFAULT_UNITS);

/** Ships in the order of the game (solar satellite included: it fights as a defender). */
export const shipIds = (catalog: UnitCatalog = activeUnits()) => Object.keys(combatUnits(catalog)).map(Number).filter((id) => id < 300);
export const defenseIds = (catalog: UnitCatalog = activeUnits()) => Object.keys(combatUnits(catalog)).map(Number).filter((id) => id >= 400);
export const SHIP_IDS = shipIds(DEFAULT_UNITS);
export const DEFENSE_IDS = defenseIds(DEFAULT_UNITS);

/** The battleship: ships from its hull up count as heavy. */
const BATTLESHIP = 207;

/**
 * The heavy ships of a fleet: ships that fight with at least the hull of a battleship (battleship, battlecruiser,
 * bomber, destroyer, deathstar and the universe's own large ships). Raiders often send only these against defense and
 * solar satellites: fewer losses and less deuterium, but less cargo space.
 */
export function heavyShips(fleet: Record<string, number>, catalog: UnitCatalog = activeUnits()): Record<string, number> {
  const units = combatUnits(catalog);
  const min = units[BATTLESHIP]?.hull ?? 6000;
  return Object.fromEntries(Object.entries(fleet).filter(([id, n]) => n > 0 && Number(id) < 300 && (units[Number(id)]?.attack ?? 0) > 0 && (units[Number(id)]?.hull ?? 0) >= min));
}
