/**
 * Ports of the game's interplanetary missile code: FleetFunctions::inMissileRange and getMIPDuration, the attack of
 * MissionCaseMIP::TargetEvent with calculateMIPAttack, and the silo space of BuildFunctions::getMaxConstructibleRockets.
 */
import { MIN_FLEET_TIME, type Coords, type Universe } from './flight.js';

export const INTERCEPTOR = 502;
export const INTERPLANETARY = 503;
/** The primary target the game falls back to (missile launcher). */
export const DEFAULT_PRIMARY = 401;
/** CombatCaps[503]['attack']: damage of one missile before weapons research. */
export const MISSILE_ATTACK = 12000;
/** Costs of one interplanetary missile (metal, crystal, deuterium). */
export const MISSILE_COST = { m: 12500, k: 2500, d: 10000 } as const;

/**
 * What a missile can hit, in the game's order (element id ascending): the defense and the target's own
 * interplanetary missiles, with their costs (metal, crystal, deuterium as in the game's vars). Metal plus crystal
 * gives the structure points.
 */
export const MISSILE_TARGETS: Record<number, readonly [number, number, number]> = {
  401: [2000, 0, 0],
  402: [1500, 500, 0],
  403: [6000, 2000, 0],
  404: [20000, 15000, 2000],
  405: [2000, 6000, 0],
  406: [50000, 50000, 30000],
  407: [10000, 10000, 0],
  408: [50000, 50000, 0],
  409: [10000000, 5000000, 2500000],
  410: [15000000, 15000000, 0],
  411: [5000000000, 2000000000, 500000000],
  503: [12500, 2500, 10000],
};
export const MISSILE_TARGET_IDS: number[] = Object.keys(MISSILE_TARGETS).map(Number).sort((a, b) => a - b);
/** Valid primary targets of the launch page: the defense (class 400), not the missiles. */
export const PRIMARY_TARGET_IDS: number[] = MISSILE_TARGET_IDS.filter((id) => id < 500);

type MissileUniverse = Pick<Universe, 'systems' | 'circularSystems' | 'sphereSystems' | 'fleetSpeed'>;

/** Missile range in systems: (impulse drive × 5 − 1) × missile_range_factor. */
export function missileRange(impulse: number, factor = 1): number {
  return Math.max(Math.floor((impulse * 5 - 1) * factor), 0);
}

/** FleetFunctions::inMissileRange: same galaxy and within the range (circular systems wrap around). */
export function inMissileRange(u: MissileUniverse, from: Coords, to: Coords, impulse: number, factor = 1): boolean {
  if (from[0] !== to[0]) return false;
  const range = missileRange(impulse, factor);
  if (u.sphereSystems) return range > 1;
  if (u.circularSystems) {
    const max = u.systems;
    const here = from[1];
    const systemMax = here + range > max ? here + range - max : here + range;
    const systemMin = here - range < 1 ? max + (here - range) : here - range;
    if (range * 2 >= max) return true;
    if (systemMin <= systemMax) return to[1] >= systemMin && to[1] <= systemMax;
    return (to[1] >= systemMin && to[1] <= max) || (to[1] >= 1 && to[1] <= systemMax);
  }
  return to[1] >= from[1] - range && to[1] <= from[1] + range;
}

/** System distance as getMIPDuration counts it. */
export function missileSystemDistance(u: MissileUniverse, fromSystem: number, toSystem: number): number {
  if (u.sphereSystems) return 2;
  const abs = Math.abs(fromSystem - toSystem);
  if (!u.circularSystems) return abs;
  const half = Math.ceil(u.systems / 2);
  return abs < half ? abs : Math.floor(u.systems / 2) - (abs - half);
}

/** FleetFunctions::getMIPDuration: flight time in whole seconds. */
export function missileDuration(u: MissileUniverse, fromSystem: number, toSystem: number): number {
  const distance = missileSystemDistance(u, fromSystem, toSystem);
  return Math.max(Math.round((30 + 60 * distance) / (u.fleetSpeed / 2500)), MIN_FLEET_TIME);
}

/** Silo space (silo level × 10 × silo_factor); an interplanetary missile takes two, an interceptor one. */
export function siloSlots(silo: number, factor = 1): number {
  return silo * 10 * Math.max(factor, 1);
}

export interface MissileAttackInput {
  missiles: number;
  /** attacker's weapons technology (109) */
  weapons: number;
  /** target's armour technology (111) */
  armor: number;
  /** interceptors (502) that defend; on a moon those of its planet */
  interceptors: number;
  /** target's defense and interplanetary missiles by id */
  defense: Record<number, number>;
  /** primary target; 0, unknown ids and interceptors fall back to the missile launcher */
  primary?: number;
}

export interface MissileAttackResult {
  /** missiles shot down by interceptors */
  intercepted: number;
  /** missiles that hit */
  effective: number;
  interceptorsLeft: number;
  destroyed: Record<number, number>;
  remaining: Record<number, number>;
  /** damage left after the last target (float, as the game keeps it) */
  damageLeft: number;
}

/** Structure points of one unit: (metal + crystal) × (1 + 0.1 × armour) / 10. */
export function structurePoints(id: number, armor: number): number {
  const cost = MISSILE_TARGETS[id];
  return ((cost[0] + cost[1]) * (1 + 0.1 * armor)) / 10;
}

/** Damage of `count` missiles with the given weapons research. */
export function missileDamage(count: number, weapons: number): number {
  return count * MISSILE_ATTACK * (1 + 0.1 * weapons);
}

/** The primary target the game uses for a given choice. */
export function primaryTarget(primary: number | undefined): number {
  return primary && PRIMARY_TARGET_IDS.includes(primary) ? primary : DEFAULT_PRIMARY;
}

/** Targets with units, in the order the missiles hit them: the primary target first, then by id. */
function targetOrder(defense: Record<number, number>, primary: number): number[] {
  const ids = MISSILE_TARGET_IDS.filter((id) => (defense[id] ?? 0) > 0);
  return ids.includes(primary) ? [primary, ...ids.filter((id) => id !== primary)] : ids;
}

/** MissionCaseMIP::TargetEvent and calculateMIPAttack: interceptors first, then the damage target by target. */
export function missileAttack(input: MissileAttackInput): MissileAttackResult {
  const missiles = Math.max(0, Math.floor(input.missiles));
  const interceptors = Math.max(0, Math.floor(input.interceptors));
  const remaining: Record<number, number> = {};
  for (const id of MISSILE_TARGET_IDS) if ((input.defense[id] ?? 0) > 0) remaining[id] = input.defense[id];
  const destroyed: Record<number, number> = {};
  if (interceptors >= missiles) {
    return { intercepted: missiles, effective: 0, interceptorsLeft: interceptors - missiles, destroyed, remaining, damageLeft: 0 };
  }
  const effective = missiles - interceptors;
  let damage = missileDamage(effective, input.weapons);
  for (const id of targetOrder(input.defense, primaryTarget(input.primary))) {
    const points = structurePoints(id, input.armor);
    const count = Math.min(Math.floor(damage / points), remaining[id]);
    damage -= count * points;
    if (count > 0) {
      destroyed[id] = count;
      remaining[id] -= count;
      if (!remaining[id]) delete remaining[id];
    }
    if (damage <= 0) break;
  }
  return { intercepted: interceptors, effective, interceptorsLeft: 0, destroyed, remaining, damageLeft: Math.max(damage, 0) };
}

/**
 * Fewest missiles that destroy everything (`all`) or the whole primary target (`primary`), interceptors included;
 * null without anything to destroy.
 */
export function missilesNeeded(input: Omit<MissileAttackInput, 'missiles'>, goal: 'all' | 'primary'): number | null {
  const primary = primaryTarget(input.primary);
  const ids = goal === 'all' ? targetOrder(input.defense, primary) : (input.defense[primary] ?? 0) > 0 ? [primary] : [];
  if (!ids.length) return null;
  const points = ids.reduce((sum, id) => sum + input.defense[id] * structurePoints(id, input.armor), 0);
  const interceptors = Math.max(0, Math.floor(input.interceptors));
  const done = (n: number) => {
    const r = missileAttack({ ...input, missiles: n });
    return ids.every((id) => !r.remaining[id]);
  };
  // closed form, then step to the exact count the game's float arithmetic gives
  let n = interceptors + Math.max(1, Math.ceil(points / missileDamage(1, input.weapons)));
  while (n > interceptors + 1 && done(n - 1)) n--;
  while (!done(n)) n++;
  return n;
}

/** Resources of destroyed units (metal, crystal, deuterium). */
export function destroyedValue(destroyed: Record<number, number>): { m: number; k: number; d: number } {
  const v = { m: 0, k: 0, d: 0 };
  for (const [id, n] of Object.entries(destroyed)) {
    const cost = MISSILE_TARGETS[Number(id)];
    if (!cost) continue;
    v.m += cost[0] * n;
    v.k += cost[1] * n;
    v.d += cost[2] * n;
  }
  return v;
}
