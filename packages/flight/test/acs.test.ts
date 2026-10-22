import { describe, expect, it } from 'vitest';
import { ACS_LIMITS, planAttack, type PlannedFleet } from '../src/index.js';

const fleet = (id: string, duration: number, player = id): PlannedFleet => ({ id, player, duration });

/**
 * The game's sending, step by step (ShowFleetStep3Page, setACSTime): the first fleet creates the ACS with its arrival,
 * a later one waits for the ACS time or pushes the whole ACS back. Returns arrival and return per fleet.
 */
function simulate(sends: { id: string; launch: number; duration: number }[]) {
  const fleets = new Map<string, { arrival: number; home: number }>();
  let acsTime: number | null = null;
  for (const s of [...sends].sort((a, b) => a.launch - b.launch)) {
    let start = Math.floor(s.duration) + s.launch;
    if (acsTime == null) acsTime = start;
    const diff = Math.round(Math.max(0, start - acsTime));
    if (diff) {
      acsTime += diff;
      for (const f of fleets.values()) {
        f.arrival += diff;
        f.home += diff;
      }
    } else start = acsTime;
    fleets.set(s.id, { arrival: start, home: Math.floor(start + s.duration) });
  }
  return fleets;
}

describe('attack plans', () => {
  it('plans a solo attack', () => {
    const plan = planAttack(10000, [fleet('a', 1000.4)], 0);
    expect(plan).toMatchObject({ lead: 'a', arrival: 10000, delay: 0, players: ['a'], tooManyFleets: false });
    expect(plan.fleets).toEqual([{ id: 'a', launch: 9000, late: false, earliest: 10000, delays: false, beforeLead: false, outside: false, home: 11000 }]);
  });

  it('makes the fleet with the earliest launch the lead and lands all at the target time', () => {
    const plan = planAttack(10000, [fleet('fast', 1000), fleet('slow', 3000.9)], 0);
    expect(plan.lead).toBe('slow');
    expect(plan.players).toEqual(['slow', 'fast']);
    expect(plan.fleets.map((f) => [f.id, f.launch, f.home])).toEqual([['fast', 9000, 11000], ['slow', 7000, 13000]]);
  });

  it('shows the delay of a late fleet for the whole ACS', () => {
    const plan = planAttack(10000, [fleet('a', 1000), fleet('b', 3000)], 8000);
    expect(plan).toMatchObject({ arrival: 11000, delay: 1000 });
    expect(plan.fleets.map((f) => [f.id, f.late, f.delays, f.earliest, f.home])).toEqual([
      ['a', false, false, 10000, 12000],
      ['b', true, true, 11000, 14000],
    ]);
  });

  it('flags fleets that would have to launch before a chosen lead', () => {
    const plan = planAttack(10000, [fleet('a', 1000), fleet('b', 3000)], 0, { lead: 'a' });
    expect(plan.lead).toBe('a');
    expect(plan.fleets.find((f) => f.id === 'b')?.beforeLead).toBe(true);
    expect(plan.fleets.find((f) => f.id === 'a')?.beforeLead).toBe(false);
  });

  it('keeps fleets beyond the ACS limits out of the ACS', () => {
    expect(ACS_LIMITS).toEqual({ maxFleets: 16, maxParticipants: 5 });
    const many = Array.from({ length: 17 }, (_, i) => fleet(`f${i}`, 1000 + i, 'p'));
    const plan = planAttack(10000, many, 0);
    expect(plan.tooManyFleets).toBe(true);
    expect(plan.fleets.filter((f) => f.outside).map((f) => f.id)).toEqual(['f0']);

    const players = Array.from({ length: 6 }, (_, i) => fleet(`f${i}`, 1000 + i));
    const byPlayers = planAttack(10000, players, 0);
    expect(byPlayers.tooManyPlayers).toBe(true);
    expect(byPlayers.players).toHaveLength(5);
    expect(byPlayers.fleets.filter((f) => f.outside).map((f) => f.id)).toEqual(['f0']);
    // the fleet outside lands on its own: at the target time when it launches as planned
    expect(byPlayers.fleets.find((f) => f.outside)).toMatchObject({ launch: 9000, earliest: 10000, home: 11000, delays: false });
  });

  it('matches the game for random plans, also with late fleets', () => {
    for (let n = 0; n < 2000; n++) {
      const target = 1_700_000_000 + Math.floor(Math.random() * 1e6);
      const fleets = Array.from({ length: 1 + Math.floor(Math.random() * 6) }, (_, i) =>
        fleet(`f${i}`, 5 + Math.random() * 20000, `p${Math.floor(Math.random() * 3)}`),
      );
      const now = target - Math.floor(Math.random() * 25000);
      const plan = planAttack(target, fleets, now);
      // everyone sends at the planned launch, late ones right now
      const sim = simulate(fleets.map((f) => ({ id: f.id, launch: Math.max(now, plan.fleets.find((p) => p.id === f.id)!.launch), duration: f.duration })));
      for (const p of plan.fleets) {
        expect(sim.get(p.id)).toEqual({ arrival: plan.arrival, home: p.home });
      }
    }
  });
});
