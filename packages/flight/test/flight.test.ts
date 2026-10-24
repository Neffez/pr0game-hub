import { describe, expect, it } from 'vitest';
import {
  fleetCapacity,
  delayedFlightTimes,
  distance,
  drivesFromResearch,
  fleetConsumption,
  flightDuration,
  flightTimes,
  flightTimesFromArrival,
  recallFor,
  recallHome,
  shipSpeed,
  slowestShip,
  type Universe,
} from '../src/index.js';

// Cases ported from the standalone flight calculator's self-test.
const uni: Universe = {
  galaxies: 9,
  systems: 400,
  circularGalaxies: false,
  circularSystems: false,
  galaxyDistanceFactor: 20000,
  systemDistanceFactor: 95,
  systemDistance: 2700,
  planetDistanceFactor: 5,
  planetDistance: 1000,
  fleetSpeed: 2500,
};
const noDrives = { combustion: 0, impulse: 0, hyperspace: 0 };

describe('distance', () => {
  it('follows getTargetDistance', () => {
    expect(distance(uni, [1, 1, 1], [1, 1, 1])).toBe(5);
    expect(distance(uni, [1, 1, 1], [1, 1, 8])).toBe(1035);
    expect(distance(uni, [1, 1, 1], [1, 2, 1])).toBe(2795);
    expect(distance(uni, [1, 1, 1], [2, 1, 1])).toBe(20000);
  });

  it('wraps around in circular universes', () => {
    expect(distance({ ...uni, circularGalaxies: true }, [1, 1, 1], [9, 1, 1])).toBe(20000);
    expect(distance({ ...uni, circularSystems: true }, [1, 1, 1], [1, 400, 1])).toBe(95 + 2700);
    expect(distance(uni, [1, 1, 1], [1, 400, 1])).toBe(399 * 95 + 2700);
  });

  it('keeps every galaxy and system equally far in a sphere', () => {
    const sphere = { ...uni, sphereGalaxies: true, sphereSystems: true };
    expect(distance(sphere, [1, 1, 1], [5, 1, 1])).toBe(20000);
    expect(distance(sphere, [1, 1, 1], [1, 300, 1])).toBe(95 + 2700);
  });

  it('accepts custom ships', () => {
    const catalog = { c1: { speed: [8000, 0, 0], tech: [1, 0, 0], consumption: [5, 0, 0] } as const };
    expect(shipSpeed('c1', noDrives, { ...catalog })).toBe(8000);
  });
});

describe('ship speed', () => {
  it('switches drives by research level', () => {
    expect(shipSpeed(210, noDrives)).toBe(100000000);
    expect(shipSpeed(202, noDrives)).toBe(5000);
    expect(shipSpeed(202, { combustion: 0, impulse: 5, hyperspace: 0 })).toBe(20000);
    expect(shipSpeed(209, { combustion: 10, impulse: 16, hyperspace: 14 })).toBe(4000);
    expect(shipSpeed(209, { combustion: 10, impulse: 17, hyperspace: 14 })).toBe(4000 * (1 + 0.2 * 17));
    expect(shipSpeed(209, { combustion: 10, impulse: 17, hyperspace: 15 })).toBeCloseTo(6000 * (1 + 0.3 * 15));
    expect(shipSpeed(222, { combustion: 10, impulse: 10, hyperspace: 10 })).toBe(7500 * 4);
    expect(shipSpeed(999, noDrives)).toBe(0);
  });

  it('finds the slowest ship of a fleet', () => {
    expect(slowestShip({ 202: 5, 203: 1, 210: 0 }, noDrives)).toEqual({ id: '202', speed: 5000 });
    expect(slowestShip({ 210: 0 }, noDrives)).toBeNull();
  });

  it('reads drive levels from research', () => {
    expect(drivesFromResearch({ 115: 10, 118: 8 })).toEqual({ combustion: 10, impulse: 0, hyperspace: 8, fuelEfficiency: 0 });
  });
});

describe('duration and consumption', () => {
  it('matches getMissionDuration', () => {
    expect(flightDuration(uni, 5, 100000000)).toBe(3500 * Math.sqrt(50 / 100000000) + 10);
    expect(Math.floor(flightDuration(uni, 2795, 5000, 50))).toBe(Math.floor(7000 * Math.sqrt(27950 / 5000) + 10));
    expect(flightDuration({ ...uni, fleetSpeed: 5000 }, 2795, 5000)).toBe(flightDuration(uni, 2795, 5000) / 2);
    expect(flightDuration(uni, 5, 0)).toBe(5);
  });

  it('computes deuterium like getFleetConsumption', () => {
    const d = flightDuration(uni, 2795, 5000);
    expect(fleetConsumption(uni, { 202: 10 }, d, 2795, noDrives)).toBe(Math.round((10 * 10 * 2795) / 35000 * 4) + 1);
  });
});

describe('timestamps', () => {
  it('floors like the server', () => {
    const dur = flightDuration(uni, 5, 100000000);
    const t = flightTimes(1000, dur);
    expect(t.arrival).toBe(Math.floor(dur) + 1000);
    expect(t.home).toBe(Math.floor(t.arrival + dur));
    const retime = flightTimesFromArrival(t.arrival, dur);
    expect(retime.start).toBe(t.start);
    expect(retime.home).toBe(t.home);
  });

  it('recovers launch and return from a known arrival with stay', () => {
    const t = flightTimesFromArrival(50000, 400.7, 3600);
    expect(t.start).toBe(50000 - 400);
    expect(t.home).toBe(Math.floor(53600 + 400.7));
    expect(delayedFlightTimes(50000, 50000, 400.7, 3600)).toEqual(t);
  });

  it('keeps the launch when an ACS is delayed', () => {
    const delayed = delayedFlightTimes(2000, 1400, 400);
    expect(delayed.start).toBe(1000);
    expect(delayed.home).toBe(2400);
    expect(recallHome(1800, delayed)).toEqual({ home: 2600, phase: 'out' });
    expect(recallHome(2000, delayed)).toEqual({ home: null, reason: 'returning' });
  });
});

describe('recall', () => {
  const t400 = flightTimes(1000, 400);
  const hold = flightTimes(1000, 400, 3600);

  it('returns after the time already flown', () => {
    expect(recallHome(1100, t400)).toEqual({ home: 1200, phase: 'out' });
    expect(recallHome(900, t400)).toEqual({ home: null, reason: 'not_started' });
    expect(recallHome(1500, t400)).toEqual({ home: null, reason: 'returning' });
  });

  it('returns after the full outbound time while holding', () => {
    expect(recallHome(1500, hold, true)).toEqual({ home: 1900, phase: 'hold' });
    expect(recallHome(1500, hold)).toEqual({ home: null, reason: 'stay_locked' });
  });

  it('finds the recall time for a wanted return', () => {
    expect(recallFor(1200, t400)).toEqual({ recall: 1100, home: 1200, phase: 'out' });
    expect(recallFor(1201, t400)).toMatchObject({ home: 1202 });
    expect(recallFor(1900, hold, true)).toEqual({ recall: 1500, home: 1900, phase: 'hold' });
    expect(recallFor(1900, t400)).toEqual({ recall: null, reason: 'no_recall_needed' });
  });
});

describe('cargo capacity', () => {
  it('sums the capacity, without spy probes on raids', () => {
    expect(fleetCapacity({ 202: 2, 203: 1, 210: 10 })).toBe(35050);
    expect(fleetCapacity({ 202: 2, 203: 1, 210: 10 }, true)).toBe(35000);
    expect(fleetCapacity({ 227: 1, 999: 5 })).toBe(35000);
  });
});
