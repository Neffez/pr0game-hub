/** Participant names that still identify someone in a battle (not blank or a dash placeholder). */
export function meaningfulParticipantNames(names: string[]): string[] {
  return names.filter((n) => {
    const t = n.trim();
    return t.length > 0 && t !== '-';
  });
}

const usable = (n: string | undefined | null) => n != null && meaningfulParticipantNames([n]).length > 0;

/**
 * Names of a battle as the hub keeps them: the ones stored first stay. The game shows a renamed player's new name in the
 * report and "-" or nothing for a deleted account; the hub keeps the original (search finds it by former and current
 * names). Only a place without a usable name takes the incoming one.
 */
export function keepOriginalNames(stored: string[], incoming: string[]): string[] {
  return stored.map((n, i) => (usable(n) || !usable(incoming[i]) ? n : incoming[i]));
}

/** Start planet of a fleet in an archived combat report: g, s, p, 1 for a moon (missing when the page hid it). */
export type CombatFrom = [g: number, s: number, p: number, moon: 0 | 1];
type StoredFleet = [side: number, name: string, ships: unknown, from?: CombatFrom];

/**
 * Fleets of an archived combat report synced again: ships and losses from the new parse, names as stored first (see
 * `keepOriginalNames`), start planets from the new parse or else as stored (the public page hides them). A parse with
 * another number of fleets per report is not the same list: more fleets (more complete) replace the stored ones, fewer
 * keep them.
 */
export function mergeCombatFleets(storedJson: string, incoming: StoredFleet[]): StoredFleet[] {
  const stored = JSON.parse(storedJson) as StoredFleet[];
  if (stored.length !== incoming.length) return incoming.length > stored.length ? incoming : stored;
  return incoming.map((f, i) => {
    const same = stored[i][0] === f[0];
    const name = same && usable(stored[i][1]) ? stored[i][1] : f[1];
    const from = f[3] ?? (same ? stored[i][3] : undefined);
    return from ? [f[0], name, f[2], from] : [f[0], name, f[2]];
  });
}
