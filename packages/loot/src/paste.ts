import { isCombatReportText, parseCombatReportText } from '@pr0hub/core/combat';
import { estimateMarketRate, isMarketplaceText, parseEmpireText, parseMarketplaceText, parseMessagesText } from '@pr0hub/core/messages';
import type { UnitCatalog } from '@pr0hub/core/units';
import { distance, drivesFromResearch, flightDuration, fleetConsumption, slowestShip, type Drives, type Universe } from '@pr0hub/flight';
import type { LootState } from './input.js';
import { marketRates, sameBattle, sameRecycling } from './match.js';
import { battleFromReport, localEpoch, newId, type ReportSide } from './report.js';
import { SHARE_WITHIN } from './settle.js';
import type { Battle, Helper, Participant, Res, Ships } from './types.js';

/*
 * Settling from pasted game pages, without a hub: what the hub takes from its synced data (see the server's
 * settlement draft) is taken from pasted text here. Battle reports give the participants, their start planets and
 * fleets; the messages page gives fleet returns (loot per fleet, real flight time), missile impacts, recycling
 * reports and recycler returns; an empire page gives the drive levels, the marketplace the rates. Messages never name
 * their owner: a person is found by their planets (start planets of the battle report, planets of a pasted empire
 * page), or is the one the paste was made for.
 */

/** "g:s:p" */
export type CoordKey = string;

/** A fleet of one battle as the report lists it (several fleets of one player stay apart: each has its own start). */
export interface SyncFleet {
  participant: string;
  from: CoordKey | null;
  ships: Ships;
  /** ships left after the battle (this fleet flies home and sends a return message) */
  survived: boolean;
}

export interface SyncBattle {
  target: CoordKey | null;
  fleets: SyncFleet[];
}

/** A fleet return message: what one attack fleet brought home, when it landed. */
export interface SyncReturn {
  /** owner chosen for the paste; null: found by the home planet */
  by: string | null;
  home: CoordKey;
  target: CoordKey;
  time: number | null;
  res: Res;
}

export interface SyncRecycleReturn {
  by: string | null;
  home: CoordKey;
  time: number | null;
  m: number;
  k: number;
}

export interface SyncMissile {
  by: string | null;
  from: CoordKey;
  target: CoordKey;
  time: number | null;
  count: number;
}

/** Facts taken from pasted pages, kept next to the settlement to compute its values (not part of `LootState`). */
export interface PasteSync {
  /** battle key -> fleets and target */
  battles: Record<string, SyncBattle>;
  /** recycling key -> target of the report */
  recycling: Record<string, CoordKey>;
  returns: SyncReturn[];
  recycleReturns: SyncRecycleReturn[];
  missiles: SyncMissile[];
  /** person id -> planets */
  planets: Record<string, CoordKey[]>;
  /** person id -> drive levels */
  drives: Record<string, Drives>;
  /** values typed over by hand (see `autoPath`), the computed value does not replace them */
  manual: string[];
  /** values set by the computation (see `autoPath`), cleared again when they no longer apply */
  auto: string[];
}

export const emptySync = (): PasteSync => ({ battles: {}, recycling: {}, returns: [], recycleReturns: [], missiles: [], planets: {}, drives: {}, manual: [], auto: [] });

/** Path of a computed value: a person's `flightDeut`, `recDeut`, `missiles`, or the loot of a fleet in a battle. */
export const autoPath = {
  person: (id: string, field: 'flightDeut' | 'recDeut' | 'missiles') => `${id}.${field}`,
  loot: (battleKey: string, participant: string) => `${battleKey}.${participant}.loot`,
};

const MAX_ROWS = 200;
const RETURN_WITHIN = 7 * 86400;
const MISSILES_BEFORE = 86400;
const SLACK = 3600;

const key = (c: { g: number; s: number; p: number }): CoordKey => `${c.g}:${c.s}:${c.p}`;
const coords = (k: CoordKey): [number, number, number] => k.split(':').map(Number) as [number, number, number];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isKey = (v: unknown): v is CoordKey => typeof v === 'string' && /^\d+:\d+:\d+$/.test(v);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const by = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 64) : null);

/** Cleans stored sync data (own browser storage, still checked). */
export function cleanSync(raw: unknown): PasteSync {
  const out = emptySync();
  if (!isObj(raw)) return out;
  const list = <T>(v: unknown, map: (x: Record<string, unknown>) => T | null): T[] =>
    Array.isArray(v) ? v.slice(0, MAX_ROWS).map((x) => (isObj(x) ? map(x) : null)).filter((x): x is T => x != null) : [];
  const ships = (v: unknown): Ships =>
    isObj(v) ? Object.fromEntries(Object.entries(v).filter(([id, x]) => /^\d{3}$/.test(id) && n(x) > 0).map(([id, x]) => [Number(id), n(x)])) : {};
  if (isObj(raw.battles)) {
    for (const [k, b] of Object.entries(raw.battles).slice(0, 50)) {
      if (!isObj(b)) continue;
      out.battles[k] = {
        target: isKey(b.target) ? b.target : null,
        fleets: list(b.fleets, (f) =>
          typeof f.participant === 'string' ? { participant: f.participant, from: isKey(f.from) ? f.from : null, ships: ships(f.ships), survived: f.survived !== false } : null,
        ),
      };
    }
  }
  if (isObj(raw.recycling)) for (const [k, v] of Object.entries(raw.recycling).slice(0, MAX_ROWS)) if (isKey(v)) out.recycling[k] = v;
  out.returns = list(raw.returns, (r) =>
    isKey(r.home) && isKey(r.target) && isObj(r.res)
      ? { by: by(r.by), home: r.home, target: r.target, time: time(r.time), res: { m: n(r.res.m), k: n(r.res.k), d: n(r.res.d) } }
      : null,
  );
  out.recycleReturns = list(raw.recycleReturns, (r) => (isKey(r.home) ? { by: by(r.by), home: r.home, time: time(r.time), m: n(r.m), k: n(r.k) } : null));
  out.missiles = list(raw.missiles, (r) =>
    isKey(r.from) && isKey(r.target) ? { by: by(r.by), from: r.from, target: r.target, time: time(r.time), count: n(r.count) } : null,
  );
  if (isObj(raw.planets)) {
    for (const [id, v] of Object.entries(raw.planets).slice(0, 50)) if (Array.isArray(v)) out.planets[id] = v.filter(isKey).slice(0, 50);
  }
  if (isObj(raw.drives)) {
    for (const [id, d] of Object.entries(raw.drives).slice(0, 50)) {
      if (isObj(d)) out.drives[id] = { combustion: n(d.combustion), impulse: n(d.impulse), hyperspace: n(d.hyperspace), fuelEfficiency: n(d.fuelEfficiency) };
    }
  }
  const paths = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : []);
  out.manual = paths(raw.manual);
  out.auto = paths(raw.auto);
  return out;
}

/** Who pasted: found by planet ('auto'), a person's id, or a new helper by name. */
export type PasteOwner = { auto: true } | { id: string } | { helper: string };

export interface PasteOptions {
  owner?: PasteOwner;
  /** side of the settling players in a pasted battle report */
  side?: ReportSide;
  toEpoch?: (local: string | null) => number | null;
  /** prefix of new participant ids */
  prefix?: string;
}

export interface PasteResult {
  /** what was recognised */
  kind: 'report' | 'messages' | 'empire' | 'marketplace' | null;
  /** index of the battle taken from a report (replaced or added) */
  battle?: number;
  replaced?: boolean;
  /** the report is about another target than the battles so far */
  otherTarget?: boolean;
  /** report names not taken (ACS limit) */
  skipped: string[];
  added: { recycling: number; returns: number; recycleReturns: number; missiles: number; rates: boolean; drives: string | null };
  /** messages kept for later, but with nobody to assign them to yet; recycling reports with nobody are not taken */
  unassigned: number;
  /** recycling reports of another target or more than 24 hours after the battle */
  outside: number;
  /** battles of the messages page without their report (local time) */
  missingReports: number[];
}

/** Planets -> person id. */
function planetOwners(sync: PasteSync): Map<CoordKey, string> {
  const out = new Map<CoordKey, string>();
  for (const [id, list] of Object.entries(sync.planets)) for (const c of list) if (!out.has(c)) out.set(c, id);
  return out;
}

const addPlanet = (sync: PasteSync, id: string, c: CoordKey | null) => {
  if (!c) return;
  const list = (sync.planets[id] ??= []);
  if (!list.includes(c)) list.push(c);
};

const people = (state: LootState) => [...state.participants, ...state.helpers];
const blankBattle = (b: Battle) => b.time == null && !b.fleets.length && !b.loot.m && !b.loot.k && !b.loot.d && !b.debris;

/** Targets of the battles taken from reports. */
const targets = (state: LootState, sync: PasteSync) =>
  new Set(state.battles.map((b) => (b.key ? sync.battles[b.key]?.target : null)).filter((x): x is CoordKey => !!x));

function newBattleKey(state: LootState): string {
  const used = new Set(state.battles.map((b) => b.key));
  let i = 1;
  while (used.has(`b${i}`)) i++;
  return `b${i}`;
}

/**
 * Takes a pasted page into the settlement: a battle report (replaces the battle at the same time, else is added), a
 * messages page (recycling reports at the targets within 24 hours of the first battle, fleet returns, missile
 * impacts, recycler returns), an empire page (drive levels and planets) or the marketplace (rates). Changes `state`
 * and `sync`; the computed values follow with `deriveFromSync` / `applyDerived`.
 */
export function applyPaste(state: LootState, sync: PasteSync, text: string, opts: PasteOptions = {}): PasteResult {
  const toEpoch = opts.toEpoch ?? localEpoch;
  const res: PasteResult = {
    kind: null, skipped: [], unassigned: 0, outside: 0, missingReports: [],
    added: { recycling: 0, returns: 0, recycleReturns: 0, missiles: 0, rates: false, drives: null },
  };
  if (!text.trim()) return res;

  // who the paste belongs to (a new helper is created only when something is assigned to them)
  const owner = opts.owner ?? { auto: true };
  let ownerId: string | null = 'id' in owner && people(state).some((p) => p.id === owner.id) ? owner.id : null;
  const ownerOrNew = (): string | null => {
    if (ownerId) return ownerId;
    if (!('helper' in owner) || !owner.helper.trim()) return null;
    const name = owner.helper.trim().slice(0, 64);
    const known = people(state).find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (known) return (ownerId = known.id);
    ownerId = newId(state, 'h');
    state.helpers.push({ id: ownerId, name, keepPct: 20, recDeut: 0 });
    return ownerId;
  };
  const explicit = !('auto' in owner);

  if (isCombatReportText(text)) {
    const report = parseCombatReportText(text, null);
    if (!report) return res;
    res.kind = 'report';
    const side = opts.side ?? 'attacker';
    const before = targets(state, sync);
    const taken = battleFromReport(state, report, toEpoch, opts.prefix ?? 'p', side);
    res.skipped = taken.skipped;
    const battle = taken.battle;
    const target = report.target ? key(report.target.coords) : null;
    if (target && before.size && !before.has(target)) res.otherTarget = true;
    // the same battle: same time and (when both are known) the same target
    const sameTarget = (b: Battle) => {
      const other = b.key ? sync.battles[b.key]?.target : null;
      return !target || !other || other === target;
    };
    let i = state.battles.findIndex((b) => !blankBattle(b) && battle.time != null && sameBattle(b, battle) && sameTarget(b));
    res.replaced = i >= 0;
    if (i < 0) i = state.battles.findIndex(blankBattle);
    const k = (i >= 0 && state.battles[i].key) || newBattleKey(state);
    battle.key = k;
    if (i >= 0) state.battles[i] = battle;
    else {
      state.battles.push(battle);
      i = state.battles.length - 1;
    }
    res.battle = i;
    // the fleets one by one with their start planet
    const ids = new Map(state.participants.map((p) => [p.name.toLowerCase(), p.id]));
    const fleets: SyncFleet[] = [];
    for (const f of report.fleets) {
      if (f.side !== side) continue;
      const pid = ids.get(f.name.toLowerCase());
      if (!pid) continue;
      const ships: Ships = Object.fromEntries(Object.entries(f.start).filter(([id]) => Number(id) >= 200 && Number(id) < 300).map(([id, x]) => [Number(id), x]));
      if (!Object.keys(ships).length) continue;
      const from = side === 'attacker' && f.from ? key(f.from.coords) : null;
      const survived = Object.entries(f.end).some(([id, x]) => Number(id) >= 200 && Number(id) < 300 && x > 0);
      fleets.push({ participant: pid, from, ships, survived });
      addPlanet(sync, pid, from);
    }
    sync.battles[k] = { target, fleets };
    return res;
  }

  const empire = parseEmpireText(text);
  if (empire && empire.planets.length) {
    res.kind = 'empire';
    const theirs = empire.planets.map((p) => key(p.coords));
    const owners = planetOwners(sync);
    const found = theirs.map((c) => owners.get(c)).find((x) => x);
    const id = explicit ? ownerOrNew() : found ?? null;
    if (!id) {
      res.unassigned = 1;
      return res;
    }
    sync.drives[id] = drivesFromResearch(empire.research);
    for (const c of theirs) addPlanet(sync, id, c);
    res.added.drives = id;
    return res;
  }

  if (isMarketplaceText(text)) {
    res.kind = 'marketplace';
    const page = parseMarketplaceText(text);
    const rate = page.rate ?? estimateMarketRate(page.offers);
    if (rate?.m && rate.k) {
      state.settings.refRates = { m: rate.m, k: rate.k, d: 1 };
      state.settings.rates = marketRates(state.settings.refRates);
      res.added.rates = true;
    }
    return res;
  }

  const records = parseMessagesText(text);
  if (!records.length) return res;
  res.kind = 'messages';
  const owners = planetOwners(sync);
  const at = targets(state, sync);
  const times = state.battles.map((b) => b.time).filter((t): t is number => t != null);
  const first = times.length ? Math.min(...times) : null;
  const assigned = (c: CoordKey) => (explicit ? ownerOrNew() : owners.get(c) ?? null);

  // recycler returns first: they tell who collected a recycling report of the same paste
  for (const r of records) {
    if (r.kind !== 'recycleReturn') continue;
    const row: SyncRecycleReturn = { by: explicit ? ownerOrNew() : null, home: key(r.home), time: toEpoch(r.time), m: r.metal, k: r.crystal };
    if (sync.recycleReturns.some((x) => x.home === row.home && x.time === row.time && x.m === row.m && x.k === row.k)) continue;
    sync.recycleReturns.push(row);
    res.added.recycleReturns++;
    if (!row.by && !owners.has(row.home)) res.unassigned++;
  }
  for (const r of records) {
    if (r.kind === 'recycle') {
      const target = key(r.coords);
      const t = toEpoch(r.time);
      if ((at.size && !at.has(target)) || (first != null && t != null && (t < first - 60 || t > first + SHARE_WITHIN))) {
        res.outside++;
        continue;
      }
      // the recycler return with the same cargo after the report: its home planet tells who it was
      const back = sync.recycleReturns.find((x) => x.m === r.metal && x.k === r.crystal && (t == null || x.time == null || (x.time > t && x.time <= t + RETURN_WITHIN)));
      const id = explicit ? ownerOrNew() : back ? back.by ?? owners.get(back.home) ?? null : null;
      if (!id) {
        res.unassigned++;
        continue;
      }
      const row = { by: id, m: r.metal, k: r.crystal, time: t, ...(r.totalMetal || r.totalCrystal ? { field: { m: r.totalMetal, k: r.totalCrystal } } : {}) };
      if (state.recycling.some((x) => sameRecycling(x, row))) continue;
      const rk = `r${t ?? 0}:${r.metal}:${r.crystal}`;
      state.recycling.push({ key: rk, ...row });
      sync.recycling[rk] = target;
      res.added.recycling++;
    } else if (r.kind === 'fleetReturn') {
      const row: SyncReturn = {
        by: explicit ? ownerOrNew() : null, home: key(r.home), target: key(r.target), time: toEpoch(r.time),
        res: { m: r.metal, k: r.crystal, d: r.deuterium },
      };
      if (sync.returns.some((x) => x.home === row.home && x.target === row.target && x.time === row.time)) continue;
      sync.returns.push(row);
      res.added.returns++;
      if (!row.by && !assigned(row.home)) res.unassigned++;
    } else if (r.kind === 'missileImpact') {
      const row: SyncMissile = { by: explicit ? ownerOrNew() : null, from: key(r.from), target: key(r.target), time: toEpoch(r.time), count: r.count };
      if (sync.missiles.some((x) => x.from === row.from && x.target === row.target && x.time === row.time && x.count === row.count)) continue;
      sync.missiles.push(row);
      res.added.missiles++;
      if (!row.by && !assigned(row.from)) res.unassigned++;
    } else if (r.kind === 'battle') {
      const t = toEpoch(r.time);
      if (t == null || (at.size && !at.has(key(r.coords)))) continue;
      if (!state.battles.some((b) => b.time != null && Math.abs(b.time - t) <= 5)) res.missingReports.push(t);
    }
  }
  return res;
}

export interface Derived {
  /** person id -> flight deuterium, `exact` when every fleet's flight time is known from its return */
  flightDeut: Record<string, { deut: number; exact: boolean }>;
  recDeut: Record<string, number>;
  missiles: Record<string, number>;
  /** battle key -> participant -> loot brought home */
  loot: Record<string, Record<string, Res>>;
  /** people whose drive levels are missing for a computation */
  missingDrives: string[];
}

/**
 * The values the pasted pages give (like the hub's settlement draft): flight deuterium of the attack fleets (one way
 * as charged at launch; the flight time from the fleet's return message, else at 100 % speed), the loot each fleet
 * brought home (dropped when they would be more than the battle's loot; returns count only with one battle at the
 * target, like the hub's draft), missiles fired on the target from a day
 * before the first until an hour after the last battle, and the deuterium of the recycler flights (the recyclers
 * needed for the cargo, the flight time from the report to the return).
 */
export function deriveFromSync(state: LootState, sync: PasteSync, u: Universe, units: UnitCatalog, honorBoost = 1): Derived {
  const out: Derived = { flightDeut: {}, recDeut: {}, missiles: {}, loot: {}, missingDrives: [] };
  const owners = planetOwners(sync);
  const known = new Set(people(state).map((p) => p.id));
  const missing = new Set<string>();
  const drivesOf = (id: string) => {
    const d = sync.drives[id];
    if (!d) missing.add(id);
    return d;
  };
  const used = new Set<SyncReturn>();
  const battles = state.battles.filter((b) => b.key && sync.battles[b.key]).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

  const perTarget = new Map<CoordKey, number>();
  for (const b of battles) {
    const tg = sync.battles[b.key!].target;
    if (tg) perTarget.set(tg, (perTarget.get(tg) ?? 0) + 1);
  }
  const single = new Set([...perTarget].filter(([, n]) => n === 1).map(([tg]) => tg));
  for (const b of battles) {
    const sb = sync.battles[b.key!];
    if (!sb.target) continue;
    const perFleet = new Map<string, { res: Res; open: number }>();
    for (const f of sb.fleets) {
      if (!f.from || !known.has(f.participant)) continue;
      // like the hub, only with one battle at the target: a return names no ships, waves cannot be told apart
      const back =
        b.time != null && single.has(sb.target)
          ? sync.returns
              .filter((r) => !used.has(r) && r.home === f.from && r.target === sb.target && r.time != null && r.time > b.time! && r.time <= b.time! + RETURN_WITHIN &&
                (r.by ?? owners.get(r.home)) === f.participant)
              .sort((x, y) => x.time! - y.time!)[0]
          : undefined;
      if (back) used.add(back);
      if (f.survived) {
        const cur = perFleet.get(f.participant) ?? { res: { m: 0, k: 0, d: 0 }, open: 0 };
        if (back) cur.res = { m: cur.res.m + back.res.m, k: cur.res.k + back.res.k, d: cur.res.d + back.res.d };
        else cur.open++;
        perFleet.set(f.participant, cur);
      }
      const drives = drivesOf(f.participant);
      if (!drives) continue;
      const dist = distance(u, coords(f.from), coords(sb.target));
      const slowest = slowestShip(f.ships, drives, units.drives);
      if (!slowest) continue;
      const duration = back ? back.time! - b.time! : flightDuration(u, dist, slowest.speed, 100);
      const deut = fleetConsumption(u, f.ships, duration, dist, drives, honorBoost, units.drives);
      const cur = out.flightDeut[f.participant] ?? { deut: 0, exact: true };
      out.flightDeut[f.participant] = { deut: cur.deut + deut, exact: cur.exact && !!back };
    }
    // loot per fleet: only when every surviving fleet of the participant has its return
    const loot: Record<string, Res> = {};
    for (const [pid, x] of perFleet) if (!x.open) loot[pid] = x.res;
    const sum = Object.values(loot).reduce((a, r) => ({ m: a.m + r.m, k: a.k + r.k, d: a.d + r.d }), { m: 0, k: 0, d: 0 });
    const tooMuch = sum.m > b.loot.m + 10 || sum.k > b.loot.k + 10 || sum.d > b.loot.d + 10;
    if (Object.keys(loot).length && !tooMuch) out.loot[b.key!] = loot;
  }

  const allTargets = new Set(battles.map((b) => sync.battles[b.key!].target).filter((x): x is CoordKey => !!x));
  const times = state.battles.map((b) => b.time).filter((t): t is number => t != null);
  if (times.length) {
    const from = Math.min(...times) - MISSILES_BEFORE;
    const until = Math.max(...times) + SLACK;
    for (const m of sync.missiles) {
      const id = m.by ?? owners.get(m.from);
      if (!id || !known.has(id) || !allTargets.has(m.target) || m.time == null || m.time < from || m.time > until) continue;
      out.missiles[id] = (out.missiles[id] ?? 0) + m.count;
    }
  }

  const usedBack = new Set<SyncRecycleReturn>();
  const capacity = units.capacity[209] ?? 20000;
  for (const r of state.recycling) {
    const target = r.key ? sync.recycling[r.key] : undefined;
    if (!target || r.time == null || !known.has(r.by)) continue;
    const back = sync.recycleReturns
      .filter((x) => !usedBack.has(x) && x.m === r.m && x.k === r.k && x.time != null && x.time > r.time! && x.time <= r.time! + RETURN_WITHIN &&
        (x.by ?? owners.get(x.home) ?? r.by) === r.by)
      .sort((a, b) => a.time! - b.time!)[0];
    if (!back) continue;
    usedBack.add(back);
    const drives = drivesOf(r.by);
    if (!drives) continue;
    const ships = { 209: Math.max(1, Math.ceil((r.m + r.k) / capacity)) };
    const dist = distance(u, coords(back.home), coords(target));
    out.recDeut[r.by] = (out.recDeut[r.by] ?? 0) + fleetConsumption(u, ships, back.time! - r.time, dist, drives, honorBoost, units.drives);
  }
  out.missingDrives = [...missing].filter((id) => known.has(id));
  return out;
}

/** Puts the derived values into the settlement, except those typed over by hand; returns the paths it set. */
export function applyDerived(state: LootState, sync: PasteSync, d: Derived): Set<string> {
  const manual = new Set(sync.manual);
  const auto = new Set(sync.auto);
  const set = new Set<string>();
  // a person's value: set from the computation, back to 0 once the computation no longer gives it
  const person = (p: Participant | Helper, field: 'flightDeut' | 'recDeut' | 'missiles', value: number | undefined) => {
    const path = autoPath.person(p.id, field);
    if (manual.has(path)) return;
    if (value != null) {
      (p as Participant)[field] = value;
      auto.add(path);
      set.add(path);
    } else if (auto.has(path)) {
      (p as Participant)[field] = 0;
      auto.delete(path);
    }
  };
  for (const p of state.participants) {
    person(p, 'flightDeut', d.flightDeut[p.id]?.deut);
    person(p, 'missiles', d.missiles[p.id]);
  }
  for (const p of [...state.participants, ...state.helpers]) person(p, 'recDeut', d.recDeut[p.id]);
  for (const b of state.battles) {
    if (!b.key) continue;
    for (const f of b.fleets) {
      const path = autoPath.loot(b.key, f.participant);
      if (manual.has(path)) continue;
      const loot = d.loot[b.key]?.[f.participant];
      if (loot) {
        f.loot = { ...loot };
        auto.add(path);
        set.add(path);
      } else if (auto.has(path)) {
        delete f.loot;
        auto.delete(path);
      }
    }
  }
  sync.auto = [...auto];
  return set;
}

/** Marks a value as typed by hand (`on`) or gives it back to the computation. */
export function setManual(sync: PasteSync, path: string, on: boolean): void {
  const list = new Set(sync.manual);
  if (on) list.add(path);
  else list.delete(path);
  sync.manual = [...list];
}

/** Drops the facts of people and battles no longer in the settlement. */
export function pruneSync(state: LootState, sync: PasteSync): void {
  const ids = new Set(people(state).map((p) => p.id));
  const keys = new Set(state.battles.map((b) => b.key).filter(Boolean));
  for (const k of Object.keys(sync.battles)) if (!keys.has(k)) delete sync.battles[k];
  for (const b of Object.values(sync.battles)) b.fleets = b.fleets.filter((f) => ids.has(f.participant));
  const rows = new Set(state.recycling.map((r) => r.key).filter(Boolean));
  for (const k of Object.keys(sync.recycling)) if (!rows.has(k)) delete sync.recycling[k];
  for (const id of Object.keys(sync.planets)) if (!ids.has(id)) delete sync.planets[id];
  for (const id of Object.keys(sync.drives)) if (!ids.has(id)) delete sync.drives[id];
  const by = (x: { by: string | null }) => x.by == null || ids.has(x.by);
  sync.returns = sync.returns.filter(by);
  sync.recycleReturns = sync.recycleReturns.filter(by);
  sync.missiles = sync.missiles.filter(by);
  // marks of values of people and battles no longer there (their ids and keys are given out again)
  const live = (path: string) => {
    const [a, b, c] = path.split('.');
    return c == null ? ids.has(a) : keys.has(a) && ids.has(b);
  };
  sync.manual = sync.manual.filter(live);
  sync.auto = sync.auto.filter(live);
}
