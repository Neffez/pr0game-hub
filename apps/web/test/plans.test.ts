import { distance, flightDuration, shipSpeed } from '@pr0hub/flight';
import { describe, expect, it } from 'vitest';
import type { UniverseSettings } from '../src/format';
import { computePlan, draftBody, draftOf, fromLocalInput, isCurrent, newDraft, parseTarget, toLocalInput, type AttackPlan, type PlanFleet } from '../src/plans';

const u: UniverseSettings = {
  galaxies: 9, systems: 400, positions: 15, circularGalaxies: true, circularSystems: true,
  galaxyDistanceFactor: 20000, systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000,
  fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '',
};
const research = { 115: 10, 117: 8, 118: 6, 134: 0 };
const fleet = (id: number, userId: number, start: [number, number, number] | null, ships: Record<string, number>, speed = 100): PlanFleet => ({
  id, user_id: userId, member: `m${userId}`, g: start?.[0] ?? null, s: start?.[1] ?? null, p: start?.[2] ?? null, planet_type: start ? 'planet' : null,
  ships, speed, status: start ? 'ready' : 'invited', updated_at: 0, drives: { time: 0, research },
});
const plan = (fleets: PlanFleet[]): AttackPlan => ({
  id: 1, user_id: 1, creator: 'm1', g: 1, s: 41, p: 1, planet_type: 'moon', target_time: 2_000_000_000, time_precision: 'exact', note: null, status: 'planning',
  created_at: 0, updated_at: 0, claim_user_id: 1, player_id: null, player_name: null, planet_name: null, fleets,
});

describe('attack plans in the web app', () => {
  it('computes flight times and launches, the slowest fleet leads', () => {
    const view = computePlan(u, plan([fleet(1, 1, [1, 40, 5], { 204: 10 }), fleet(2, 2, [2, 100, 3], { 207: 5 }, 50), fleet(3, 3, null, {})]), 1_999_000_000);
    const d2 = flightDuration(u, distance(u, [2, 100, 3], [1, 41, 1]), shipSpeed(207, { combustion: 10, impulse: 8, hyperspace: 6 }), 50);
    expect(view.fleets[1].duration).toBe(d2);
    expect(view.fleets[1].plan).toMatchObject({ launch: 2_000_000_000 - Math.floor(d2), late: false });
    expect(view.acs).toMatchObject({ lead: '2', arrival: 2_000_000_000, delay: 0 });
    // only invited: no start, no ships, not in the ACS
    expect(view.fleets[2]).toMatchObject({ duration: null, plan: null });
    expect(view.acs!.fleets).toHaveLength(2);
  });

  it('shows the delay when a fleet can no longer make it', () => {
    const view = computePlan(u, plan([fleet(1, 1, [1, 40, 5], { 204: 10 })]), 2_000_000_000 - 10);
    expect(view.acs!.delay).toBeGreaterThan(0);
    expect(view.fleets[0].plan).toMatchObject({ late: true, delays: true });
  });

  it('has no flights without coordinates', () => {
    const view = computePlan(u, { ...plan([fleet(1, 1, [1, 40, 5], { 204: 10 })]), g: null, s: null, p: null }, 0);
    expect(view).toMatchObject({ acs: null, fleets: [{ duration: null, plan: null }] });
  });

  it('turns a draft into the request: player or coordinates, time per precision', () => {
    const d = newDraft(2_000_000_000);
    expect(draftBody(d)).toBeNull();
    d.player = { id: 5, name: 'Gegner' };
    expect(draftBody(d)).toMatchObject({ g: null, player_id: 5, time_precision: 'exact', target_time: 2_000_003_600 });
    d.precision = 'day';
    d.date = '2033-05-18';
    expect(draftBody(d)!.target_time).toBe(fromLocalInput('2033-05-18T00:00:00'));
    d.target = '[3:115:8]';
    expect(draftBody(d)).toMatchObject({ g: 3, s: 115, p: 8 });
    d.target = 'irgendwo';
    expect(draftBody(d)).toBeNull();
    expect(draftOf(plan([]))).toMatchObject({ target: '1:41:1', type: 'moon', precision: 'exact', player: null });
  });

  it('parses targets and converts the time input', () => {
    expect(parseTarget('[3:115:8]')).toEqual([3, 115, 8]);
    expect(parseTarget('1 41 1')).toEqual([1, 41, 1]);
    expect(parseTarget('x')).toBeNull();
    expect(fromLocalInput(toLocalInput(2_000_000_123))).toBe(2_000_000_123);
    expect(isCurrent(plan([]), 2_000_000_000 + 3599)).toBe(true);
    expect(isCurrent({ ...plan([]), status: 'done' }, 0)).toBe(false);
  });
});
