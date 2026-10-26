import { fleetCapacity } from '@pr0hub/flight';

export interface Resources {
  metal: number;
  crystal: number;
  deuterium: number;
}

/**
 * Loot of a won battle as the game's simulator takes it (`BattleHandler::calculateSteal` with `$simulate`): the free
 * cargo space of the surviving attackers (spy probes left out, resources already on board taken off), at most half
 * of each resource of the planet; metal first with a third of the space, crystal with half of the rest, deuterium
 * with the rest, then metal and crystal fill what is left. Protected resources and honour points don't count in a
 * simulation.
 */
export function steal(fleets: { units: Record<string, number>; carried?: number }[], planet: Resources): Resources {
  let capacity = fleets.reduce((sum, f) => sum + Math.max(0, fleetCapacity(f.units, true) - (f.carried ?? 0)), 0);
  if (capacity <= 0) return { metal: 0, crystal: 0, deuterium: 0 };
  const half = { metal: planet.metal / 2, crystal: planet.crystal / 2, deuterium: planet.deuterium / 2 };

  let metal = Math.min(capacity / 3, half.metal, Math.max(0, planet.metal));
  capacity -= metal;
  let crystal = Math.min(capacity / 2, half.crystal, Math.max(0, planet.crystal));
  capacity -= crystal;
  const deuterium = Math.min(capacity, half.deuterium, Math.max(0, planet.deuterium));
  capacity -= deuterium;
  const metalBefore = metal;
  metal += Math.min(capacity / 2, half.metal - metal, Math.max(0, planet.metal - metal));
  capacity -= metal - metalBefore;
  crystal += Math.min(capacity, half.crystal - crystal, Math.max(0, planet.crystal - crystal));

  return {
    metal: Math.floor(Math.max(0, metal)),
    crystal: Math.floor(Math.max(0, crystal)),
    deuterium: Math.floor(Math.max(0, deuterium)),
  };
}
