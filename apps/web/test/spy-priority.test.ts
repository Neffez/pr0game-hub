import { describe, expect, it } from 'vitest';
import { spyPriority, type SpyInput } from '../src/spyPriority';

const now = 1_000_000;
const base: SpyInput = {
  lootSum: 100_000, reportTime: now - 3600, levels: true, fleetKnown: true, defenseKnown: true,
  changes: { 1: 0, 2: 0, 5: 0 }, lastBattle: null,
};

describe('spy priority (B-2)', () => {
  it('grows with the age of the report', () => {
    const fresh = spyPriority(base, now);
    const old = spyPriority({ ...base, reportTime: now - 24 * 3600 }, now);
    expect(fresh.reasons).toEqual([]);
    expect(old.reasons).toEqual(['old']);
    expect(old.score).toBeGreaterThan(fresh.score * 5);
    expect(old.need).toBeCloseTo(1 - Math.exp(-2), 5);
  });

  it('ranks a target that built fleet or defense since the report higher', () => {
    const p = spyPriority({ ...base, changes: { 1: 500, 2: 300, 5: 0 } }, now);
    expect(p.reasons).toEqual(['fleet']);
    expect(p.need).toBeCloseTo(1 - Math.exp(-1 / 12) + 0.6, 5);
    // points elsewhere only count when neither fleet nor defense grew
    expect(spyPriority({ ...base, changes: { 1: 500, 2: 0, 5: null } }, now).reasons).toEqual(['points']);
  });

  it('asks for a report when buildings or the risk are unknown, or a battle came after it', () => {
    const p = spyPriority({ ...base, levels: false, defenseKnown: false, lastBattle: now - 60 }, now);
    expect(p.reasons).toEqual(['battle', 'noLevels', 'unknownRisk']);
    expect(spyPriority({ ...base, lastBattle: now - 7200 }, now).reasons).toEqual([]);
  });
});
