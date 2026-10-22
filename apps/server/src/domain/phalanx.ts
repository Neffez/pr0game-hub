export /** Phalanx range in systems (ShowPhalanxPage::GetPhalanxRange). */
function phalanxRange(level: number, factor: number) {
  return level <= 1 ? 0 : Math.floor((level * level - 1) * factor);
}
