/**
 * Drive data per ship from the game's `vars` table. Index 0-2 = combustion, impulse, hyperspace.
 * `tech`: 0 = drive not available, 1 = always used, N > 1 = used from research level N (higher drives win).
 */
export interface ShipDrives {
  speed: [number, number, number];
  tech: [number, number, number];
  consumption: [number, number, number];
}

const ship = (speed: ShipDrives['speed'], tech: ShipDrives['tech'], consumption: ShipDrives['consumption']): ShipDrives => ({
  speed,
  tech,
  consumption,
});

/** Ship id -> drive data; custom ships (flight calculator) may use string ids. */
export type ShipCatalog = Record<string, ShipDrives>;

/** Ships 202-215 from install.sql; 222-232 are not in install.sql, values from the in-game ship info. */
export const SHIPS: ShipCatalog = {
  202: ship([5000, 10000, 0], [1, 5, 0], [10, 20, 0]),
  203: ship([7500, 0, 0], [1, 0, 0], [50, 0, 0]),
  204: ship([12500, 0, 0], [1, 0, 0], [20, 0, 0]),
  205: ship([0, 10000, 0], [0, 1, 0], [0, 75, 0]),
  206: ship([0, 15000, 0], [0, 1, 0], [0, 300, 0]),
  207: ship([0, 0, 10000], [0, 0, 1], [0, 0, 500]),
  208: ship([0, 2500, 0], [0, 1, 0], [0, 1000, 0]),
  209: ship([2000, 4000, 6000], [1, 17, 15], [300, 300, 300]),
  210: ship([100000000, 0, 0], [1, 0, 0], [1, 0, 0]),
  211: ship([0, 4000, 5000], [0, 1, 8], [0, 700, 700]),
  213: ship([0, 0, 5000], [0, 0, 1], [0, 0, 1000]),
  214: ship([0, 0, 100], [0, 0, 1], [0, 0, 1]),
  215: ship([0, 0, 10000], [0, 0, 1], [0, 0, 250]),
  222: ship([0, 0, 7500], [0, 0, 1], [0, 0, 500]),
  225: ship([6500, 10000, 0], [1, 4, 0], [40, 50, 0]),
  227: ship([0, 4000, 0], [0, 1, 0], [0, 900, 0]),
  231: ship([0, 0, 2500], [0, 0, 1], [0, 0, 1000]),
  232: ship([0, 0, 400], [0, 0, 1], [0, 0, 5000]),
};

/**
 * Cargo capacity per ship (`vars.capacity`, not changed by research). 202-215 from install.sql, 222-232 from the
 * in-game ship info. Spy probes (210) carry nothing on raids (`calculateSteal`), see `raidCapacity`.
 */
export const CAPACITY: Record<number, number> = {
  202: 5000,
  203: 25000,
  204: 50,
  205: 100,
  206: 800,
  207: 1500,
  208: 7500,
  209: 20000,
  210: 5,
  211: 500,
  213: 2000,
  214: 1000000,
  215: 750,
  222: 1000,
  225: 3500,
  227: 35000,
  231: 100000,
  232: 200000,
};

/** Cargo capacity of a fleet. `raid`: without spy probes, as the game counts it for loot. */
export function fleetCapacity(fleet: Record<number | string, number>, raid = false): number {
  let total = 0;
  for (const [id, amount] of Object.entries(fleet)) {
    if (raid && id === '210') continue;
    total += (CAPACITY[Number(id)] ?? 0) * amount;
  }
  return total;
}
