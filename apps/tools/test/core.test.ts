import { beforeEach, describe, expect, it } from 'vitest';
import {
  abortHome,
  DEFAULT_UNI,
  getDelayedTimestamps,
  getFleetSlowest,
  getMissionDuration,
  getShipSpeed,
  getTargetDistance,
  getTimestamps,
  getTimestampsFromArrival,
  mkDate,
  parseAmount,
  parseCoords,
  parseTimeInput,
  recallFor,
  setCustomShips,
  SHIP_BY_ID,
} from '../src/core.js';

// The calculator's former in-page self-test.
const techs = { combustion: 0, impulse: 0, hyperspace: 0, fuelEfficiency: 0 };

describe('flight calculator core', () => {
  beforeEach(() => setCustomShips([]));

  it('computes distances from the game config keys', () => {
    const start = { g: 1, s: 1, p: 1 };
    expect(getTargetDistance(start, start, DEFAULT_UNI)).toBe(5);
    expect(getTargetDistance(start, { g: 1, s: 1, p: 8 }, DEFAULT_UNI)).toBe(1035);
    expect(getTargetDistance(start, { g: 1, s: 2, p: 1 }, DEFAULT_UNI)).toBe(2795);
    expect(getTargetDistance(start, { g: 2, s: 1, p: 1 }, DEFAULT_UNI)).toBe(20000);
    expect(getTargetDistance(start, { g: 9, s: 1, p: 1 }, { ...DEFAULT_UNI, uni_type: 1 })).toBe(20000);
    expect(getTargetDistance(start, { g: 6, s: 1, p: 1 }, { ...DEFAULT_UNI, uni_type: 2 })).toBe(20000);
  });

  it('computes ship speeds and the slowest ship, also for custom ships', () => {
    expect(getShipSpeed(SHIP_BY_ID[210], techs)).toBe(100000000);
    expect(getShipSpeed(SHIP_BY_ID[202], techs)).toBe(5000);
    expect(getShipSpeed(SHIP_BY_ID[202], { combustion: 0, impulse: 5, hyperspace: 0 })).toBe(20000);
    expect(getFleetSlowest({ 202: 5, 203: 1, 210: 0 }, techs).id).toBe('202');
    expect(getFleetSlowest({}, techs)).toEqual({ speed: 0, id: null });
    setCustomShips([
      { id: 'c1', name: 'Custom', custom: true, speed1: 3000, speed2: 0, speed3: 0, tech1: 1, tech2: 0, tech3: 0, consumption1: 1, consumption2: 0, consumption3: 0 },
    ]);
    expect(getFleetSlowest({ 202: 1, c1: 1 }, techs)).toEqual({ speed: 3000, id: 'c1' });
  });

  it('floors timestamps, recovers launch and handles recalls', () => {
    const dur = getMissionDuration(10, 100000000, 5, 1);
    const times = getTimestamps(1000, dur, 0);
    expect(times.arrival).toBe(Math.floor(dur) + 1000);
    expect(times.home).toBe(Math.floor(times.arrival + dur));

    const t400 = getTimestamps(1000, 400, 0);
    expect(abortHome(1100, t400, false)).toEqual({ home: 1200, phase: 'out' });
    expect(abortHome(1500, getTimestamps(1000, 400, 3600), true)).toEqual({ home: 1900, phase: 'hold' });
    expect(abortHome(1500, getTimestamps(1000, 400, 3600), false)).toEqual({ home: null, reason: 'stay_locked' });
    expect(abortHome(1500, t400, false)).toEqual({ home: null, reason: 'returning' });

    expect(recallFor(1200, t400, false)).toMatchObject({ recall: 1100 });
    expect(recallFor(1201, t400, false)).toMatchObject({ home: 1202 });
    expect(recallFor(1900, getTimestamps(1000, 400, 3600), true)).toMatchObject({ recall: 1500 });
    expect(recallFor(1900, t400, false)).toEqual({ recall: null, reason: 'no_abort_needed' });

    const retime = getTimestampsFromArrival(times.arrival, dur, 0);
    expect(retime.start).toBe(times.start);
    expect(retime.home).toBe(times.home);
    expect(getDelayedTimestamps(50000, 50000, 400.7, 3600)).toEqual(getTimestampsFromArrival(50000, 400.7, 3600));
    const delayed = getDelayedTimestamps(2000, 1400, 400, 0);
    expect(delayed.start).toBe(1000);
    expect(delayed.home).toBe(2400);
    expect(abortHome(1800, delayed, false)).toEqual({ home: 2600, phase: 'out' });
  });

  it('parses times, amounts and coordinates', () => {
    const now = mkDate(2026, 10, 20, 23, 50, 0)!;
    expect(parseTimeInput('00:10', now)).toBe(mkDate(2026, 10, 21, 0, 10, 0));
    expect(parseTimeInput('23:40:05', now)).toBe(mkDate(2026, 10, 20, 23, 40, 5));
    expect(parseTimeInput('Ankunft: 21.10.2026 07:00:01', now)).toBe(mkDate(2026, 10, 21, 7, 0, 1));
    expect(parseTimeInput('2.1. 07:00', now)).toBe(mkDate(2027, 1, 2, 7, 0, 0));
    expect(parseTimeInput('+1:30:00', now)).toBe(now + 5400);
    expect(parseTimeInput('-45:00', now)).toBe(now - 2700);
    expect(parseTimeInput('2h 15m', now)).toBe(now + 8100);
    expect(parseAmount('2,5k')).toBe(2500);
    expect(parseAmount('1.234')).toBe(1234);
    expect(parseCoords('[3:120:7]')?.s).toBe(120);
  });
});
