import { CLASS_BUILDINGS, PHALANX } from '@pr0hub/core/tech';
import { OPTIONAL_DEFAULTS } from '@pr0hub/core/universe';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { phalanxRange } from '../domain/phalanx.js';
import { latestEmpire, latestEmpires } from './empire.js';
import { alliance, memberPlayer } from './members.js';

/**
 * Sensor phalanxes the group knows: per moon the newest level from the moon spy reports that show the buildings or
 * from the members' empire pages, whichever is newer. Used by the galaxy browser (which moons reach a system) and the
 * hostile phalanx exposure of the members' planets.
 */

export interface PhalanxMoon {
  g: number;
  s: number;
  p: number;
  level: number;
  /** time of the page that showed `level` */
  time: number;
  source: 'spy' | 'empire';
  playerId: number | null;
  playerName: string | null;
  /** spy reports with the buildings, newest first: report time, when it reached the hub, phalanx level */
  history: { time: number; created: number; level: number }[];
}

type Pos = { player_id: number | null; destroyed: number; has_moon: number };

/**
 * The known phalanx moons of the group (of galaxy `g` when given). Moons the galaxy data shows destroyed since are left
 * out (like the farm finder).
 */
export function phalanxMoons(db: DB, ctx: GroupContext, g?: number): PhalanxMoon[] {
  const moons = new Map<string, PhalanxMoon>();
  const reports = db
    .prepare(
      `SELECT g, s, p, report_time, created_at, json_extract(sections, '$."${CLASS_BUILDINGS}"') AS buildings, player_id, player_name FROM spy_reports
       WHERE group_id = ? AND planet_type = 'moon' AND (? IS NULL OR g = ?) AND json_extract(sections, '$."${CLASS_BUILDINGS}"') IS NOT NULL
       ORDER BY report_time DESC`,
    )
    .all(ctx.groupId, g ?? null, g ?? null) as {
    g: number; s: number; p: number; report_time: number; created_at: number; buildings: string; player_id: number | null; player_name: string | null;
  }[];
  for (const r of reports) {
    const key = `${r.g}:${r.s}:${r.p}`;
    const level = (JSON.parse(r.buildings) as Record<string, number>)[PHALANX] ?? 0;
    const known = moons.get(key);
    if (known) {
      known.history.push({ time: r.report_time, created: r.created_at, level });
      continue;
    }
    moons.set(key, {
      g: r.g, s: r.s, p: r.p, level, time: r.report_time, source: 'spy', playerId: r.player_id, playerName: r.player_name,
      history: [{ time: r.report_time, created: r.created_at, level }],
    });
  }

  for (const e of latestEmpires(db, ctx)) {
    for (const pl of e.rec.planets) {
      if (pl.type !== 'moon' || (g != null && pl.coords.g !== g)) continue;
      const key = `${pl.coords.g}:${pl.coords.s}:${pl.coords.p}`;
      const cur = moons.get(key);
      if (cur && cur.time > e.time) continue;
      moons.set(key, {
        ...pl.coords, level: pl.values[PHALANX] ?? 0, time: e.time, source: 'empire', playerId: cur?.playerId ?? null, playerName: cur?.playerName ?? null,
        history: cur?.history ?? [],
      });
    }
  }

  const positions = new Map(
    (db.prepare('SELECT g, s, p, player_id, destroyed, has_moon FROM planets WHERE group_id = ? AND (? IS NULL OR g = ?)').all(ctx.groupId, g ?? null, g ?? null) as
      (Pos & { g: number; s: number; p: number })[]).map((r) => [`${r.g}:${r.s}:${r.p}`, r]),
  );
  return [...moons.values()].filter((m) => {
    const pos = positions.get(`${m.g}:${m.s}:${m.p}`);
    return !pos || (!pos.destroyed && !!pos.has_moon);
  });
}

/** Distance in systems like the game's `allowPhalanx` (circular galaxies wrap around). */
export function systemDistance(ctx: GroupContext, a: number, b: number) {
  const d = Math.abs(a - b);
  return ctx.universe.settings.circularSystems ? Math.min(d, ctx.universe.settings.systems - d) : d;
}

export const phalanxFactor = (ctx: GroupContext) => ctx.universe.settings.phalanxRangeFactor ?? OPTIONAL_DEFAULTS.phalanxRangeFactor;

/** Owner of a moon now: the galaxy's, else the spy report's; alliance tag (or name) and vacation mode. */
export interface PhalanxOwner {
  id: number | null;
  name: string;
  ally: string | null;
  vacation: boolean;
}

export function ownerOf(db: DB, ctx: GroupContext, m: Pick<PhalanxMoon, 'g' | 's' | 'p' | 'playerId' | 'playerName'>): PhalanxOwner | null {
  const owner = db
    .prepare(
      `SELECT p.id, p.name, p.status, a.name AS ally_name, a.tag AS ally_tag FROM planets pl JOIN players p ON p.id = pl.player_id
       LEFT JOIN alliances a ON a.id = p.alliance_id WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ?`,
    )
    .get(ctx.groupId, m.g, m.s, m.p) as { id: number; name: string; status: string | null; ally_name: string | null; ally_tag: string | null } | undefined;
  if (owner) {
    return { id: owner.id, name: owner.name, ally: owner.ally_tag ?? owner.ally_name, vacation: (JSON.parse(owner.status || '[]') as string[]).includes('vacation') };
  }
  return m.playerName ? { id: m.playerId, name: m.playerName, ally: null, vacation: false } : null;
}

/** A planet of a member: from their newest empire page, else the galaxy's planets of their player. */
export interface MemberPlanet {
  g: number;
  s: number;
  p: number;
  name: string | null;
}

export function memberPlanets(db: DB, ctx: GroupContext, userId: number): MemberPlanet[] {
  const empire = latestEmpire(db, ctx, userId);
  if (empire) return empire.rec.planets.filter((pl) => pl.type === 'planet').map((pl) => ({ ...pl.coords, name: pl.name || null }));
  const playerId = memberPlayer(db, ctx, userId);
  if (playerId == null) return [];
  return db
    .prepare('SELECT g, s, p, name FROM planets WHERE group_id = ? AND player_id = ? AND destroyed = 0 ORDER BY g, s, p')
    .all(ctx.groupId, playerId) as MemberPlanet[];
}

/** A hostile moon whose phalanx reaches a planet. */
export interface PhalanxThreat {
  moon: { g: number; s: number; p: number };
  level: number;
  /** range in systems */
  range: number;
  /** distance to the planet in systems */
  distance: number;
  /** time of the newest page that showed the level */
  time: number;
  /**
   * since when the group knows the phalanx reaches the planet: the oldest spy report of the newest run of reports whose
   * level reaches it (game time)
   */
  since: number;
  /** when that report reached the hub (a report pasted late is new knowledge) */
  known: number;
  player: PhalanxOwner | null;
}

export interface PhalanxExposure {
  planet: MemberPlanet;
  threats: PhalanxThreat[];
}

/**
 * Per planet the moons outside the own alliance (members, their players and the viewer's in-game alliance) whose
 * phalanx reaches it, the nearest first. A phalanx scans planets of its own galaxy: it shows the fleets flying from
 * and to the planet, not those of its moon.
 */
export function phalanxExposure(db: DB, ctx: GroupContext, planets: MemberPlanet[]): PhalanxExposure[] {
  if (!planets.length) return [];
  const ally = alliance(db, ctx);
  const factor = phalanxFactor(ctx);
  const galaxies = new Set(planets.map((pl) => pl.g));
  const owners = new Map<string, PhalanxOwner | null>();
  const hostile = [...galaxies].flatMap((g) =>
    phalanxMoons(db, ctx, g).filter((m) => {
      if (m.source !== 'spy' || m.level < 1 || ally.coords.has(`${m.g}:${m.s}:${m.p}`)) return false;
      const owner = ownerOf(db, ctx, m);
      owners.set(`${m.g}:${m.s}:${m.p}`, owner);
      return !owner || !ally.names.has(owner.name.toLowerCase());
    }),
  );
  return planets.map((planet) => {
    const threats: PhalanxThreat[] = [];
    for (const m of hostile) {
      if (m.g !== planet.g) continue;
      const distance = systemDistance(ctx, m.s, planet.s);
      // level 1 reaches its own system (range 0), level 0 nothing
      const reaches = (level: number) => level >= 1 && phalanxRange(level, factor) >= distance;
      if (!reaches(m.level)) continue;
      // the newest run of reports that reach the planet
      let start = m.history[0];
      for (const h of m.history) {
        if (!reaches(h.level)) break;
        start = h;
      }
      threats.push({
        moon: { g: m.g, s: m.s, p: m.p }, level: m.level, range: phalanxRange(m.level, factor), distance, time: m.time, since: start.time, known: start.created,
        player: owners.get(`${m.g}:${m.s}:${m.p}`) ?? null,
      });
    }
    threats.sort((a, b) => a.distance - b.distance || b.level - a.level);
    return { planet, threats };
  });
}
