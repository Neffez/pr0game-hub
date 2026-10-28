import type { CombatFleet } from '@pr0hub/core';

/** Participant names that still identify someone in a battle (not blank or a dash placeholder). */
export function meaningfulParticipantNames(names: string[]): string[] {
  return names.filter((n) => {
    const t = n.trim();
    return t.length > 0 && t !== '-';
  });
}

/**
 * True when `incoming` has fewer usable participant names than `stored` (e.g. after deleted game accounts
 * the battle hall only shows "–" or empty strings).
 */
export function participantNamesDegraded(stored: string[], incoming: string[]): boolean {
  const s = meaningfulParticipantNames(stored);
  const i = meaningfulParticipantNames(incoming);
  if (s.length === 0) return false;
  if (i.length < s.length) return true;
  return !s.every((n) => i.some((x) => x.toLowerCase() === n.toLowerCase()));
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
