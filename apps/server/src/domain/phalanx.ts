/** Phalanx range in systems (ShowPhalanxPage::GetPhalanxRange). */
export function phalanxRange(level: number, factor: number) {
  return level <= 1 ? 0 : Math.floor((level * level - 1) * factor);
}
