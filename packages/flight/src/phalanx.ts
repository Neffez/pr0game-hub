/**
 * Range of the sensor phalanx in systems: (level² − 1) × `phalanx_range_factor`, rounded down; level 1 sees only its
 * own system (ShowPhalanxPage::GetPhalanxRange).
 */
export function phalanxRange(level: number, factor = 1): number {
  return level <= 1 ? 0 : Math.floor((level * level - 1) * factor);
}
