import { DEFAULT_RATES, type LootState } from './input.js';
import type { Res } from './types.js';
import { MAX_PARTICIPANTS } from './settle.js';
import type { Battle, Recycling } from './types.js';

/** Seconds two battles may lie apart and still be the same (battle message and report). */
const SAME_BATTLE = 5;

/** What an update from fresh hub data added to a settlement. */
export interface MergeAdded {
  participants: number;
  helpers: number;
  battles: number;
  recycling: number;
  /** 1 when the market rate of the draft was taken over */
  rates: number;
}

/** Market rate as settlement rate: two decimals, like typed in. */
export const marketRates = (ref: Res): Res => ({ m: Math.round(ref.m * 100) / 100, k: Math.round(ref.k * 100) / 100, d: 1 });
const sameRates = (a: Res, b: Res) => a.m === b.m && a.k === b.k;

export const sameBattle = (a: Battle, b: Battle) => (a.time == null || b.time == null ? a.time === b.time : Math.abs(a.time - b.time) <= SAME_BATTLE);
/** Same recycling report: same person and time, or (rows without a time) the same amounts. */
export const sameRecycling = (a: Recycling, b: Recycling) =>
  a.by === b.by && (a.time != null && b.time != null ? a.time === b.time : a.m === b.m && a.k === b.k);

/**
 * Takes what is new in a fresh draft into a settlement that was edited or saved: participants and helpers, battles and
 * recycling rows it does not have yet are added; battles it has get fleets of new participants and their debris field
 * when missing, participants without flight deuterium get the draft's. Everything else stays as it is, so changes made
 * by hand are kept; new rows go to the end. A new market rate of the draft (`refRates`) becomes the reference and, unless
 * the rates were changed by hand (still the defaults or the previous market rate), the rates. Returns a new state and the
 * counts of what was added.
 */
export function mergeDraft(current: LootState, draft: LootState): { state: LootState; added: MergeAdded } {
  const state: LootState = JSON.parse(JSON.stringify(current));
  const added: MergeAdded = { participants: 0, helpers: 0, battles: 0, recycling: 0, rates: 0 };
  const ids = () => new Set([...state.participants, ...state.helpers].map((p) => p.id));

  for (const p of draft.participants) {
    const known = state.participants.find((x) => x.id === p.id);
    if (known) {
      if (!known.flightDeut && p.flightDeut) known.flightDeut = p.flightDeut;
    } else if (!ids().has(p.id) && state.participants.length < MAX_PARTICIPANTS) {
      state.participants.push({ ...p });
      added.participants++;
    }
  }
  for (const h of draft.helpers) {
    if (ids().has(h.id)) continue;
    state.helpers.push({ ...h });
    added.helpers++;
  }

  const participants = new Set(state.participants.map((p) => p.id));
  for (const b of draft.battles) {
    const known = state.battles.find((x) => sameBattle(x, b));
    if (!known) {
      state.battles.push({ ...JSON.parse(JSON.stringify(b)), fleets: b.fleets.filter((f) => participants.has(f.participant)) });
      added.battles++;
      continue;
    }
    for (const f of b.fleets) {
      if (participants.has(f.participant) && !known.fleets.some((x) => x.participant === f.participant)) known.fleets.push(JSON.parse(JSON.stringify(f)));
    }
    if (!known.debris && b.debris) known.debris = { ...b.debris };
  }

  const people = ids();
  for (const r of draft.recycling) {
    if (!people.has(r.by) || state.recycling.some((x) => sameRecycling(x, r))) continue;
    state.recycling.push(JSON.parse(JSON.stringify(r)));
    added.recycling++;
  }
  // rows from before recycling rows had a time: give them the matching draft row's time and field
  for (const r of state.recycling) {
    const d = draft.recycling.find((x) => sameRecycling(r, x) || (x.by === r.by && x.m === r.m && x.k === r.k));
    if (!d) continue;
    if (r.time == null && d.time != null) r.time = d.time;
    if (!r.field && d.field) r.field = { ...d.field };
  }
  const ref = draft.settings.refRates;
  if (ref && !(state.settings.refRates && sameRates(state.settings.refRates, ref))) {
    const s = state.settings;
    const untouched = sameRates(s.rates, DEFAULT_RATES) || (s.refRates != null && sameRates(s.rates, marketRates(s.refRates)));
    s.refRates = { ...ref };
    if (untouched && !sameRates(s.rates, marketRates(ref))) {
      s.rates = marketRates(ref);
      added.rates = 1;
    }
  }
  return { state, added };
}
