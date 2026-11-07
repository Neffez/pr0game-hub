import { defenseIds, valueIn, type DefenseAdvice, type DefenseSearch } from '@pr0hub/battle';
import { DEFAULT_RATE } from '@pr0hub/core/advisor';
import { capacityOf, resourceAt } from '@pr0hub/core/buildings';
import { CLASS_FLEET, elementPoints } from '@pr0hub/core/tech';
import { unitCost, withUnits } from '@pr0hub/core/units';
import { distance, drivesFromResearch, fleetConsumption, flightDuration, slowestShip } from '@pr0hub/flight';
import { HttpError } from '../auth.js';
import { runDefenseInWorker, simSettingsOf, throttle } from '../battle.js';
import { catalogOf, type GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { buildingsState, planetShips, type BuildingPlanet } from './buildings.js';
import { spyEmpire } from './empire.js';
import { hostileAttacks } from './hostile.js';
import { latestMarketRate } from './market.js';
import { alliance, memberPlayer } from './members.js';
import { Players } from './players.js';
import { latestScores } from './stats.js';

/**
 * Defense advisor (A-4): for one of the viewer's planets the attackers the hub knows — players who spied on or attacked
 * the viewer, fleets on their way, strong fleets nearby — with their newest known fleet, research and the deuterium of
 * the flight, and in the battle worker the defense that makes their attacks cost more than they bring in.
 */

/** How far back spying, battles and fleets count. */
export const THREAT_DAYS = 14;
/** Threats shown (the strongest) and simulated. */
const MAX_THREATS = 8;
/** Players nearby (same galaxy) with a known fleet, the strongest ones. */
const NEARBY = 5;
/** Runs per battle and the engine budget of one advice (pieces × runs, about 10 s). */
const RUNS = 8;
const WORK = 40_000_000;
/** The advice may cost at most this many times the profit of the worst attack. */
const MAX_FACTOR = 20;
/** Ships that don't join an attack: spy probes and solar satellites. */
const NOT_ATTACKING = new Set(['210', '212']);

type Coords = { g: number; s: number; p: number };
type Reason = 'spied' | 'attacked' | 'incoming' | 'nearby';

export interface DefenseThreatInfo {
  key: string;
  player: { id: number | null; name: string; status: string[]; allyTag: string | null };
  reasons: { kind: Reason; count: number; last: number | null }[];
  fleet: { units: Record<string, number>; points: number; source: 'spy' | 'combat' | 'incoming'; time: number; from: Coords | null };
  /** newest fleet points of the statistics, to compare with the fleet known */
  fleetPoints: { points: number; time: number } | null;
  /** research of the newest spy report; unknown: the viewer's own levels stand in */
  research: { values: Record<string, number>; known: boolean; time: number | null };
  flight: { from: Coords; distance: number; duration: number; fuel: number } | null;
}

const fleetPoints = (units: Record<string, number>) => Math.round(Object.entries(units).reduce((s, [id, n]) => s + elementPoints(id, n), 0));
const attacking = (units: Record<string, number>) => Object.fromEntries(Object.entries(units).filter(([id, n]) => n > 0 && !NOT_ATTACKING.has(id)));

/** The viewer's planet or moon by key ("g:s:p:type") from the buildings page state. */
function planetOfKey(db: DB, ctx: GroupContext, key: string) {
  const state = buildingsState(db, ctx, ctx.user.id);
  const bp = state.planets.find((p) => p.key === key);
  if (!bp) throw new HttpError(404, 'planet_not_found', 'Not one of your synced planets');
  return { state, bp };
}

/**
 * The attackers of a planet: candidates by name (spying on the viewer, battles at the viewer's bodies, attacks on the
 * way, players with a known fleet in the same galaxy), each with the strongest fleet known within `THREAT_DAYS`.
 */
export function defenseThreats(db: DB, ctx: GroupContext, bp: BuildingPlanet, own: { coords: Coords[]; research: Record<string, number> }): DefenseThreatInfo[] {
  const units = catalogOf(ctx.universe);
  const u = ctx.universe.settings;
  const since = ctx.now - THREAT_DAYS * 86400;
  return withUnits(units, () => {
    const players = new Players(db, ctx.groupId);
    const friends = alliance(db, ctx);
    const self = memberPlayer(db, ctx, ctx.user.id);
    const selfName = self != null ? ((db.prepare('SELECT name FROM players WHERE id = ? AND group_id = ?').pluck().get(self, ctx.groupId) as string | undefined) ?? null) : null;
    type Cand = { name: string; id: number | null; reasons: Map<Reason, { count: number; last: number | null }>; fleets: DefenseThreatInfo['fleet'][] };
    const cands = new Map<string, Cand>();
    const add = (name: string, id: number | null, reason: Reason, time: number | null, count = 1) => {
      const lower = name.toLowerCase();
      if (friends.names.has(lower) || (selfName && lower === selfName.toLowerCase())) return null;
      let c = cands.get(lower);
      if (!c) cands.set(lower, (c = { name, id: id ?? players.byName(name), reasons: new Map(), fleets: [] }));
      const r = c.reasons.get(reason) ?? { count: 0, last: null };
      c.reasons.set(reason, { count: r.count + count, last: time != null && (r.last == null || time > r.last) ? time : r.last });
      return c;
    };

    // spying on the viewer
    const spied = db
      .prepare(
        `SELECT from_player AS name, COUNT(*) AS n, MAX(time) AS last FROM hostile_spying WHERE group_id = ? AND user_id = ? AND time >= ? GROUP BY from_player COLLATE NOCASE`,
      )
      .all(ctx.groupId, ctx.user.id, since) as { name: string; n: number; last: number | null }[];
    for (const r of spied) add(r.name, null, 'spied', r.last, r.n);

    // battles at the viewer's bodies: the attackers and their fleets
    const ownKeys = new Set(own.coords.map((c) => `${c.g}:${c.s}:${c.p}`));
    const battles = db
      .prepare(`SELECT time, g, s, p, fleets FROM combat_reports WHERE group_id = ? AND time >= ? AND g IS NOT NULL ORDER BY time DESC`)
      .all(ctx.groupId, since) as { time: number; g: number; s: number; p: number; fleets: string }[];
    for (const b of battles) {
      if (!ownKeys.has(`${b.g}:${b.s}:${b.p}`)) continue;
      const fleets = JSON.parse(b.fleets) as [number, string, [number, number, number][]][];
      const byName = new Map<string, Record<string, number>>();
      for (const [side, name, list] of fleets) {
        if (side !== 0 || !name) continue;
        const sum = byName.get(name) ?? {};
        for (const [id, before] of list) sum[id] = (sum[id] ?? 0) + before;
        byName.set(name, sum);
      }
      for (const [name, sum] of byName) {
        const c = add(name, null, 'attacked', b.time);
        const ships = attacking(sum);
        if (c && Object.keys(ships).length) c.fleets.push({ units: ships, points: fleetPoints(ships), source: 'combat', time: b.time, from: null });
      }
    }

    // fleets on their way to the viewer
    for (const a of hostileAttacks(db, ctx)) {
      if (a.memberId !== ctx.user.id || !a.player) continue;
      const c = add(a.player.name, a.player.id, 'incoming', a.arrival);
      const ships: Record<string, number> = {};
      for (const f of a.fleets) for (const [id, n] of Object.entries(f.ships)) ships[id] = (ships[id] ?? 0) + n;
      const list = attacking(ships);
      if (c && Object.keys(list).length) c.fleets.push({ units: list, points: fleetPoints(list), source: 'incoming', time: a.seen, from: { g: a.from.g, s: a.from.s, p: a.from.p } });
    }

    // strong fleets nearby: spy reports in the planet's galaxy with a fleet section
    const near = db
      .prepare(
        `SELECT sr.player_id AS id, COALESCE(pl.name, sr.player_name) AS name, MAX(sr.report_time) AS last FROM spy_reports sr LEFT JOIN players pl ON pl.id = sr.player_id
         WHERE sr.group_id = ? AND sr.g = ? AND sr.report_time >= ? AND json_extract(sr.sections, '$."${CLASS_FLEET}"') IS NOT NULL AND COALESCE(pl.name, sr.player_name) IS NOT NULL
         GROUP BY COALESCE(pl.name, sr.player_name) COLLATE NOCASE`,
      )
      .all(ctx.groupId, bp.coords.g, since) as { id: number | null; name: string; last: number }[];
    const nearby: Cand[] = [];
    for (const r of near) {
      const lower = r.name.toLowerCase();
      if (cands.has(lower) || friends.names.has(lower) || (selfName && lower === selfName.toLowerCase())) continue;
      nearby.push({ name: r.name, id: r.id ?? players.byName(r.name), reasons: new Map([['nearby', { count: 1, last: r.last }]]), fleets: [] });
    }

    // fleets from the spy reports, research, owners' planets
    const withSpy = (c: Cand) => {
      const spy = spyEmpire(db, ctx, c.id ?? -1, c.name);
      for (const pl of spy?.planets ?? []) {
        if (pl.time < since) continue;
        const ships = attacking(Object.fromEntries(Object.entries(pl.values).filter(([id]) => Number(id) >= 200 && Number(id) < 300)));
        if (Object.keys(ships).length) c.fleets.push({ units: ships, points: fleetPoints(ships), source: 'spy', time: pl.time, from: pl.coords });
      }
      return spy;
    };
    const spies = new Map<Cand, ReturnType<typeof spyEmpire>>();
    for (const c of [...cands.values(), ...nearby]) spies.set(c, withSpy(c));
    const strongest = (c: Cand) => c.fleets.reduce<DefenseThreatInfo['fleet'] | null>((best, f) => (!best || f.points > best.points ? f : best), null);
    const chosen = [...cands.values(), ...nearby.filter((c) => c.fleets.length).sort((a, b) => strongest(b)!.points - strongest(a)!.points).slice(0, NEARBY)].filter(
      (c) => c.fleets.length,
    );

    const ids = chosen.map((c) => c.id).filter((id): id is number => id != null);
    const scores = latestScores(db, ctx.groupId, ids, [2]);
    const info = new Map(
      (db
        .prepare('SELECT p.id, p.status, a.tag FROM json_each(?) id JOIN players p ON p.id = id.value AND p.group_id = ? LEFT JOIN alliances a ON a.id = p.alliance_id')
        .all(JSON.stringify(ids), ctx.groupId) as { id: number; status: string; tag: string | null }[]).map((r) => [r.id, r]),
    );
    const planetsOf = db.prepare('SELECT g, s, p FROM planets WHERE group_id = ? AND player_id = ? AND destroyed = 0');
    const target: [number, number, number] = [bp.coords.g, bp.coords.s, bp.coords.p];

    const out = chosen.map((c): DefenseThreatInfo => {
      const fleet = strongest(c)!;
      const spy = spies.get(c);
      const known = !!spy?.researchTime;
      const research = known ? spy!.research : Object.fromEntries(Object.entries(own.research).filter(([id]) => ['109', '110', '111', '115', '117', '118'].includes(id)));
      // from where the fleet was seen, else the owner's planet nearest to the target
      const homes = c.id != null ? (planetsOf.all(ctx.groupId, c.id) as Coords[]) : [];
      const start =
        fleet.from ??
        homes.map((h) => ({ h, d: distance(u, [h.g, h.s, h.p], target) })).sort((a, b) => a.d - b.d)[0]?.h ??
        null;
      let flight: DefenseThreatInfo['flight'] = null;
      if (start) {
        const drives = drivesFromResearch(research);
        const slowest = slowestShip(fleet.units, drives, units.drives);
        if (slowest && slowest.speed > 0) {
          const dist = distance(u, [start.g, start.s, start.p], target);
          const duration = flightDuration(u, dist, slowest.speed, 100);
          flight = { from: start, distance: dist, duration: Math.floor(duration), fuel: Math.ceil(fleetConsumption(u, fleet.units, duration, dist, drives, 1, units.drives)) };
        }
      }
      const row = c.id != null ? info.get(c.id) : undefined;
      const fp = c.id != null ? scores.get(c.id)?.[2] : undefined;
      return {
        key: c.id != null ? `p${c.id}` : `n:${c.name.toLowerCase()}`,
        player: { id: c.id, name: c.name, status: row ? (JSON.parse(row.status || '[]') as string[]) : [], allyTag: row?.tag ?? null },
        reasons: [...c.reasons].map(([kind, r]) => ({ kind, ...r })),
        fleet,
        fleetPoints: fp ? { points: fp.points, time: fp.time } : null,
        research: { values: research, known, time: spy?.researchTime ?? null },
        flight,
      };
    });
    const order: Reason[] = ['incoming', 'attacked', 'spied', 'nearby'];
    const rank = (t: DefenseThreatInfo) => Math.min(...t.reasons.map((r) => order.indexOf(r.kind)));
    return out.sort((a, b) => rank(a) - rank(b) || b.fleet.points - a.fleet.points).slice(0, MAX_THREATS);
  });
}

export interface DefenseOptions {
  key: string;
  /** the planet's ships stay and defend (else only defense and solar satellites) */
  ships: boolean;
  /** attackers recycle the debris field */
  debris: boolean;
  /** resources at the attack: now (projected) or full storages */
  loot: 'now' | 'full';
  /** threats to simulate by key (all shown when null) */
  threats: string[] | null;
}

/** The planet, the threats and the search input of the advice. */
export function defenseInput(db: DB, ctx: GroupContext, o: DefenseOptions) {
  const catalog = catalogOf(ctx.universe);
  const { state, bp } = planetOfKey(db, ctx, o.key);
  const t = ctx.now;
  return withUnits(catalog, () => {
    const p = bp.planet;
    const research = state.research;
    const combat = Object.fromEntries(['109', '110', '111'].map((id) => [id, research[id] ?? 0]));
    const ids = new Set(defenseIds(catalog).map(String));
    // units on the planet, the shipyard queue counted as built
    const units: Record<string, number> = {};
    for (const [id, n] of Object.entries(p.values)) {
      const num = Number(id);
      if (!(n > 0)) continue;
      if (ids.has(id) || num === 212 || (o.ships && num >= 200 && num < 300)) units[id] = n;
    }
    for (const [id, n] of Object.entries(p.shipyard ?? {})) if (ids.has(id) && n > 0) units[id] = (units[id] ?? 0) + n;

    const res = [901, 902, 903].map((r) => {
      const cap = capacityOf(p, r, state.storageFactor);
      const arrivals = bp.arrivals.map((a) => ({ at: a.at, amount: a.resources[r] ?? 0 })).filter((a) => a.amount > 0 && a.at <= t);
      const nowAmount = Math.floor(resourceAt(p.resources[r] ?? 0, p.perHour[r] ?? 0, cap, p.time, Math.max(t, p.time), arrivals));
      return o.loot === 'full' && bp.type === 'planet' ? Math.max(nowAmount, Math.floor(cap)) : nowAmount;
    });
    const resources = { metal: res[0], crystal: res[1], deuterium: res[2] };

    // buildable defense: requirements met; shield domes once
    const candidates = planetShips(state, bp, t)
      .filter((s) => ids.has(String(s.id)) && s.requirements.every((r) => r.own >= r.need))
      .flatMap((s) => {
        const one = catalog.units[String(s.id)]?.one;
        if (one) return s.count + s.queued > 0 ? [] : [{ id: s.id, max: 1 }];
        return [{ id: s.id, max: 1_000_000 }];
      });

    const ownCoords = state.planets.map((x) => x.coords);
    const threats = defenseThreats(db, ctx, bp, { coords: ownCoords, research });
    const rate = latestMarketRate(db, ctx.groupId);
    const valueRate = rate && rate.m > 0 && rate.k > 0 ? { m: rate.m, k: rate.k } : DEFAULT_RATE;
    const chosen = threats.filter((x) => (o.threats ? o.threats.includes(x.key) : true));
    const search: DefenseSearch = {
      planet: { units, research: combat },
      resources,
      threats: chosen.map((x) => ({ key: x.key, units: x.fleet.units, research: x.research.values, fuel: x.flight?.fuel ?? 0 })),
      candidates,
      rate: valueRate,
      debris: o.debris,
      maxFactor: MAX_FACTOR,
      runs: RUNS,
      work: WORK,
    };
    const unitValue = (id: number) => {
      const c = unitCost(id);
      return c ? valueIn({ metal: c[0], crystal: c[1], deuterium: c[2] }, valueRate) : 0;
    };
    return {
      planet: {
        key: bp.key, name: bp.name, coords: bp.coords, type: bp.type, time: p.time, units, research: combat, resources,
        defenseValue: Math.round(Object.entries(units).filter(([id]) => ids.has(id)).reduce((s, [id, n]) => s + n * unitValue(Number(id)), 0)),
      },
      rate: { ...valueRate, source: rate ? 'market' : 'default' },
      candidates: candidates.map((c) => c.id),
      threats,
      search,
    };
  });
}

/** The advice for the chosen threats (null without threats); the search runs in the battle worker. */
export async function defenseAdvice(ctx: GroupContext, search: DefenseSearch): Promise<(DefenseAdvice & { error: null }) | { error: string } | null> {
  if (!search.threats.length) return null;
  try {
    throttle(ctx.user.id);
    const settings = simSettingsOf(ctx.universe.settings, {});
    return { ...(await runDefenseInWorker(search, settings, ctx.universe.units)), error: null };
  } catch (err) {
    return { error: (err as { code?: string }).code ?? 'sim_failed' };
  }
}
