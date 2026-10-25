import { describe, expect, it } from 'vitest';
import {
  destroyedValue,
  inMissileRange,
  missileAttack,
  missileDuration,
  missileRange,
  missilesNeeded,
  primaryTarget,
  siloSlots,
  structurePoints,
} from '../src/index.js';

const uni = { systems: 400, circularSystems: false, fleetSpeed: 2500 };
const ring = { ...uni, circularSystems: true };

describe('missile range and flight time (FleetFunctions)', () => {
  it('range is (impulse × 5 − 1) × factor, never negative', () => {
    expect(missileRange(0)).toBe(0);
    expect(missileRange(1)).toBe(4);
    expect(missileRange(6)).toBe(29);
    expect(missileRange(6, 0.5)).toBe(14);
  });

  it('needs the same galaxy and stays within the range', () => {
    expect(inMissileRange(uni, [1, 100, 1], [1, 104, 1], 1)).toBe(true);
    expect(inMissileRange(uni, [1, 100, 1], [1, 105, 1], 1)).toBe(false);
    expect(inMissileRange(uni, [1, 100, 1], [1, 96, 1], 1)).toBe(true);
    expect(inMissileRange(uni, [1, 100, 1], [2, 100, 1], 10)).toBe(false);
  });

  it('wraps around the edge with circular systems', () => {
    expect(inMissileRange(ring, [1, 2, 1], [1, 398, 1], 1)).toBe(true);
    expect(inMissileRange(ring, [1, 2, 1], [1, 397, 1], 1)).toBe(false);
    expect(inMissileRange(ring, [1, 399, 1], [1, 3, 1], 1)).toBe(true);
    expect(inMissileRange(ring, [1, 399, 1], [1, 4, 1], 1)).toBe(false);
    expect(inMissileRange(uni, [1, 2, 1], [1, 398, 1], 1)).toBe(false);
    expect(inMissileRange(ring, [1, 1, 1], [1, 200, 1], 40)).toBe(true); // range covers all
  });

  it('flies 30 + 60 s per system, divided by the universe speed, at least 5 s', () => {
    expect(missileDuration(uni, 100, 100)).toBe(30);
    expect(missileDuration(uni, 100, 110)).toBe(630);
    expect(missileDuration({ ...uni, fleetSpeed: 10000 }, 100, 110)).toBe(158); // 157.5 rounds up
    expect(missileDuration({ ...uni, fleetSpeed: 2500 * 100 }, 100, 100)).toBe(5);
    expect(missileDuration(ring, 2, 398)).toBe(30 + 60 * 4);
    expect(missileDuration(uni, 2, 398)).toBe(30 + 60 * 396);
    expect(missileDuration({ ...uni, sphereSystems: true }, 1, 300)).toBe(150);
  });

  it('silo space: 10 per level times the silo factor', () => {
    expect(siloSlots(4)).toBe(40);
    expect(siloSlots(4, 2)).toBe(80);
    expect(siloSlots(4, 0)).toBe(40);
  });
});

describe('missile attack (calculateMIPAttack)', () => {
  it('structure points: (metal + crystal) × (1 + 0.1 × armour) / 10', () => {
    expect(structurePoints(401, 0)).toBe(200);
    expect(structurePoints(404, 10)).toBe(7000);
  });

  it('interceptors catch missiles one by one; enough of them stop the attack', () => {
    const defense = { 401: 100 };
    expect(missileAttack({ missiles: 5, weapons: 0, armor: 0, interceptors: 5, defense })).toMatchObject({
      intercepted: 5, effective: 0, interceptorsLeft: 0, destroyed: {}, remaining: { 401: 100 },
    });
    expect(missileAttack({ missiles: 5, weapons: 0, armor: 0, interceptors: 8, defense }).interceptorsLeft).toBe(3);
    const r = missileAttack({ missiles: 5, weapons: 0, armor: 0, interceptors: 3, defense });
    expect(r).toMatchObject({ intercepted: 3, effective: 2, interceptorsLeft: 0, destroyed: { 401: 100 }, remaining: {} });
  });

  it('hits the primary target first, then by id, carrying the rest of the damage on', () => {
    // 1 missile, weapons 0: 12000 damage; gauss 3500 each, missile launcher 200, light laser 200
    const r = missileAttack({ missiles: 1, weapons: 0, armor: 0, interceptors: 0, defense: { 401: 5, 402: 100, 404: 3 }, primary: 404 });
    expect(r.destroyed).toEqual({ 404: 3, 401: 5, 402: 2 });
    expect(r.remaining).toEqual({ 402: 98 });
    expect(r.damageLeft).toBe(100);
  });

  it('skips a target it cannot destroy one of and goes on with cheaper ones', () => {
    // 12000 damage: one plasma turret (10000), then 2000 left for missile launcher (200) and missile (1500)
    const r = missileAttack({ missiles: 1, weapons: 0, armor: 0, interceptors: 0, defense: { 401: 1, 406: 2, 408: 1, 503: 1 }, primary: 406 });
    expect(r.destroyed).toEqual({ 406: 1, 401: 1, 503: 1 });
    expect(r.remaining).toEqual({ 406: 1, 408: 1 });
    expect(r.damageLeft).toBe(300);
  });

  it('weapons raise the damage, armour the structure', () => {
    expect(missileAttack({ missiles: 1, weapons: 10, armor: 0, interceptors: 0, defense: { 401: 1000 } }).destroyed).toEqual({ 401: 120 });
    expect(missileAttack({ missiles: 1, weapons: 0, armor: 10, interceptors: 0, defense: { 401: 1000 } }).destroyed).toEqual({ 401: 30 });
  });

  it('falls back to the missile launcher for no, unknown or interceptor primary targets', () => {
    expect(primaryTarget(0)).toBe(401);
    expect(primaryTarget(502)).toBe(401);
    expect(primaryTarget(503)).toBe(401);
    expect(primaryTarget(999)).toBe(401);
    expect(primaryTarget(408)).toBe(408);
  });

  it('values destroyed units at their costs', () => {
    expect(destroyedValue({ 401: 2, 404: 1 })).toEqual({ m: 24000, k: 15000, d: 2000 });
  });
});

describe('missiles needed', () => {
  const brute = (input: Parameters<typeof missilesNeeded>[0], goal: 'all' | 'primary') => {
    for (let n = 1; n < 10000; n++) {
      const r = missileAttack({ ...input, missiles: n });
      const p = primaryTarget(input.primary);
      if (goal === 'all' ? !Object.keys(r.remaining).length : !r.remaining[p]) return n;
    }
    return null;
  };

  it('matches the smallest count found by simulation', () => {
    const cases = [
      { weapons: 0, armor: 0, interceptors: 0, defense: { 401: 60 } },
      { weapons: 12, armor: 13, interceptors: 7, defense: { 401: 1234, 402: 800, 403: 120, 404: 40, 405: 30, 406: 5, 407: 1, 408: 1, 503: 3 } },
      { weapons: 3, armor: 17, interceptors: 0, defense: { 402: 333, 406: 7 }, primary: 406 },
      { weapons: 7, armor: 7, interceptors: 2, defense: { 405: 9, 407: 1 }, primary: 407 },
    ];
    for (const c of cases) {
      expect(missilesNeeded(c, 'all')).toBe(brute(c, 'all'));
      if ((c.defense as Record<number, number>)[primaryTarget(c.primary)]) expect(missilesNeeded(c, 'primary')).toBe(brute(c, 'primary'));
    }
  });

  it('is null without anything to destroy', () => {
    expect(missilesNeeded({ weapons: 0, armor: 0, interceptors: 4, defense: {} }, 'all')).toBeNull();
    expect(missilesNeeded({ weapons: 0, armor: 0, interceptors: 0, defense: { 402: 3 }, primary: 401 }, 'primary')).toBeNull();
  });
});
