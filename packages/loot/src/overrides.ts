import { cleanState, type LootState, type TransferInput } from './input.js';
import { sameBattle, sameRecycling } from './merge.js';
import type { Battle, BattleFleet, Debris, Helper, Participant, Recycling, Res, Settings } from './types.js';

/** Corrections of a participant or helper the hub knows; `hidden` removes them from the settlement. */
export type PersonOverride = Partial<Omit<Participant & Helper, 'id'>> & { hidden?: true };

/** Corrections of a battle the hub knows (by its key); `fleets`: a participant's fleet replaced, or removed (null). */
export interface BattleOverride {
  /** time of the battle when the correction was made: finds it again when its key changed (report synced later) */
  at?: number | null;
  hidden?: true;
  time?: number | null;
  loot?: Res;
  debris?: Debris;
  fleets?: Record<string, BattleFleet | null>;
}

/** A recycling row the hub knows, removed or replaced. */
export type RecyclingOverride = { hidden: true } | (Omit<Recycling, 'key'> & { hidden?: undefined });

/**
 * What was corrected by hand on top of the settlement the hub computes from its data (the draft): fields of the
 * people, battles and recycling rows it knows (by id or key), rows added by hand (`extra`), settings and transfers.
 * Everything not named here follows the draft, so data synced later flows in.
 */
export interface Overrides {
  settings?: Partial<Settings>;
  participants?: Record<string, PersonOverride>;
  helpers?: Record<string, PersonOverride>;
  battles?: Record<string, BattleOverride>;
  recycling?: Record<string, RecyclingOverride>;
  extra?: { participants?: Participant[]; helpers?: Helper[]; battles?: Battle[]; recycling?: Recycling[] };
  /** transfers changed by hand (the suggestion when absent) */
  transfers?: TransferInput[];
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** JSON with sorted keys and without undefined values, so that field order does not matter. */
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v !== null && typeof v === 'object'
      ? `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${JSON.stringify(k)}:${canon(x)}`).join(',')}}`
      : JSON.stringify(v ?? null);
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const isEmpty = (o: object) => Object.keys(o).length === 0;
const battleKey = (b: Battle, i: number) => b.key ?? `#${i}`;
const recyclingKey = (r: Recycling, i: number) => r.key ?? `#${i}`;

const PERSON_FIELDS = ['name', 'flightDeut', 'recDeut', 'missiles', 'extra', 'keepPct'] as const;
const SETTING_FIELDS: (keyof Settings)[] = ['mode', 'rates', 'refRates', 'deficitMetalShare', 'cargoShip', 'helperDeut'];

function personDiff<T extends Participant | Helper>(draft: T, edited: T): PersonOverride | null {
  const o: Record<string, unknown> = {};
  for (const f of PERSON_FIELDS) {
    const a = (draft as unknown as Record<string, unknown>)[f];
    const b = (edited as unknown as Record<string, unknown>)[f];
    if (b !== undefined && !same(a ?? null, b ?? null) && !(f !== 'name' && f !== 'extra' && !a && !b)) o[f] = copy(b);
  }
  return isEmpty(o) ? null : (o as PersonOverride);
}

function peopleDiff<T extends Participant | Helper>(draft: T[], edited: T[]) {
  const over: Record<string, PersonOverride> = {};
  const extra: T[] = [];
  for (const p of edited) {
    const d = draft.find((x) => x.id === p.id);
    if (!d) extra.push(copy(p));
    else {
      const o = personDiff(d, p);
      if (o) over[p.id] = o;
    }
  }
  for (const d of draft) if (!edited.some((p) => p.id === d.id)) over[d.id] = { hidden: true };
  return { over, extra };
}

function battleDiff(draft: Battle, edited: Battle): BattleOverride | null {
  const o: BattleOverride = {};
  if ((edited.time ?? null) !== (draft.time ?? null)) o.time = edited.time ?? null;
  if (!same(edited.loot, draft.loot)) o.loot = copy(edited.loot);
  if (edited.debris && !same(edited.debris, draft.debris)) o.debris = copy(edited.debris);
  const fleets: Record<string, BattleFleet | null> = {};
  for (const f of edited.fleets) {
    const d = draft.fleets.find((x) => x.participant === f.participant);
    if (!d || !same(d, f)) fleets[f.participant] = copy(f);
  }
  for (const d of draft.fleets) if (!edited.fleets.some((f) => f.participant === d.participant)) fleets[d.participant] = null;
  if (!isEmpty(fleets)) o.fleets = fleets;
  return isEmpty(o) ? null : { at: draft.time ?? null, ...o };
}

/**
 * Corrections that turn the draft into the edited settlement: compares people by id, battles and recycling rows by
 * their key (rows without a key the draft does not have are kept as added by hand).
 */
export function diffOverrides(draft: LootState, edited: LootState): Overrides {
  const o: Overrides = {};
  const settings: Partial<Settings> = {};
  for (const f of SETTING_FIELDS) {
    if (!same(draft.settings[f] ?? null, edited.settings[f] ?? null)) (settings as Record<string, unknown>)[f] = copy(edited.settings[f]);
  }
  if (!isEmpty(settings)) o.settings = settings;

  const extra: NonNullable<Overrides['extra']> = {};
  const parts = peopleDiff(draft.participants, edited.participants);
  if (!isEmpty(parts.over)) o.participants = parts.over;
  if (parts.extra.length) extra.participants = parts.extra;
  const helpers = peopleDiff(draft.helpers, edited.helpers);
  if (!isEmpty(helpers.over)) o.helpers = helpers.over;
  if (helpers.extra.length) extra.helpers = helpers.extra;

  const battles: Record<string, BattleOverride> = {};
  const draftBattles = new Map(draft.battles.map((b, i) => [battleKey(b, i), b]));
  for (const b of edited.battles) {
    const d = b.key != null ? draftBattles.get(b.key) : undefined;
    if (!d) {
      const { key: _, ...rest } = copy(b);
      (extra.battles ??= []).push(rest);
      continue;
    }
    const diff = battleDiff(d, b);
    if (diff) battles[b.key!] = diff;
  }
  draft.battles.forEach((d, i) => {
    const key = battleKey(d, i);
    if (!edited.battles.some((b) => b.key === key)) battles[key] = { at: d.time ?? null, hidden: true };
  });
  if (!isEmpty(battles)) o.battles = battles;

  const recycling: Record<string, RecyclingOverride> = {};
  const draftRows = new Map(draft.recycling.map((r, i) => [recyclingKey(r, i), r]));
  for (const r of edited.recycling) {
    const d = r.key != null ? draftRows.get(r.key) : undefined;
    const { key: _, ...rest } = copy(r);
    if (!d) (extra.recycling ??= []).push(rest);
    else if (!same({ ...d, key: undefined }, { ...r, key: undefined })) recycling[r.key!] = rest;
  }
  draft.recycling.forEach((d, i) => {
    const key = recyclingKey(d, i);
    if (!edited.recycling.some((r) => r.key === key)) recycling[key] = { hidden: true };
  });
  if (!isEmpty(recycling)) o.recycling = recycling;

  if (!isEmpty(extra)) o.extra = extra;
  if (edited.transfers) o.transfers = copy(edited.transfers);
  return o;
}

function applyPeople<T extends Participant | Helper>(draft: T[], over: Record<string, PersonOverride> | undefined, extra: T[] | undefined): T[] {
  const out: T[] = [];
  for (const p of draft) {
    const o = over?.[p.id];
    if (o?.hidden) continue;
    const { hidden: _, ...fields } = o ?? {};
    out.push({ ...copy(p), ...copy(fields) });
  }
  for (const p of extra ?? []) if (!out.some((x) => x.id === p.id)) out.push(copy(p));
  return out;
}

/**
 * The settlement: the draft with the corrections on top. A battle correction whose key the draft no longer has (its
 * report was synced later) applies to the draft battle at the same time that has no correction of its own.
 */
export function applyOverrides(draft: LootState, o: Overrides | null | undefined): LootState {
  if (!o) return cleanState(copy(draft));
  const participants = applyPeople(draft.participants, o.participants, o.extra?.participants);
  const helpers = applyPeople(draft.helpers, o.helpers, o.extra?.helpers).filter((h) => !participants.some((p) => p.id === h.id));

  const keys = draft.battles.map(battleKey);
  const claimed = new Set<string>();
  const byBattle = new Map<number, BattleOverride>();
  for (const [key, b] of Object.entries(o.battles ?? {})) {
    let i = keys.indexOf(key);
    if (i < 0) {
      i = draft.battles.findIndex((d, j) => !o.battles?.[keys[j]] && !claimed.has(keys[j]) && b.at !== undefined && sameBattle(d, { time: b.at, loot: d.loot, fleets: [] }));
    }
    if (i < 0) continue;
    claimed.add(keys[i]);
    byBattle.set(i, b);
  }
  const battles: Battle[] = [];
  draft.battles.forEach((d, i) => {
    const b = byBattle.get(i);
    if (b?.hidden) return;
    const battle = copy(d);
    if (b) {
      if (b.time !== undefined) battle.time = b.time;
      if (b.loot) battle.loot = copy(b.loot);
      if (b.debris) battle.debris = copy(b.debris);
      for (const [pid, f] of Object.entries(b.fleets ?? {})) {
        const at = battle.fleets.findIndex((x) => x.participant === pid);
        if (f === null) {
          if (at >= 0) battle.fleets.splice(at, 1);
        } else if (at >= 0) battle.fleets[at] = copy(f);
        else battle.fleets.push(copy(f));
      }
    }
    battles.push(battle);
  });
  for (const b of o.extra?.battles ?? []) battles.push(copy(b));

  const recycling: Recycling[] = [];
  draft.recycling.forEach((d, i) => {
    const r = o.recycling?.[recyclingKey(d, i)];
    if (r?.hidden) return;
    recycling.push(r ? { ...copy(r as Recycling), ...(d.key ? { key: d.key } : {}) } : copy(d));
  });
  for (const r of o.extra?.recycling ?? []) recycling.push(copy(r));

  return cleanState({
    participants,
    helpers,
    battles,
    recycling,
    settings: { ...copy(draft.settings), ...copy(o.settings ?? {}) },
    transfers: o.transfers ? copy(o.transfers) : null,
  });
}

/**
 * Gives the battles and recycling rows of a settlement saved before keys existed the keys of the matching draft rows
 * (same battle: time within seconds; same recycling report: same person and time or amounts), so that turning it into
 * corrections keeps it in step with the hub's data.
 */
export function adoptKeys(draft: LootState, state: LootState): LootState {
  const s = copy(state);
  // battle and recycling keys are separate (a report id may look like a recycling key)
  const battles = new Set(s.battles.map((b) => b.key).filter((k): k is string => !!k));
  for (const b of s.battles) {
    if (b.key) continue;
    const d = draft.battles.find((x) => x.key && !battles.has(x.key) && sameBattle(x, b));
    if (d?.key) battles.add((b.key = d.key));
  }
  const rows = new Set(s.recycling.map((r) => r.key).filter((k): k is string => !!k));
  for (const r of s.recycling) {
    if (r.key) continue;
    const d = draft.recycling.find((x) => x.key && !rows.has(x.key) && (sameRecycling(x, r) || (x.by === r.by && x.m === r.m && x.k === r.k)));
    if (d?.key) rows.add((r.key = d.key));
  }
  return s;
}

/** Field paths a correction covers, for marking values entered by hand (`p:<id>:<field>`, `b:<key>:loot`, …). */
export function overriddenPaths(o: Overrides | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!o) return out;
  for (const k of Object.keys(o.settings ?? {})) out.add(`s:${k}`);
  for (const [id, p] of [...Object.entries(o.participants ?? {}), ...Object.entries(o.helpers ?? {})]) {
    for (const k of Object.keys(p)) out.add(`p:${id}:${k}`);
  }
  for (const p of [...(o.extra?.participants ?? []), ...(o.extra?.helpers ?? [])]) out.add(`p:${p.id}`);
  for (const [key, b] of Object.entries(o.battles ?? {})) {
    for (const k of Object.keys(b)) if (k !== 'at' && k !== 'fleets') out.add(`b:${key}:${k}`);
    for (const pid of Object.keys(b.fleets ?? {})) out.add(`b:${key}:fleet:${pid}`);
  }
  for (const key of Object.keys(o.recycling ?? {})) out.add(`r:${key}`);
  if (o.transfers) out.add('transfers');
  return out;
}

/** What differs between two settlements (a finalized one and the live one), counted per kind. */
export interface StateChanges {
  people: number;
  battles: number;
  recycling: number;
  settings: number;
}

export function stateChanges(a: LootState, b: LootState): StateChanges {
  const count = <T>(x: T[], y: T[], id: (v: T, i: number) => string) => {
    const left = new Map(x.map((v, i) => [id(v, i), canon(v)]));
    const right = new Map(y.map((v, i) => [id(v, i), canon(v)]));
    let n = 0;
    for (const [k, v] of left) if (right.get(k) !== v) n++;
    for (const k of right.keys()) if (!left.has(k)) n++;
    return n;
  };
  return {
    people: count([...a.participants, ...a.helpers], [...b.participants, ...b.helpers], (p) => p.id),
    battles: count(a.battles, b.battles, battleKey),
    recycling: count(a.recycling, b.recycling, recyclingKey),
    settings: SETTING_FIELDS.filter((f) => !same(a.settings[f] ?? null, b.settings[f] ?? null)).length,
  };
}
