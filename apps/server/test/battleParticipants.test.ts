import { describe, expect, it } from 'vitest';
import { combatFleetsNamesDegraded, participantNamesDegraded } from '../src/battleParticipants.js';

describe('battle participant names', () => {
  it('detects degraded hall names after deleted accounts', () => {
    expect(participantNamesDegraded(['Alice', 'Bob'], [])).toBe(true);
    expect(participantNamesDegraded(['Alice'], ['-'])).toBe(true);
    expect(participantNamesDegraded(['Alice'], ['Alice', 'Bob'])).toBe(false);
    expect(participantNamesDegraded([], ['Alice'])).toBe(false);
  });

  it('detects degraded archived fleet names', () => {
    const stored = JSON.stringify([
      [0, 'Alice', []],
      [1, 'Bob', []],
    ]);
    expect(combatFleetsNamesDegraded(stored, [{ side: 'attacker', name: '-', from: null, start: {}, end: {} }])).toBe(true);
    expect(
      combatFleetsNamesDegraded(stored, [
        { side: 'attacker', name: 'Alice', from: null, start: {}, end: {} },
        { side: 'defender', name: 'Bob', from: null, start: {}, end: {} },
      ]),
    ).toBe(false);
  });
});
