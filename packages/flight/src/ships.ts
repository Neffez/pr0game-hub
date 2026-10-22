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

/** Ships 202-215 from install.sql; 222-232 are not in install.sql, values from the in-game ship info. */
export const SHIPS: Record<number, ShipDrives> = {
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
