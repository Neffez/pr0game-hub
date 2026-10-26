import { describe, expect, it } from 'vitest';
import { battleResult, engineInput, moonChance, steal, UNITS, type EngineOutput } from '../src/index.js';

describe('engineInput (createRustJson)', () => {
  it('raises the values by 10 % per research level, rounded like the game', () => {
    const input = engineInput([{ units: { 222: 3 }, research: { 109: 13, 110: 12, 111: 14 } }], [{ units: { 405: 2, 204: 1 }, research: { 109: 13 } }]);
    const [hx] = input.attacker[0].ships;
    expect(hx).toMatchObject({ shipid: 222, attack: 1426, hull: 10080, shield: 220, explode: 0.7, amount: 3 });
    const ion = input.defender[0].ships.find((s) => s.shipid === 405)!;
    expect(ion).toMatchObject({ attack: 345, hull: 800, shield: 500, stun: 1, explode: 0 });
    expect(input.defender[0].ships.find((s) => s.shipid === 204)!.explode).toBe(0.7);
  });

  it('rounds the attackers attack to one decimal, the defenders to integers', () => {
    const input = engineInput([{ units: { 210: 1 }, research: {} }], [{ units: { 227: 1 }, research: { 109: 5 } }]);
    expect(input.attacker[0].ships[0].attack).toBe(0);
    expect(input.defender[0].ships[0].attack).toBe(2); // 1 × 1.5
  });

  it('knows the later ships and their rapidfire both ways', () => {
    expect(UNITS[232]).toMatchObject({ attack: 200000, shield: 50000, hull: 900000, rapidfire: {} });
    expect(UNITS[214].rapidfire[225]).toBe(140);
    expect(UNITS[231].rapidfire[227]).toBe(10);
    expect(UNITS[407].bigshield).toBe(true);
    // ship shields only where the universe has them
    const domes = (bigShields: boolean) => engineInput([], [{ units: { 407: 1 }, research: {} }], { bigShields }).defender[0].ships[0].bigshield;
    expect([domes(false), domes(true)]).toEqual([false, true]);
  });
});

describe('battleResult (parseRustJson)', () => {
  const round = (attacker: Record<string, number>, defender: Record<string, number>) => ({
    attacker: { Roundstats: { 0: Object.fromEntries(Object.entries(attacker).map(([id, lost]) => [id, { lost }])) }, Statistics: {} },
    defender: { Roundstats: { 0: Object.fromEntries(Object.entries(defender).map(([id, lost]) => [id, { lost }])) }, Statistics: {} },
  });
  const output = { outcome: 1, rounds: [round({}, {}), round({ 204: 4 }, { 401: 5, 202: 2 })] } as unknown as EngineOutput;

  it('rebuilds the defense and puts fleet and the destroyed rest of the defense into the debris field', () => {
    const r = battleResult(output, [{ units: { 204: 10 }, research: {} }], [{ units: { 401: 5, 202: 2 }, research: {} }], { fleetDebris: 50, defenseDebris: 10 }, () => 0);
    expect(r.winner).toBe('attacker');
    expect(r.rounds).toBe(1);
    // rand(1, 100) = 1 <= 70: every launcher comes back
    expect(r.defenders[0].repaired[401]).toBe(5);
    expect(r.defenders[0].remaining).toEqual({ 401: 5, 202: 0 });
    expect(r.debris).toEqual({ metal: 4 * 3000 * 0.5 + 2 * 2000 * 0.5, crystal: 4 * 1000 * 0.5 + 2 * 2000 * 0.5 });
  });
});

describe('steal and moon chance', () => {
  it('takes a third of the space in metal, half of the rest in crystal, then deuterium, at most half of each', () => {
    // 10 large cargos: 250,000 space
    expect(steal([{ units: { 203: 10 } }], { metal: 1e6, crystal: 1e6, deuterium: 1e6 })).toEqual({ metal: 83333, crystal: 83333, deuterium: 83333 });
    expect(steal([{ units: { 203: 10 } }], { metal: 100000, crystal: 0, deuterium: 0 })).toEqual({ metal: 50000, crystal: 0, deuterium: 0 });
  });

  it('gives 1 % moon chance per 100,000 debris, capped', () => {
    expect(moonChance({ metal: 150000, crystal: 100000 })).toBe(2);
    expect(moonChance({ metal: 5e6, crystal: 0 })).toBe(20);
  });
});
