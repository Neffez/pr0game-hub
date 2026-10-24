import type { BuildingsRecord, EmpireRecord, OverviewRecord, ResearchRecord } from '@pr0hub/core';
import {
  buildingsOf, capacityOf, catchUpBonus, catchUpFromCosts, deriveBuildingSpeed, deriveResearchSpeed, labLevels, levelAfter, LOCKED_BY, NANITE_FACTORY,
  RESEARCH_LAB, RESEARCH_NETWORK, researchOf, resourceAt, resourceReadyAt, ROBOT_FACTORY, TECHNO_DOME, type Arrival, type BuildingInfo, type BuildPlanet,
} from '@pr0hub/core/buildings';
import { METAL, RESOURCES, STORAGE, storageCapacity } from '@pr0hub/core/tech';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { latestEmpire } from './empire.js';
import { sharedFleets, type StoredFleet } from './fleets.js';
import { memberPlayer } from './members.js';
import { CATCH_UP_WEIGHTS, catchUpLeader, latestScores } from './stats.js';

/**
 * The member's planets and moons as the build & research page needs them: the newest empire page, a buildings or
 * research page of the planet when it is newer (they also show the exact costs and times), the build queue of the
 * newest page that has one (overview, buildings page or empire marker), the account's research levels and queue, and
 * the resources of fleets landing on the planet.
 */

type Coords = { g: number; s: number; p: number };

export interface BuildingPlanet {
  key: string;
  name: string;
  coords: Coords;
  type: 'planet' | 'moon';
  /** where levels and resources come from, and when it was synced */
  source: 'empire' | 'buildings' | 'research';
  planet: BuildPlanet;
  /** next level cost and build time as the buildings page showed them */
  shown: Record<string, { next: number; cost: Record<number, number>; time: number | null }> | null;
  /** next level cost and research time as the research page of this planet showed them */
  shownResearch: Record<string, { next: number; cost: Record<number, number>; time: number | null }> | null;
  arrivals: (Arrival & { missionName: string; from: Coords })[];
}

export interface BuildingsState {
  planets: BuildingPlanet[];
  /** research levels of the account (finished queue entries included) */
  research: Record<string, number>;
  /** account wide research queue, first in progress; `end` when known; `coords` of the planet it runs on when known */
  researchQueue: { id: number; level: number; end: number | null }[];
  /** universe research speed: derived from a research page, else the universe setting; null when unknown */
  researchSpeed: number | null;
  universityFactor: number;
  /** catch-up bonus in percent (not rounded), see `catchUpOf` */
  catchUp: number | null;
  /** where the bonus comes from and as of when */
  catchUpFrom: { source: 'page' | 'research' | 'overview' | 'stats'; time: number } | null;
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
  const researchPages = (
    db
      .prepare('SELECT page_time AS time, data FROM research_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC')
      .all(ctx.groupId, userId) as { time: number; data: string }[]
  ).map((r) => ({ time: r.time, rec: JSON.parse(r.data) as ResearchRecord }));
  const fleets = sharedFleets(db, ctx.groupId, userId, userId);
  const settings = ctx.universe.settings as typeof ctx.universe.settings & { storageMultiplier?: number };

  const storageFactor = storageFactorOf(empire?.rec ?? null, pages[0]?.rec ?? null) ?? settings.storageMultiplier ?? 1;
  const planets = new Map<string, BuildingPlanet>();
  for (const p of empire?.rec.planets ?? []) {
    const key = keyOf(p.coords, p.type);
    planets.set(key, {
      key, name: p.name, coords: p.coords, type: p.type, source: 'empire', shown: null, shownResearch: null, arrivals: [],
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
        key, name: '', coords: r.coords, type: r.type, source: 'buildings', shown: null, shownResearch: null, arrivals: [],
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
  // research pages: the planet's resource bar when newer; levels and queue are the account's (below)
  for (const page of researchPages) {
    const r = page.rec;
    const key = keyOf(r.coords, r.type);
    let bp = planets.get(key);
    if (!bp) {
      bp = {
        key, name: '', coords: r.coords, type: r.type, source: 'research', shown: null, shownResearch: null, arrivals: [],
        planet: { type: r.type, values: {}, resources: {}, perHour: {}, time: page.time, queue: [] },
      };
      planets.set(key, bp);
    }
    bp.shownResearch = Object.fromEntries(
      r.research.map((e) => {
        const queued = [...r.queue].reverse().find((q) => q.id === e.id);
        return [e.id, { next: (queued ? queued.level : e.level) + 1, cost: e.cost, time: e.time }];
      }),
    );
    if (page.time < bp.planet.time) continue;
    bp.source = 'research';
    bp.planet.resources = { ...bp.planet.resources, ...r.resources };
    if (Object.keys(r.storage).length) bp.planet.storage = { ...r.storage };
    if (Object.keys(r.perHour).length) bp.planet.perHour = { ...bp.planet.perHour, ...r.perHour };
    // the lab level when a requirement line shows it
    if (r.known?.[RESEARCH_LAB] != null) bp.planet.values[RESEARCH_LAB] = r.known[RESEARCH_LAB];
    bp.planet.time = page.time;
  }
  // the overview shows the running build of every planet: newer than the page a planet comes from, it wins
  if (overview) {
    for (const bp of planets.values()) {
      if (overview.time < bp.planet.time - 60) continue;
      const q = overview.rec.queues.find((x) => x.kind === 'building' && same(x.coords, bp.coords) && x.type === bp.type);
      // entries of the older queue before the running one are done (also those that ended before the overview when it
      // shows none); the ones after it still wait
      const at = q ? bp.planet.queue.findIndex((x) => x.id === q.id && x.level === q.level && x.destroy === q.destroy) : -1;
      const done = at > 0 ? bp.planet.queue.slice(0, at) : bp.planet.queue.filter((x) => x.end != null && x.end <= overview.time);
      for (const d of done) bp.planet.values[d.id] = levelAfter(d);
      const rest = at >= 0 ? bp.planet.queue.slice(at + 1) : [];
      bp.planet.queue = q ? [{ id: q.id, level: q.level, destroy: q.destroy, end: overview.time + q.seconds }, ...rest] : [];
    }
  }
  // research levels and queue of the account; queue entries done by now raise the levels
  const { levels, queue: researchQueue } = researchState(empire, overview, researchPages, t);
  // facilities in use, from the newest page that tells: research account wide, the shipyard per planet
  const research = researchBusy(researchQueue, overview, empire, pages);
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
  // a research lab or TechnoDome in any build queue blocks research everywhere
  const lab = labBusy([...planets.values()], researchPages[0] ?? null, overview, t);
  for (const bp of planets.values()) bp.planet.busy!.lab = lab;
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

  const catchUp = catchUpOf(db, ctx, userId, overview, [
    ...pages,
    ...researchPages.map((p) => ({
      time: p.time, source: 'research' as const,
      rec: { catchUp: p.rec.catchUp, buildings: p.rec.research, queue: p.rec.queue.map((q) => ({ ...q, destroy: false })) },
    })),
  ]);
  const list = [...planets.values()];
  const universityFactor = settings.universityFactor ?? 8;
  return {
    planets: list,
    research: levels,
    researchQueue,
    researchSpeed: derivedResearchSpeed(db, ctx, userId, researchPages, levels, universityFactor) ?? (settings.researchSpeed || null),
    universityFactor,
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
  db: DB, ctx: GroupContext, userId: number, overview: { time: number; rec: OverviewRecord } | null,
  pages: { time: number; source?: 'research'; rec: Pick<BuildingsRecord, 'catchUp' | 'buildings' | 'queue'> }[],
): { value: number; source: 'page' | 'research' | 'overview' | 'stats'; time: number } | null {
  const shown: { value: number; source: 'page' | 'research' | 'overview'; time: number }[] = [];
  if (overview && overview.rec.catchUp != null) shown.push({ value: overview.rec.catchUp, source: 'overview', time: overview.time });
  for (const p of pages) {
    if (p.rec.catchUp == null) continue;
    // the exact value only while it fits the rounded one shown
    const exact = catchUpFromCosts(p.rec);
    shown.push({ value: exact != null && Math.abs(exact - p.rec.catchUp) < 0.006 ? exact : p.rec.catchUp, source: p.source ?? 'page', time: p.time });
  }
  // pages first on equal times (exact)
  const isOverview = (s: { source: string }) => (s.source === 'overview' ? 1 : 0);
  const latest = shown.sort((a, b) => b.time - a.time || isOverview(a) - isOverview(b))[0] ?? null;
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

type ResearchQueue = { id: number; level: number; end: number | null }[];

/**
 * Research levels and queue of the account from the newest source: a research page (levels and the whole queue with
 * its ends), the overview (the running research with its end) or the empire page (levels and the running research,
 * no end; the overview's end applies when it shows the same). Entries done by `t` raise the levels.
 */
function researchState(
  empire: { time: number; rec: EmpireRecord } | null, overview: { time: number; rec: OverviewRecord } | null,
  pages: { time: number; rec: ResearchRecord }[], t: number,
): { levels: Record<string, number>; queue: ResearchQueue } {
  const levels: Record<string, number> = { ...(empire?.rec.research ?? {}) };
  const page = pages[0] ?? null;
  if (page && (!empire || page.time >= empire.time)) {
    for (const e of page.rec.research) levels[e.id] = e.level;
    // research the page leaves out ("hide useless") when a requirement line shows its level
    for (const [id, level] of Object.entries(page.rec.known ?? {})) if (Number(id) >= 100 && !page.rec.research.some((e) => e.id === Number(id))) levels[id] = level;
  }
  const running = overview?.rec.queues.find((x) => x.kind === 'research');
  const sources: { time: number; queue: ResearchQueue }[] = [];
  if (empire) {
    const m = empire.rec.researchQueue;
    sources.push({ time: empire.time, queue: m ? [{ id: m.id, level: m.level, end: null }] : [] });
  }
  if (overview) sources.push({ time: overview.time, queue: running ? [{ id: running.id, level: running.level, end: overview.time + running.seconds }] : [] });
  if (page) sources.push({ time: page.time, queue: page.rec.queue.map((q) => ({ ...q })) });
  const queue = [...sources].sort((a, b) => b.time - a.time)[0]?.queue.map((q) => ({ ...q })) ?? [];
  if (running && queue[0] && queue[0].end == null && queue[0].id === running.id && queue[0].level === running.level) {
    queue[0].end = overview!.time + running.seconds;
  }
  while (queue[0]?.end != null && queue[0].end <= t) {
    const done = queue.shift()!;
    levels[done.id] = Math.max(levels[done.id] ?? 0, done.level);
  }
  return { levels, queue };
}

/**
 * Research in progress (account wide, blocks lab and TechnoDome): the research queue until its last entry ends, or a
 * buildings page showing the lab or TechnoDome "busy" when that is newer than what the queue comes from.
 */
function researchBusy(
  queue: ResearchQueue, overview: { time: number; rec: OverviewRecord } | null, empire: { time: number } | null, pages: { time: number; rec: BuildingsRecord }[],
): { until: number | null } | null {
  if (queue.length) return { until: queue.every((q) => q.end != null) ? Math.max(...queue.map((q) => q.end!)) : null };
  const known = Math.max(overview?.time ?? 0, empire?.time ?? 0);
  for (const page of pages) {
    if (page.time <= known) continue;
    const lock = page.rec.buildings.filter((b) => LOCKED_BY[b.id] === 'research');
    if (lock.length) return lock.some((b) => b.busy) ? { until: null } : null;
  }
  return null;
}

/**
 * A research lab or TechnoDome in the build queue of any planet blocks research: until the last of them ends (null when
 * an end is unknown). A research page saying so counts while nothing newer tells about the queues.
 */
function labBusy(planets: BuildingPlanet[], page: { time: number; rec: ResearchRecord } | null, overview: { time: number } | null, t: number): { until: number | null } | null {
  const builds = planets.flatMap((bp) => bp.planet.queue.filter((q) => (q.id === RESEARCH_LAB || q.id === TECHNO_DOME) && (q.end == null || q.end > t)));
  if (builds.length) return { until: builds.every((q) => q.end != null) ? Math.max(...builds.map((q) => q.end!)) : null };
  if (page?.rec.labBusy && page.time >= (overview?.time ?? 0) && planets.every((bp) => bp.planet.time <= page.time)) return { until: null };
  return null;
}

/** Research speed from the longest research time of the newest research page (lab levels as now, with the network). */
/**
 * Research speed from the longest research time of the newest research page that allows it. The time the page shows
 * depends on the lab levels of that moment: they come from the empire page synced closest to it (the newest before,
 * else the first after), the research network level from the page itself.
 */
function derivedResearchSpeed(
  db: DB, ctx: GroupContext, userId: number, pages: { time: number; rec: ResearchRecord }[], research: Record<string, number>, universityFactor: number,
): number | null {
  const near = db.prepare(
    `SELECT data FROM empire_snapshots WHERE group_id = ? AND user_id = ?
     ORDER BY CASE WHEN created_at <= ? THEN 0 ELSE 1 END, ABS(created_at - ?), id DESC LIMIT 1`,
  );
  for (const { time, rec } of pages) {
    const row = near.get(ctx.groupId, userId, time, time) as { data: string } | undefined;
    const planets = row ? (JSON.parse(row.data) as EmpireRecord).planets.filter((p) => p.type === 'planet') : [];
    const here = planets.find((p) => same(p.coords, rec.coords));
    const network = rec.research.find((e) => e.id === RESEARCH_NETWORK)?.level ?? research[RESEARCH_NETWORK] ?? 0;
    // the own lab as the page's requirement lines show it (exact), else from that empire page; other labs need one
    const own = rec.known?.[RESEARCH_LAB] ?? here?.values[RESEARCH_LAB] ?? 0;
    if (!own || (network > 0 && !row)) continue;
    const others = planets.filter((p) => !same(p.coords, rec.coords)).map((p) => p.values[RESEARCH_LAB] ?? 0);
    const longest = [...rec.research].filter((e) => e.time != null).sort((a, b) => b.time! - a.time!)[0];
    if (!longest) continue;
    const lab = labLevels(longest.id, own, others, network);
    const speed = deriveResearchSpeed(longest.cost, longest.time!, lab, here?.values[TECHNO_DOME] ?? 0, universityFactor);
    if (speed) return speed;
  }
  return null;
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

/** The research with its next level when started on this planet at `now` (moons: none). */
export function planetResearch(state: BuildingsState, bp: BuildingPlanet, now: number): BuildingInfo[] {
  if (bp.type !== 'planet') return [];
  return researchOf(bp.planet, {
    research: state.research, queue: state.researchQueue,
    otherLabs: state.planets.filter((p) => p !== bp && p.type === 'planet').map((p) => p.planet.values[RESEARCH_LAB] ?? 0),
    catchUp: state.catchUp, researchSpeed: state.researchSpeed, universityFactor: state.universityFactor, storageFactor: state.storageFactor,
    arrivals: bp.arrivals, now, shown: bp.shownResearch ?? undefined,
  });
}

/** Buildings and research of a planet (for the alerts). */
export const planetElements = (state: BuildingsState, bp: BuildingPlanet, now: number) => [...planetBuildings(state, bp, now), ...planetResearch(state, bp, now)];

/**
 * When each storage of a planet is full: production up to the capacity or fleets landing (null: not by what is known,
 * e.g. no production); `full` when it is at `t`. Moons have no production and no entries, as have storages whose
 * capacity is unknown (no resource bar and no storage level synced).
 */
export function storagesOf(state: BuildingsState, bp: BuildingPlanet, t: number): { resource: number; at: number | null; full: boolean }[] {
  if (bp.type !== 'planet') return [];
  const p = bp.planet;
  return RESOURCES.filter((res) => p.storage?.[res] != null || p.values[STORAGE[res]] != null).map((res) => {
    const cap = capacityOf(p, res, state.storageFactor);
    const arrivals = bp.arrivals.map((a) => ({ at: a.at, amount: a.resources[res] ?? 0 })).filter((a) => a.amount > 0);
    const start = p.resources[res] ?? 0;
    const perHour = p.perHour[res] ?? 0;
    const at = cap > 0 ? resourceReadyAt(cap, start, perHour, cap, p.time, arrivals) : null;
    // consumption (negative production) empties a storage that fleets filled
    const full = at != null && at <= t && resourceAt(start, perHour, cap, p.time, t, arrivals) >= cap;
    return { resource: res, at, full };
  });
}

export function alertsOf(db: DB, ctx: GroupContext, userId: number): BuildingAlert[] {
  return db
    .prepare('SELECT id, g, s, p, planet_type, element_id, level, created_at FROM building_alerts WHERE group_id = ? AND user_id = ? ORDER BY id')
    .all(ctx.groupId, userId) as BuildingAlert[];
}

/** An alert whose level is built, researched or in the queue is done. */
export function alertDone(a: BuildingAlert, info: BuildingInfo | undefined): boolean {
  return !info || info.next > a.level;
}

export const planetOf = (state: BuildingsState, a: Pick<BuildingAlert, 'g' | 's' | 'p' | 'planet_type'>) =>
  state.planets.find((bp) => same(bp.coords, a) && bp.type === a.planet_type);
