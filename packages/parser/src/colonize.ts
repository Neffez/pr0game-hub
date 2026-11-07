/**
 * Colonization: what a new planet at a position will be like, after the game's `PlayerUtil::createPlanet` and
 * `allowPlanetPosition` with the default `planet_data` of its install.sql (backlog C-5).
 */
import { POSITION_TEMP } from './production.js';

/** Field range per position (`planet_data.fields_min/max` of the game's install.sql, 15 rows). */
export const POSITION_FIELDS: Record<number, readonly [number, number]> = {
  1: [96, 172], 2: [104, 176], 3: [112, 182], 4: [118, 208], 5: [133, 232], 6: [146, 242], 7: [152, 248], 8: [156, 252],
  9: [150, 246], 10: [142, 232], 11: [136, 210], 12: [125, 186], 13: [114, 172], 14: [100, 168], 15: [90, 164],
};
const ROWS = 15;

/** Row of `planet_data` the game uses for a position: `ceil(position / (max_planets / rows))`. */
export function positionRow(position: number, positions = ROWS): number {
  return Math.min(ROWS, Math.max(1, Math.ceil(position / (positions / ROWS))));
}

/**
 * Astrophysics level needed to colonize a position (`allowPlanetPosition`): the outermost positions on both ends need 8,
 * the next ones 6, the third ones 4, all others 1.
 */
export function astroForPosition(position: number, positions = ROWS): number {
  if (position === 1 || position === positions) return 8;
  if (position === 2 || position === positions - 1) return 6;
  if (position === 3 || position === positions - 2) return 4;
  return 1;
}

export interface PositionInfo {
  position: number;
  astro: number;
  /** fields: range (with the universe's planet size factor) and the middle; the second planet gets the middle */
  fields: { min: number; max: number; avg: number };
  /** max temperature: range and middle (min temperature is 40 °C lower) */
  temp: { min: number; max: number; avg: number };
  /** deuterium production factor at the middle temperature (`1.44 − 0.004 · temp`, the game's synthesizer formula) */
  deut: number;
  /** energy of one solar satellite at the middle temperature (`(temp + 160) / 6`) */
  solar: number;
  /** production bonus per resource in percent (901 metal, 902 crystal, 903 deuterium), by the universe's settings */
  bonus: Record<901 | 902 | 903, number>;
}

/** What a colony at `position` will be like in a universe (`planetSizeFactor`, `positionBonus` of its settings). */
export function positionInfo(
  position: number,
  u: { positions: number; planetSizeFactor?: number; positionBonus?: Record<string, readonly number[]> },
): PositionInfo {
  const row = positionRow(position, u.positions);
  const [fMin, fMax] = POSITION_FIELDS[row];
  const [tMin, tMax] = POSITION_TEMP[row];
  const size = u.planetSizeFactor && u.planetSizeFactor > 0 ? u.planetSizeFactor : 1;
  const avgTemp = tMin + Math.floor((tMax - tMin) / 2);
  const b = u.positionBonus?.[String(position)] ?? [];
  return {
    position,
    astro: astroForPosition(position, u.positions),
    fields: { min: Math.floor(fMin * size), max: Math.floor(fMax * size), avg: Math.floor((fMin + Math.floor((fMax - fMin) / 2)) * size) },
    temp: { min: tMin, max: tMax, avg: avgTemp },
    deut: 1.44 - 0.004 * avgTemp,
    solar: (avgTemp + 160) / 6,
    bonus: { 901: Number(b[0]) || 0, 902: Number(b[1]) || 0, 903: Number(b[2]) || 0 },
  };
}
