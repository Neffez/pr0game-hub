import type { Debris, SettlementInput } from './types.js';

/** What became of the debris field: how much was recycled, what is left and what others took. */
export interface DebrisSummary {
  /** the field after the last battle with a known debris field, null when no battle shows one */
  field: Debris | null;
  /** recycled by the participants and helpers */
  recycled: Debris;
  /** share of the field recycled (0-1), null without a field */
  share: number | null;
  /** left after the latest recycling report showing the field, null when none shows it */
  left: Debris | null;
  /** the field is empty (by the latest recycling report) */
  empty: boolean;
  /** of an emptied field, what was not recycled by the participants and helpers: taken by others */
  taken: Debris | null;
}

const total = (d: Debris) => d.m + d.k;

/**
 * Debris field of a settlement: the field of the last battle (the report shows what lies there now, earlier waves
 * included), what the recycling rows collected, and by the recycling report with the smallest field (the latest one)
 * what is left. When that report emptied the field, the part of the field that nobody of the settlement recycled was
 * taken by others.
 */
export function debrisSummary(input: Pick<SettlementInput, 'battles' | 'recycling'>): DebrisSummary {
  const field = [...input.battles].reverse().find((b) => b.debris)?.debris ?? null;
  const recycled = input.recycling.reduce((a, r) => ({ m: a.m + r.m, k: a.k + r.k }), { m: 0, k: 0 });
  const seen = input.recycling.filter((r) => r.field);
  const latest = seen.length ? seen.reduce((a, r) => (total(r.field!) - total(r) < total(a.field!) - total(a) ? r : a)) : null;
  const left = latest ? { m: Math.max(0, latest.field!.m - latest.m), k: Math.max(0, latest.field!.k - latest.k) } : null;
  const empty = !!left && total(left) === 0;
  const missing = field ? { m: Math.max(0, field.m - recycled.m), k: Math.max(0, field.k - recycled.k) } : null;
  return {
    field,
    recycled,
    share: field && total(field) > 0 ? Math.min(1, total(recycled) / total(field)) : null,
    left,
    empty,
    taken: empty && missing && total(missing) > 0 ? missing : null,
  };
}
