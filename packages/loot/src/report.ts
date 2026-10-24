import type { CombatReportRecord } from '@pr0hub/core/combat';
import { MAX_PARTICIPANTS } from './settle.js';
import type { LootState } from './input.js';
import type { Battle, Ships } from './types.js';

/** A parsed battle report (`parseCombatReportText` of `@pr0hub/core/combat`), the parts a settlement needs. */
export type ReportInput = Pick<CombatReportRecord, 'time' | 'loot' | 'fleets'>;

export type ReportResult = { battle: Battle; added: string[]; skipped: string[] };

/** Game time "YYYY-MM-DD HH:MM:SS" as epoch seconds, read in the local time zone (the game shows the player's time). */
export function localEpoch(local: string | null): number | null {
  if (!local) return null;
  const t = Date.parse(local.replace(' ', 'T'));
  return Number.isFinite(t) ? t / 1000 : null;
}

/** Fresh id for a participant or helper that is not used in `state`. */
export function newId(state: LootState, prefix: string): string {
  const used = new Set([...state.participants, ...state.helpers].map((p) => p.id));
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const addShips = (a: Ships, b: Ships): Ships => {
  const out: Ships = { ...a };
  for (const [id, n] of Object.entries(b)) out[Number(id)] = (out[Number(id)] ?? 0) + n;
  return out;
};

/**
 * Takes a battle report into the state: attackers are matched to participants by name (case-insensitive; new ones
 * are added with an id `<prefix><n>` up to the ACS limit, an unnamed participant row is filled first), several fleets
 * of one player are summed up. Changes only `state.participants`; the caller puts the returned battle in place.
 */
export function battleFromReport(state: LootState, report: ReportInput, toEpoch = localEpoch, prefix = 'p'): ReportResult {
  const added: string[] = [];
  const skipped: string[] = [];
  const byName = new Map(state.participants.filter((p) => p.name).map((p) => [p.name.toLowerCase(), p.id]));
  const fleets = new Map<string, { start: Ships; end: Ships }>();
  for (const f of report.fleets) {
    if (f.side !== 'attacker') continue;
    let id = byName.get(f.name.toLowerCase());
    if (!id) {
      const blank = state.participants.find((p) => !p.name);
      if (blank) {
        blank.name = f.name;
        id = blank.id;
      } else if (state.participants.length < MAX_PARTICIPANTS) {
        id = newId(state, prefix);
        state.participants.push({ id, name: f.name, flightDeut: 0, recDeut: 0, missiles: 0 });
      } else {
        skipped.push(f.name);
        continue;
      }
      byName.set(f.name.toLowerCase(), id);
      added.push(f.name);
    }
    const cur = fleets.get(id) ?? { start: {}, end: {} };
    fleets.set(id, { start: addShips(cur.start, f.start), end: addShips(cur.end, f.end) });
  }
  return {
    battle: {
      time: toEpoch(report.time),
      loot: { m: report.loot.metal, k: report.loot.crystal, d: report.loot.deuterium },
      fleets: [...fleets].map(([participant, f]) => ({ participant, start: f.start, end: f.end })),
    },
    added,
    skipped,
  };
}
