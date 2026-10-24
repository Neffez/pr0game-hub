import type { BuildingsRecord, EmpireRecord, OverviewRecord } from '@pr0hub/core';
import { buildingsOf, catchUpBonus, catchUpFromCosts, deriveBuildingSpeed, levelAfter, LOCKED_BY, NANITE_FACTORY, ROBOT_FACTORY, type Arrival, type BuildingInfo, type BuildPlanet } from '@pr0hub/core/buildings';
import { METAL, STORAGE, storageCapacity } from '@pr0hub/core/tech';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { latestEmpire } from './empire.js';
import { sharedFleets, type StoredFleet } from './fleets.js';
import { memberPlayer } from './members.js';
import { CATCH_UP_WEIGHTS, catchUpLeader, latestScores } from './stats.js';

/**
 * The member's planets and moons as the buildings page needs them: the newest empire page, a buildings page of the
 * planet when it is newer (it also shows the exact costs and build times), the build queue of the newest page that has
 * one (overview, buildings page or empire marker) and the resources of fleets landing on the planet.
 */

type Coords = { g: number; s: number; p: number };

export interface BuildingPlanet {
  key: string;
  name: string;
  coords: Coords;
  type: 'planet' | 'moon';
  /** where levels and resources come from, and when it was synced */
  source: 'empire' | 'buildings';
  planet: BuildPlanet;
  /** next level cost and build time as the buildings page showed them */
  shown: Record<string, { next: number; cost: Record<number, number>; time: number | null }> | null;
  arrivals: (Arrival & { missionName: string; from: Coords })[];
}

export interface BuildingsState {
  planets: BuildingPlanet[];
  research: Record<string, number>;
  /** catch-up bonus in percent (not rounded), see `catchUpOf` */
  catchUp: number | null;
  /** where the bonus comes from and as of when */
  catchUpFrom: { source: 'page' | 'overview' | 'stats'; time: number } | null;
  /** universe building speed: derived from a buildings page, else the universe setting; null when unknown */
  buildingSpeed: number | null;
  storageFactor: number;
  empireTime: number | null;
  fleetsTime: number | null;
}

export interface BuildingAlert {
  id: number;
  g: number;
  s: number;
  p: number;
  planet_type: 'planet' | 'moon';
  element_id: number;
  level: number;
  created_at: number;
}

const keyOf = (c: Coords, type: string) => `${c.g}:${c.s}:${c.p}:${type}`;
const same = (a: Coords, b: Coords) => a.g === b.g && a.s === b.s && a.p === b.p;

/** Missions whose fleets unload at their target (transport, deploy) when flying out. */
const UNLOAD = [3, 4];

/** Resources a fleet brings to one of the member's planets: own transports/deployments, return flights, transports of others. */
function landing(f: StoredFleet): boolean {
  if (!f.to || !f.resources || !Object.values(f.resources).some((n) => n > 0)) return false;
  if (f.owner === 'own') return f.phase === 'return' || (f.phase === 'out' && f.mission != null && UNLOAD.includes(f.mission));
  return f.owner === 'foreign' && f.phase === 'out' && f.mission === 3;
}

export function buildingsState(db: DB, ctx: GroupContext, userId: number, t = now()): BuildingsState {
  const empire = latestEmpire(db, ctx, userId);
  const pages = (
    db
      .prepare('SELECT page_time AS time, data FROM building_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC')
      .all(ctx.groupId, userId) as { time: number; data: string }[]
  ).map((r) => ({ time: r.time, rec: JSON.parse(r.data) as BuildingsRecord }));
  const overviewRow = db
    .prepare('SELECT page_time AS time, data FROM overview_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC LIMIT 1')
    .get(ctx.groupId, userId) as { time: number; data: string } | undefined;
  const overview = overviewRow ? { time: overviewRow.time, rec: JSON.parse(overviewRow.data) as OverviewRecord } : null;
  const fleets = sharedFleets(db, ctx.groupId, userId, userId);
  const settings = ctx.universe.settings as typeof ctx.universe.settings & { storageMultiplier?: number };

  const storageFactor = storageFactorOf(empire?.rec ?? null, pages[0]?.rec ?? null) ?? settings.storageMultiplier ?? 1;
  const planets = new Map<string, BuildingPlanet>();
  for (const p of empire?.rec.planets ?? []) {
    const key = keyOf(p.coords, p.type);
    planets.set(key, {
      key, name: p.name, coords: p.coords, type: p.type, source: 'empire', shown: null, arrivals: [],
      planet: {
        type: p.type, values: { ...p.values }, resources: { ...(p.resources ?? {}) }, perHour: { ...(p.perHour ?? {}) }, time: empire!.time,
        fields: p.fields, queue: p.building ? [{ ...p.building, destroy: false, end: null }] : [],
      },
    });
  }
  for (const page of pages) {
    const r = page.rec;
    const key = keyOf(r.coords, r.type);
    let bp = planets.get(key);
    const newer = !bp || page.time >= bp.planet.time;
    if (!bp) {
      bp = {
        key, name: '', coords: r.coords, type: r.type, source: 'buildings', shown: null, arrivals: [],
        planet: { type: r.type, values: {}, resources: {}, perHour: {}, time: page.time, queue: [] },
      };
      planets.set(key, bp);
    }
    // the cost and time the page shows hold for the level it would build next then
    bp.shown = Object.fromEntries(
      r.buildings.map((b) => {
        const queued = [...r.queue].reverse().find((q) => q.id === b.id);
        return [b.id, { next: (queued ? levelAfter(queued) : b.level) + 1, cost: b.cost, time: b.time }];
      }),
    );
    if (!newer) continue;
    bp.source = 'buildings';
    for (const b of r.buildings) bp.planet.values[b.id] = b.level;
    bp.planet.resources = { ...bp.planet.resources, ...r.resources };
    if (Object.keys(r.storage).length) bp.planet.storage = { ...r.storage };
    if (Object.keys(r.perHour).length) bp.planet.perHour = { ...bp.planet.perHour, ...r.perHour };
    if (r.fields) bp.planet.fields = { ...r.fields };
    bp.planet.time = page.time;
    bp.planet.queue = r.queue.map((q) => ({ ...q }));
  }
  // the overview shows the running build of every planet: newer than the page a planet comes from, it wins
  if (overview) {
    for (const bp of planets.values()) {
      if (overview.time < bp.planet.time - 60) continue;
      const q = overview.rec.queues.find((x) => x.kind === 'building' && same(x.coords, bp.coords) && x.type === bp.type);
      const rest = bp.planet.queue.slice(1);
      bp.planet.queue = q ? [{ id: q.id, level: q.level, destroy: q.destroy, end: overview.time + q.seconds }, ...(bp.source === 'buildings' ? rest : [])] : [];
    }
  }
  // facilities in use, from the newest page that tells: research account wide, the shipyard per planet
  const research = researchBusy(empire, overview, pages);
  for (const bp of planets.values()) {
    const empirePlanet = empire?.rec.planets.find((p) => same(p.coords, bp.coords) && p.type === bp.type);
    const shipyard: Busy[] = [];
    if (empirePlanet && empire) shipyard.push({ time: empire.time, busy: Object.keys(empirePlanet.shipyard ?? {}).length ? { until: null } : null });
    if (overview) {
      const q = overview.rec.queues.some((x) => x.kind === 'shipyard' && same(x.coords, bp.coords) && x.type === bp.type);
      shipyard.push({ time: overview.time, busy: q ? { until: null } : null });
    }
    for (const page of pages) {
      if (!same(page.rec.coords, bp.coords) || page.rec.type !== bp.type) continue;
      const lock = page.rec.buildings.filter((b) => LOCKED_BY[b.id] === 'shipyard');
      if (lock.length) shipyard.push({ time: page.time, busy: lock.some((b) => b.busy) ? { until: null } : null });
    }
    bp.planet.busy = { research, shipyard: newest(shipyard) };
  }
  for (const bp of planets.values()) {
    // builds finished since then raise the level
    while (bp.planet.queue[0]?.end != null && bp.planet.queue[0].end <= t) {
      const done = bp.planet.queue.shift()!;
      bp.planet.values[done.id] = levelAfter(done);
    }
    for (const f of fleets?.data ?? []) {
      if (!landing(f) || !same(f.to!.coords, bp.coords) || (f.to!.type ?? 'planet') !== bp.type) continue;
      bp.arrivals.push({ at: f.arrival, resources: f.resources!, mission: f.mission, back: f.phase === 'return', missionName: f.missionName, from: f.from.coords });
    }
    bp.arrivals.sort((a, b) => a.at - b.at);
  }

  const catchUp = catchUpOf(db, ctx, userId, overview, pages);
  return {
    planets: [...planets.values()],
    research: empire?.rec.research ?? {},
    catchUp: catchUp?.value ?? null,
    catchUpFrom: catchUp ? { source: catchUp.source, time: catchUp.time } : null,
    buildingSpeed: derivedSpeed(pages.map((p) => p.rec)) ?? (settings.buildingSpeed || null),
    storageFactor,
    empireTime: empire?.time ?? null,
    fleetsTime: fleets?.time ?? null,
  };
}

/**
 * The catch-up bonus the game applies now (it lowers costs and with them build times). The game takes it from its
 * latest statistics; its pages show it rounded to two decimals. Newest source wins: a buildings page (the exact value
 * behind its costs, else its rounded one), the overview (rounded), or the synced statistics when they are newer than
 * both (`getCatchUpFactor` with the own and the leader's points). Null when the universe has none (the pages show no
 * bonus) or nothing tells.
 */
function catchUpOf(
  db: DB, ctx: GroupContext, userId: number, overview: { time: number; rec: OverviewRecord } | null, pages: { time: number; rec: BuildingsRecord }[],
): { value: number; source: 'page' | 'overview' | 'stats'; time: number } | null {
  const shown: { value: number; source: 'page' | 'overview'; time: number }[] = [];
  if (overview && overview.rec.catchUp != null) shown.push({ value: overview.rec.catchUp, source: 'overview', time: overview.time });
  for (const p of pages) {
    if (p.rec.catchUp == null) continue;
    // the exact value only while it fits the rounded one shown
    const exact = catchUpFromCosts(p.rec);
    shown.push({ value: exact != null && Math.abs(exact - p.rec.catchUp) < 0.006 ? exact : p.rec.catchUp, source: 'page', time: p.time });
  }
  // pages first on equal times (exact)
  const latest = shown.sort((a, b) => b.time - a.time || (a.source === 'page' ? -1 : 1))[0] ?? null;
  if (!latest) return null;
  const playerId = memberPlayer(db, ctx, userId);
  const leader = catchUpLeader(db, ctx.groupId);
  if (playerId == null || !leader || leader.types < 3 || leader.time <= latest.time) return latest;
  const own = latestScores(db, ctx.groupId, [playerId], [2, 3, 4]).get(playerId);
  if (!own || Object.keys(CATCH_UP_WEIGHTS).some((type) => !own[Number(type)] || own[Number(type)].time < leader.time)) return latest;
  const weighted = Object.entries(CATCH_UP_WEIGHTS).reduce((sum, [type, w]) => sum + own[Number(type)].points * w, 0);
  return { value: catchUpBonus(weighted, leader.weighted), source: 'stats', time: leader.time };
}

type Busy = { time: number; busy: { until: number | null } | null };

/** What the newest source says (null: free or unknown). */
const newest = (list: Busy[]) => [...list].sort((a, b) => b.time - a.time)[0]?.busy ?? null;

/**
 * Research in progress (account wide): the empire marker, the overview queue (with its end) or a buildings page
 * showing the lab or TechnoDome "busy"; the newest decides, the overview's end applies while it is after that.
 */
function researchBusy(
  empire: { time: number; rec: EmpireRecord } | null, overview: { time: number; rec: OverviewRecord } | null, pages: { time: number; rec: BuildingsRecord }[],
): { until: number | null } | null {
  const list: Busy[] = [];
  if (empire) list.push({ time: empire.time, busy: empire.rec.researchQueue ? { until: null } : null });
  const q = overview?.rec.queues.find((x) => x.kind === 'research');
  const end = q ? overview!.time + q.seconds : null;
  if (overview) list.push({ time: overview.time, busy: end != null ? { until: end } : null });
  for (const page of pages) {
    const lock = page.rec.buildings.filter((b) => LOCKED_BY[b.id] === 'research');
    if (lock.length) list.push({ time: page.time, busy: lock.some((b) => b.busy) ? { until: null } : null });
  }
  const latest = [...list].sort((a, b) => b.time - a.time)[0];
  if (!latest?.busy) return null;
  return { until: latest.busy.until ?? (end != null && end > latest.time ? end : null) };
}

/** Storage factor from a resource bar (storage shown against the metal storage level), null when unknown. */
function storageFactorOf(empire: EmpireRecord | null, page: BuildingsRecord | null): number | null {
  const active = empire?.active;
  const planet = active && empire!.planets.find((p) => same(p.coords, active.coords) && p.type === active.type);
  if (planet && active.storage[METAL]) {
    const base = storageCapacity(planet.values[STORAGE[METAL]] ?? 0);
    if (base) return active.storage[METAL] / base;
  }
  if (page?.storage[METAL]) {
    const level = page.buildings.find((b) => b.id === STORAGE[METAL])?.level;
    const base = level != null ? storageCapacity(level) : 0;
    if (base) return page.storage[METAL] / base;
  }
  return null;
}

/** Building speed from the longest build time of the newest buildings page (empty queue: robots and nanites as shown). */
function derivedSpeed(pages: BuildingsRecord[]): number | null {
  for (const r of pages) {
    const levels = Object.fromEntries(r.buildings.map((b) => [b.id, b.level]));
    const robot = levels[ROBOT_FACTORY] ?? 0;
    const nanite = levels[NANITE_FACTORY] ?? 0;
    // a robot or nanite factory in the queue speeds up what comes after it
    if (r.queue.some((q) => q.id === ROBOT_FACTORY || q.id === NANITE_FACTORY)) continue;
    const longest = [...r.buildings].filter((b) => b.time != null).sort((a, b) => b.time! - a.time!)[0];
    const speed = longest ? deriveBuildingSpeed(longest.cost, longest.time!, robot, nanite) : null;
    if (speed) return speed;
  }
  return null;
}

/** The buildings of a planet with their next level at `now`. */
export function planetBuildings(state: BuildingsState, bp: BuildingPlanet, now: number): BuildingInfo[] {
  return buildingsOf(bp.planet, {
    research: state.research, catchUp: state.catchUp, buildingSpeed: state.buildingSpeed, storageFactor: state.storageFactor,
    arrivals: bp.arrivals, now, shown: bp.shown ?? undefined,
  });
}

export function alertsOf(db: DB, ctx: GroupContext, userId: number): BuildingAlert[] {
  return db
    .prepare('SELECT id, g, s, p, planet_type, element_id, level, created_at FROM building_alerts WHERE group_id = ? AND user_id = ? ORDER BY id')
    .all(ctx.groupId, userId) as BuildingAlert[];
}

/** An alert whose level is built or in the queue is done. */
export function alertDone(a: BuildingAlert, info: BuildingInfo | undefined): boolean {
  return !info || info.next > a.level;
}

export const planetOf = (state: BuildingsState, a: Pick<BuildingAlert, 'g' | 's' | 'p' | 'planet_type'>) =>
  state.planets.find((bp) => same(bp.coords, a) && bp.type === a.planet_type);
