import { distance, flightDuration, shipSpeed } from '@pr0hub/flight';
import { describe, expect, it } from 'vitest';
import type { UniverseSettings } from '../src/format';
import { computePlan, draftBody, draftOf, enemyCalcLink, fleetCalcLink, fromLocalInput, holdRating, planCounts, isCurrent, newDraft, parseTarget, toLocalInput, type AttackPlan, type PlanEnemy, type PlanFleet } from '../src/plans';

const u: UniverseSettings = {
  galaxies: 9, systems: 400, positions: 15, circularGalaxies: true, circularSystems: true,
  galaxyDistanceFactor: 20000, systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000,
  fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '',
};
const research = { 115: 10, 117: 8, 118: 6, 134: 0 };
const fleet = (id: number, userId: number, start: [number, number, number] | null, ships: Record<string, number>, speed = 100): PlanFleet => ({
  id, user_id: userId, member: `m${userId}`, g: start?.[0] ?? null, s: start?.[1] ?? null, p: start?.[2] ?? null, planet_type: start ? 'planet' : null,
  ships, speed, status: start ? 'ready' : 'invited', updated_at: 0, drives: { time: 0, research }, seen: null,
});
const plan = (fleets: PlanFleet[]): AttackPlan => ({
  id: 1, user_id: 1, creator: 'm1', g: 1, s: 41, p: 1, planet_type: 'moon', target_time: 2_000_000_000, time_precision: 'exact', note: null, status: 'planning',
  mission: 'attack', created_at: 0, updated_at: 0, claim_user_id: 1, player_id: null, player_name: null, planet_name: null, fleets,
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

  it('lets every fleet of a hold land on its own, without ACS or delays', () => {
    const view = computePlan(u, { ...plan([fleet(1, 1, [1, 40, 5], { 204: 10 }), fleet(2, 2, [2, 100, 3], { 207: 5 }, 50)]), mission: 'hold' }, 2_000_000_000 - 60);
    expect(view.acs).toBeNull();
    const d1 = flightDuration(u, distance(u, [1, 40, 5], [1, 41, 1]), shipSpeed(204, { combustion: 10, impulse: 8, hyperspace: 6 }), 100);
    expect(view.fleets[0].plan).toMatchObject({ launch: 2_000_000_000 - Math.floor(d1), delays: false, beforeLead: false, outside: false });
    // the slow fleet can no longer make it: it is late, but pushes nothing back
    expect(view.fleets[1].plan).toMatchObject({ late: true, delays: false });
    expect(holdRating(-1)).toBe('safe');
    expect(holdRating(0)).toBe('late');
  });

  it('counts current plans for the menu: in planning and running', () => {
    const launched = { ...fleet(2, 2, [1, 40, 5], { 204: 1 }), status: 'launched' as const };
    const plans = [
      plan([]),
      { ...plan([]), id: 2, status: 'launched' as const },
      { ...plan([fleet(1, 1, [1, 40, 5], { 204: 1 }), launched]), id: 3 },
      { ...plan([]), id: 4, status: 'done' as const },
      { ...plan([]), id: 5, target_time: 1_000_000_000 },
    ];
    expect(planCounts(plans, 2_000_000_000 - 60)).toEqual({ planning: 1, running: 2 });
    expect(planCounts([], 0)).toEqual({ planning: 0, running: 0 });
  });

  it('links fleets and the enemy fleet into the flight calculator', () => {
    const hash = (link: string) => Object.fromEntries(new URLSearchParams(link.split('#')[1]));
    const own = fleet(1, 1, [1, 40, 5], { 204: 10, 202: 3 }, 70);
    expect(hash(fleetCalcLink(u, plan([own]), own)!)).toMatchObject({
      m: 'timing', arr: '2000000000', sg: '1', ss: '40', sp: '5', tg: '1', ts: '41', tp: '1', ships: '202:3,204:10', spd: '7', c: '10', i: '8', h: '6',
    });
    expect(fleetCalcLink(u, plan([own]), fleet(2, 2, null, {}))).toBeNull();

    const enemy: PlanEnemy = {
      member_id: 1, member: 'm1', from: { g: 1, s: 41, p: 1, type: 'moon' }, to: { g: 3, s: 115, p: 8, type: 'planet' },
      fleets: [{ mission: 1, ships: { 210: 1 } }, { mission: 2, ships: { 207: 1773 } }], follow: 1, arrival: 2_000_000_100, first_seen: 2_000_000_000,
      drives: { 115: 12, 117: 11, 118: 9 }, drives_source: 'spy', drives_time: 0, departure: null, recall: null, recall_lead: true, recall_seen: null, percent: 80, buffer: 1, hold_offset: -1, phalanx: null,
      updated_at: 0, updated_by: null,
    };
    expect(hash(enemyCalcLink(u, enemy, own))).toMatchObject({
      m: 'retime', sg: '1', ss: '41', sp: '1', tg: '3', ts: '115', tp: '8', ships: '207:1773', c: '12', i: '11', h: '9', spd: '8',
      ea: '2000000100', eo: '2000000000', eout: 'impact', ks: '1:40:5', kship: '204', kc: '10', ki: '8', kh: '6', ko: '1',
    });
    // a recall of the lead: the whole ACS comes back with the lead
    const recalled = hash(enemyCalcLink(u, { ...enemy, first_seen: enemy.arrival, recall: { from: 1_999_999_000, to: 1_999_999_500 } }));
    expect(recalled).toMatchObject({ ships: '210:1', eout: 'recall', er: '1999999000' });
    expect(recalled.eo).toBeUndefined();
    expect(recalled.ks).toBeUndefined();
  });
});
