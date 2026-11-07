import { describe, expect, it } from 'vitest';
import { astroForPosition, positionInfo, positionRow } from '../src/colonize.js';
import { settingsError } from '../src/universe.js';

describe('colonization (C-5)', () => {
  it('needs astrophysics 8 for the outer positions, 6 and 4 for the next ones', () => {
    expect([1, 2, 3, 4, 8, 12, 13, 14, 15].map((p) => astroForPosition(p, 15))).toEqual([8, 6, 4, 1, 1, 1, 4, 6, 8]);
    expect(astroForPosition(20, 20)).toBe(8);
  });

  it('describes a position like createPlanet with the default planet data', () => {
    const info = positionInfo(8, { positions: 15 });
    expect(info.fields).toEqual({ min: 156, max: 252, avg: 204 });
    expect(info.temp).toEqual({ min: 30, max: 70, avg: 50 });
    expect(info.deut).toBeCloseTo(1.24, 5);
    expect(positionInfo(15, { positions: 15, planetSizeFactor: 1.5, positionBonus: { 15: [0, 0, 25] } })).toMatchObject({
      astro: 8, fields: { min: 135, max: 246, avg: 190 }, bonus: { 901: 0, 902: 0, 903: 25 },
    });
    // more positions than rows: the game's row mapping
    expect(positionRow(30, 30)).toBe(15);
    expect(positionRow(3, 30)).toBe(2);
  });

  it('validates the position bonus setting', () => {
    expect(settingsError({ positionBonus: { 1: [10, 0, -5], 15: [0, 0, 20] } })).toBeNull();
    expect(settingsError({ positionBonus: { 1: [10, 0] } })?.code).toBe('setting_invalid');
    expect(settingsError({ positionBonus: [1, 2, 3] })?.code).toBe('setting_invalid');
    expect(settingsError({ planetSizeFactor: 1.2 })).toBeNull();
  });
});
