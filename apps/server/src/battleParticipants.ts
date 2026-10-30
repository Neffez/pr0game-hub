import type { CombatFleet } from '@pr0hub/core';

/** Participant names that still identify someone in a battle (not blank or a dash placeholder). */
export function meaningfulParticipantNames(names: string[]): string[] {
  return names.filter((n) => {
    const t = n.trim();
    return t.length > 0 && t !== '-';
  });
}

/**
 * True when `incoming` has fewer usable participant names than `stored`, or a name at the same place turned blank or
 * a dash (deleted game accounts: the battle hall only shows "–" or empty strings). Another non-empty name is a
 * rename, not a loss.
 */
export function participantNamesDegraded(stored: string[], incoming: string[]): boolean {
  const usable = (n: string | undefined) => n != null && meaningfulParticipantNames([n]).length > 0;
  if (meaningfulParticipantNames(incoming).length < meaningfulParticipantNames(stored).length) return true;
  return stored.length === incoming.length && stored.some((n, i) => usable(n) && !usable(incoming[i]));
}

function sideFleetNames(fleets: CombatFleet[], side: 'attacker' | 'defender'): string[] {
  return fleets.filter((f) => f.side === side).map((f) => f.name);
}

function sideNamesFromStoredFleets(json: string, side: 0 | 1): string[] {
  return (JSON.parse(json) as [number, string][]).filter((f) => f[0] === side).map((f) => f[1]);
}

/** True when the parsed report carries worse participant names than the archived fleets JSON. */
export function combatFleetsNamesDegraded(storedFleetsJson: string, incoming: CombatFleet[]): boolean {
  return (
    participantNamesDegraded(sideNamesFromStoredFleets(storedFleetsJson, 0), sideFleetNames(incoming, 'attacker')) ||
    participantNamesDegraded(sideNamesFromStoredFleets(storedFleetsJson, 1), sideFleetNames(incoming, 'defender'))
  );
}
