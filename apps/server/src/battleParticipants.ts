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

type StoredFleet = [side: number, name: string, ships: unknown];

/**
 * Fleets of an archived combat report synced again: ships and losses from the new parse, names as stored first (see
 * `keepOriginalNames`). A parse with another number of fleets per report is not the same list: more fleets (more
 * complete) replace the stored ones, fewer keep them.
 */
export function mergeCombatFleets(storedJson: string, incoming: StoredFleet[]): StoredFleet[] {
  const stored = JSON.parse(storedJson) as StoredFleet[];
  if (stored.length !== incoming.length) return incoming.length > stored.length ? incoming : stored;
  return incoming.map((f, i) => (stored[i][0] === f[0] && usable(stored[i][1]) ? [f[0], stored[i][1], f[2]] : f));
}
