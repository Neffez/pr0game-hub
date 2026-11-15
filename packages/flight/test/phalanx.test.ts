import { describe, expect, it } from 'vitest';
import { phalanxRange } from '../src/index.js';

describe('phalanxRange (ShowPhalanxPage::GetPhalanxRange)', () => {
  it('is (level² − 1) × factor systems, rounded down, nothing below level 2', () => {
    expect(phalanxRange(0)).toBe(0);
    expect(phalanxRange(1)).toBe(0);
    expect(phalanxRange(2)).toBe(3);
    expect(phalanxRange(5)).toBe(24);
    expect(phalanxRange(5, 0.5)).toBe(12);
    expect(phalanxRange(4, 0.3)).toBe(4);
  });
});
