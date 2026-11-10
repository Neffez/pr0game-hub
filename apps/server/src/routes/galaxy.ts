import { CLASS_RESOURCES } from '@pr0hub/core/tech';
import type { FastifyInstance } from 'fastify';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { phalanxRange } from '../domain/phalanx.js';
import { colonizeSystems, freePositions } from '../repo/colonize.js';
import { debrisFields } from '../repo/debris.js';
import { ownCoords } from '../repo/empire.js';
import { ownerOf, phalanxFactor, phalanxMoons, systemDistance } from '../repo/phalanx.js';
import { latestScores } from '../repo/stats.js';
import { clampInt, contextOf, DISPLAY, MEMBER } from './util.js';
import { debrisAmount } from '@pr0hub/core';
import { lastDebrisCleanup } from '@pr0hub/core/universe';


export function galaxyRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string } }>('/api/:uni/galaxy-views', async (req) => {
    const ctx = ctxOf(req);
    return db
      .prepare(
        `SELECT v.g, v.s, v.seen_at, ${DISPLAY} AS username FROM galaxy_views v LEFT JOIN users u ON u.id = v.user_id ${MEMBER('v')} WHERE v.group_id = ?`,
      )
      .all(ctx.groupId);
  });

  /**
   * Debris fields of galaxies (`g=1,2`) that recyclers can fly to by the group's data. The game allows it while the
   * field holds debris or is active (a battle left debris there since its weekly cleaner, `lastDebrisCleanup`; the
   * cleaner marks all fields inactive, harvesting empties a field but keeps it active). `sure`: active since the last
   * cleaner run, or the galaxy showed debris after it; otherwise the galaxy showed debris before the run, which may be
   * harvested since (then the empty field is gone).
   */
  app.get<{ Params: { uni: string }; Querystring: { g?: string } }>('/api/:uni/debris-fields', async (req) => {
    const ctx = ctxOf(req);
    const max = ctx.universe.settings.galaxies;
    const galaxies = [...new Set(String(req.query.g ?? '').split(',').map(Number).filter((g) => Number.isInteger(g) && g >= 1 && g <= max))].slice(0, 10);
    const cleanup = lastDebrisCleanup(ctx.universe.settings, ctx.now);
    const fields = Object.fromEntries(
      galaxies.map((g) => {
        const out = new Map<string, { s: number; p: number; visible: boolean; active: boolean; time: number; sure: boolean }>();
        const get = (s: number, p: number) => out.get(`${s}:${p}`) ?? { s, p, visible: false, active: false, time: 0, sure: false };
        for (const r of db.prepare('SELECT s, p, debris, updated_at FROM planets WHERE group_id = ? AND g = ? AND debris IS NOT NULL').all(ctx.groupId, g) as
          { s: number; p: number; debris: string; updated_at: number }[]) {
          const d = JSON.parse(r.debris) as { metal: string; crystal: string };
          if (debrisAmount(d.metal) + debrisAmount(d.crystal) <= 0) continue;
          const f = get(r.s, r.p);
          out.set(`${r.s}:${r.p}`, { ...f, visible: true, time: Math.max(f.time, r.updated_at) });
        }
        // debris created since the cleaner: battles leaving debris, debris appearing or growing in the galaxy
        const created = db
          .prepare(
            `SELECT s, p, time FROM activity_log WHERE group_id = ? AND g = ? AND kind IN ('debris_new', 'debris_grown') AND time >= ?
             UNION ALL SELECT s, p, COALESCE(time, created_at) FROM battle_reports WHERE group_id = ? AND g = ? AND debris_metal + debris_crystal > 0 AND COALESCE(time, created_at) >= ?`,
          )
          .all(ctx.groupId, g, cleanup, ctx.groupId, g, cleanup) as { s: number; p: number; time: number }[];
        for (const r of created) {
          const f = get(r.s, r.p);
          out.set(`${r.s}:${r.p}`, { ...f, active: true, time: Math.max(f.time, r.time) });
        }
        const list = [...out.values()].map((f) => ({ ...f, sure: f.active || (f.visible && f.time >= cleanup) }));
        return [g, list.sort((a, b) => a.s - b.s || a.p - b.p)];
      }),
    );
    return { fields, cleanup };
  });

  /** Free positions of galaxies (`g=1,2`) by the group's galaxy data: fleet save targets by colonization. */
  app.get<{ Params: { uni: string }; Querystring: { g?: string } }>('/api/:uni/free-positions', async (req) => {
    const ctx = ctxOf(req);
    const max = ctx.universe.settings.galaxies;
    const galaxies = [...new Set(String(req.query.g ?? '').split(',').map(Number).filter((g) => Number.isInteger(g) && g >= 1 && g <= max))].slice(0, 10);
    return { systems: freePositions(db, ctx, galaxies) };
  });

  /** Debris finder: open debris fields with the debris expected now and the members' recyclers (see `debrisFields`). */
  app.get<{ Params: { uni: string }; Querystring: { days?: string } }>('/api/:uni/debris', async (req) => {
    const ctx = ctxOf(req);
    const days = clampInt(req.query.days, 7, 1, 30);
    return { ...debrisFields(db, ctx, days), days, now: ctx.now };
  });

  /** Colonization planner: systems with free positions and what a colony there adds (see `colonizeSystems`). */
  app.get<{ Params: { uni: string }; Querystring: { range?: string } }>('/api/:uni/colonize', async (req) => {
    const ctx = ctxOf(req);
    return colonizeSystems(db, ctx, clampInt(req.query.range, 25, 1, 200));
  });

  /**
   * Per system of a galaxy: occupied positions, the summed newest total points of the players there (each player once),
   * own/alliance planets and when it was last seen (navigation strip).
   */
  app.get<{ Params: { uni: string; g: string } }>('/api/:uni/browse/:g', async (req) => {
    const ctx = ctxOf(req);
    const g = Number(req.params.g);
    const planets = db
      .prepare('SELECT s, COUNT(player_id) AS planets FROM planets WHERE group_id = ? AND g = ? AND player_id IS NOT NULL GROUP BY s')
      .all(ctx.groupId, g) as { s: number; planets: number }[];
    const owners = db
      .prepare('SELECT DISTINCT s, player_id FROM planets WHERE group_id = ? AND g = ? AND player_id IS NOT NULL')
      .all(ctx.groupId, g) as { s: number; player_id: number }[];
    const scores = latestScores(db, ctx.groupId, [...new Set(owners.map((r) => r.player_id))], [1]);
    const points: Record<number, number> = {};
    for (const r of owners) points[r.s] = (points[r.s] ?? 0) + (scores.get(r.player_id)?.[1]?.points ?? 0);
    const views = db.prepare('SELECT s, seen_at FROM galaxy_views WHERE group_id = ? AND g = ?').all(ctx.groupId, g) as { s: number; seen_at: number }[];
    const own = new Set<number>();
    for (const set of ownCoords(db, ctx).values()) for (const c of set) if (c.startsWith(`${g}:`)) own.add(Number(c.split(':')[1]));
    return {
      planets: Object.fromEntries(planets.map((r) => [r.s, r.planets])),
      points,
      seen: Object.fromEntries(views.map((r) => [r.s, r.seen_at])),
      own: [...own],
    };
  });

  /** One solar system like the in-game galaxy view, from the synced galaxy data. */
  app.get<{ Params: { uni: string; g: string; s: string } }>('/api/:uni/browse/:g/:s', async (req) => {
    const ctx = ctxOf(req);
    const g = Number(req.params.g);
    const s = Number(req.params.s);
    const view = db
      .prepare(
        `SELECT v.seen_at, ${DISPLAY} AS username FROM galaxy_views v LEFT JOIN users u ON u.id = v.user_id ${MEMBER('v')}
         WHERE v.group_id = ? AND v.g = ? AND v.s = ?`,
      )
      .get(ctx.groupId, g, s);
    const rows = db
      .prepare(
        `SELECT pl.p, pl.name, pl.has_moon, pl.moon_name, pl.moon_diameter, pl.destroyed, pl.debris, pl.updated_at,
           p.id AS player_id, p.ingame_id, p.name AS player_name, p.status, p.note, a.id AS ally_id, a.name AS ally_name, a.tag AS ally_tag,
           (SELECT MAX(COALESCE(time, created_at)) FROM battle_reports b WHERE b.group_id = pl.group_id AND b.g = pl.g AND b.s = pl.s AND b.p = pl.p) AS last_battle
         FROM planets pl LEFT JOIN players p ON p.id = pl.player_id LEFT JOIN alliances a ON a.id = p.alliance_id
         WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? ORDER BY pl.p`,
      )
      .all(ctx.groupId, g, s) as any[];
    // newest total points and rank of the players in the system
    const scores = latestScores(db, ctx.groupId, [...new Set(rows.map((r) => r.player_id).filter((id) => id != null))], [1]);
    const system = rows.map((r) => ({
      ...r,
      points: scores.get(r.player_id)?.[1]?.points ?? null,
      rank: scores.get(r.player_id)?.[1]?.rank ?? null,
      status: r.status ? JSON.parse(r.status) : [],
      debris: r.debris ? JSON.parse(r.debris) : null,
    }));
    // planets of alliance members (latest empire pages)
    const own = new Set([...ownCoords(db, ctx).values()].flatMap((set) => [...set]));

    // Last spy report per position and type: time plus the resources it showed (like FF-Hub).
    const spy = new Map<string, { time: number; res: Record<string, number> | null; resTime: number | null }>();
    const reports = db
      .prepare('SELECT p, planet_type, report_time, sections FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? ORDER BY report_time DESC')
      .all(ctx.groupId, g, s) as { p: number; planet_type: string; report_time: number; sections: string }[];
    for (const rep of reports) {
      const key = `${rep.p}:${rep.planet_type}`;
      const cur = spy.get(key) ?? { time: rep.report_time, res: null, resTime: null };
      if (!cur.res) {
        const res = (JSON.parse(rep.sections) as Record<string, Record<string, number>>)[CLASS_RESOURCES];
        if (res) Object.assign(cur, { res, resTime: rep.report_time });
      }
      spy.set(key, cur);
    }
    return {
      view: view ?? null,
      phalanx: phalanxCoverage(db, ctx, g, s),
      rows: system.map((r) => ({
        ...r,
        own: own.has(`${g}:${s}:${r.p}`),
        spy_planet: spy.get(`${r.p}:planet`) ?? null,
        spy_moon: spy.get(`${r.p}:moon`) ?? null,
      })),
    };
  });
}

/**
 * Moons of a galaxy whose sensor phalanx reaches system `s`. Levels come from the newest moon spy
 * report with buildings or the alliance members' empire pages, whichever is newer.
 */
function phalanxCoverage(db: DB, ctx: GroupContext, g: number, s: number) {
  const factor = phalanxFactor(ctx);
  const systems = ctx.universe.settings.systems;
  const own = new Set([...ownCoords(db, ctx).values()].flatMap((set) => [...set]));
  const wrap = (x: number) => (ctx.universe.settings.circularSystems ? ((x - 1 + systems) % systems) + 1 : Math.min(systems, Math.max(1, x)));
  const out = [];
  for (const m of phalanxMoons(db, ctx, g)) {
    if (!m.level) continue;
    const range = phalanxRange(m.level, factor);
    const dist = systemDistance(ctx, m.s, s);
    if (dist > range) continue;
    out.push({
      g, s: m.s, p: m.p, level: m.level, range, from: wrap(m.s - range), to: wrap(m.s + range), distance: dist,
      time: m.time, source: m.source, own: own.has(`${g}:${m.s}:${m.p}`),
      player: ownerOf(db, ctx, m),
    });
  }
  return out.sort((a, b) => b.time - a.time);
}
