import { UNITS } from './units.js';

/** Weapons, shields and armour technology. */
export const WEAPONS = 109;
export const SHIELDS = 110;
export const ARMOUR = 111;

/** One fleet (slot) of a side: units by id and research levels by id. */
export interface BattleFleet {
  units: Record<string, number>;
  research: Record<string, number>;
}

/** A unit as the Rust engine takes it (`ParseShipInfo` of Battlerust). */
export interface EngineShip {
  shipid: number;
  attack: number;
  hull: number;
  shield: number;
  bigshield: boolean;
  stun: number;
  explode: number;
  amount: number;
  rapidfire: Record<string, number>;
}

export interface EngineInput {
  rounds: number;
  attacker: { name: number; ships: EngineShip[] }[];
  defender: { name: number; ships: EngineShip[] }[];
}

/** The game fights 6 rounds. */
export const ROUNDS = 6;
/** Ships explode below 70 % of their hull. */
const EXPLODE = 0.7;

const round1 = (n: number) => Math.round(n * 10) / 10;

function ships(fleet: BattleFleet, attacker: boolean): EngineShip[] {
  const level = (id: number) => fleet.research[id] ?? 0;
  return Object.entries(fleet.units)
    .filter(([id, n]) => n > 0 && UNITS[Number(id)])
    .map(([key, amount]) => {
      const id = Number(key);
      const u = UNITS[id];
      const attack = u.attack * (1 + 0.1 * level(WEAPONS));
      return {
        shipid: id,
        attack: attacker ? round1(attack) : Math.round(attack),
        hull: Math.round(u.hull * (1 + 0.1 * level(ARMOUR))),
        shield: Math.round(u.shield * (1 + 0.1 * level(SHIELDS))),
        bigshield: u.bigshield,
        stun: u.stun,
        // attackers' units all explode, of the defender only ships (TODO in the game: "move to database")
        explode: attacker || Math.floor(id / 100) === 2 ? EXPLODE : 0,
        amount: Math.floor(amount),
        rapidfire: { ...u.rapidfire },
      };
    });
}

/**
 * Input of the Rust engine like the game builds it (`BattleEngineRust::createRustJson`): research raises attack,
 * shield and hull by 10 % per level, the attackers' attack is rounded to one decimal, everything else to integers.
 * The fleets are named by their slot (attackers from 0, the defending planet is defender 0).
 */
export function engineInput(attackers: BattleFleet[], defenders: BattleFleet[], rounds = ROUNDS): EngineInput {
  return {
    rounds,
    attacker: attackers.map((f, i) => ({ name: i, ships: ships(f, true) })),
    defender: defenders.map((f, i) => ({ name: i, ships: ships(f, false) })),
  };
}
