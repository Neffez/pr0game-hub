import { describe, expect, it } from 'vitest';
import { keepOriginalNames, mergeCombatFleets } from '../src/battleParticipants.js';

describe('battle participant names', () => {
  it('keeps the names stored first in the battle hall', () => {
    // deleted account: the game shows "-" or nothing
    expect(keepOriginalNames(['Alice', 'Bob'], ['-', ''])).toEqual(['Alice', 'Bob']);
    expect(keepOriginalNames(['Alice', 'Bob'], [])).toEqual(['Alice', 'Bob']);
    // renamed: the original stays
    expect(keepOriginalNames(['Alice'], ['Alicia'])).toEqual(['Alice']);
    // only a place without a usable name takes the incoming one
    expect(keepOriginalNames(['-', 'Bob'], ['Carol', 'Bobby'])).toEqual(['Carol', 'Bob']);
  });

  it('keeps the names of archived fleets and takes the new ships', () => {
    const stored = JSON.stringify([
      [0, 'Alice', [[202, 1, 1]]],
      [1, 'Bob', []],
    ]);
    expect(
      mergeCombatFleets(stored, [
        [0, 'Alicia', [[202, 2, 1]]],
        [1, '-', [[401, 5, 0]]],
      ]),
    ).toEqual([
      [0, 'Alice', [[202, 2, 1]]],
      [1, 'Bob', [[401, 5, 0]]],
    ]);
    // another number of fleets: the longer list
    expect(mergeCombatFleets(stored, [[0, 'Alicia', []]])).toEqual(JSON.parse(stored));
    expect(mergeCombatFleets(stored, [[0, 'A', []], [1, 'B', []], [1, 'C', []]])).toHaveLength(3);
  });
});
