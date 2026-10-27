import { describe, expect, it } from 'vitest';
import { activityCurve, type ActivityEvent } from '../src/activity';

const at = (h: number, m = 0, daysAgo = 0) => new Date(2026, 9, 27 - daysAgo, h, m).getTime() / 1000;
const now = at(23, 59);
const ev = (time: number, source: ActivityEvent['source'] = 'spy', spread = 0): ActivityEvent => ({ time, spread, source });
/** hour of the bin with the highest value (5-minute bins) */
const peakHour = (curve: number[]) => (curve.indexOf(Math.max(...curve)) * 5) / 60;

describe('activity curve', () => {
  it('peaks at the time of day of the evidence', () => {
    const curve = activityCurve([ev(at(14, 0)), ev(at(14, 10, 1))], now, 7);
    expect(curve).toHaveLength(288);
    expect(Math.max(...curve)).toBe(1);
    expect(peakHour(curve)).toBeCloseTo(14, 0);
    expect(curve[0]).toBeLessThan(0.01);
  });

  it('wraps around midnight', () => {
    const curve = activityCurve([ev(at(23, 50, 1))], now, 7);
    expect(curve[0]).toBeGreaterThan(0.8);
    expect(curve[287]).toBeGreaterThan(0.8);
  });

  it('weights newer and more exact evidence higher', () => {
    // three times at 03:00 a week ago lose against once at 20:00 today
    const old = [1, 2, 3].map((i) => ev(at(3, i, 6)));
    expect(peakHour(activityCurve([...old, ev(at(20, 0))], now, 7))).toBeCloseTo(20, 0);
    // a galaxy mark weighs less than a spy probe
    expect(peakHour(activityCurve([ev(at(8, 0), 'galaxy'), ev(at(16, 0), 'spy')], now, 7))).toBeCloseTo(16, 0);
    // vague evidence (10:00–14:00) spreads over its window, an exact time stays narrow
    const vague = activityCurve([ev(at(12, 0), 'manual', 2 * 3600)], now, 7);
    const exact = activityCurve([ev(at(12, 0))], now, 7);
    expect(vague[(13 * 60) / 5]).toBeGreaterThan(0.6);
    expect(exact[(13 * 60) / 5]).toBeLessThan(0.2);
  });

  it('only takes the chosen days', () => {
    const events = [ev(at(9, 0, 3))];
    expect(activityCurve(events, now, 1)).toEqual([]);
    expect(activityCurve(events, now, 7)).toHaveLength(288);
  });
});
