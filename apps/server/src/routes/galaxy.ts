import { CLASS_BUILDINGS, CLASS_RESOURCES, PHALANX } from '@pr0hub/core/tech';
import type { FastifyInstance } from 'fastify';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { phalanxRange } from '../domain/phalanx.js';
import { latestEmpires, ownCoords } from '../repo/empire.js';
import { contextOf, DISPLAY, MEMBER } from './util.js';

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

  /** Per system of a galaxy: occupied positions, own/alliance planets and when it was last seen (navigation strip). */
  app.get<{ Params: { uni: string; g: string } }>('/api/:uni/browse/:g', async (req) => {
    const ctx = ctxOf(req);
    const g = Number(req.params.g);
    const planets = db
      .prepare('SELECT s, COUNT(player_id) AS planets FROM planets WHERE group_id = ? AND g = ? AND player_id IS NOT NULL GROUP BY s')
      .all(ctx.groupId, g) as { s: number; planets: number }[];
    const views = db.prepare('SELECT s, seen_at FROM galaxy_views WHERE group_id = ? AND g = ?').all(ctx.groupId, g) as { s: number; seen_at: number }[];
    const own = new Set<number>();
    for (const set of ownCoords(db, ctx).values()) for (const c of set) if (c.startsWith(`${g}:`)) own.add(Number(c.split(':')[1]));
    return {
      planets: Object.fromEntries(planets.map((r) => [r.s, r.planets])),
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
        `SELECT pl.p, pl.name, pl.has_moon, pl.moon_name, pl.destroyed, pl.debris, pl.updated_at,
           p.id AS player_id, p.ingame_id, p.name AS player_name, p.status, p.note, a.id AS ally_id, a.name AS ally_name, a.tag AS ally_tag,
           (SELECT ps.points FROM player_scores ps JOIN stat_snapshots st ON st.id = ps.snapshot_id
              WHERE ps.player_id = p.id AND st.type = 1 ORDER BY st.stat_time DESC LIMIT 1) AS points,
           (SELECT ps.rank FROM player_scores ps JOIN stat_snapshots st ON st.id = ps.snapshot_id
              WHERE ps.player_id = p.id AND st.type = 1 ORDER BY st.stat_time DESC LIMIT 1) AS rank,
           (SELECT MAX(COALESCE(time, created_at)) FROM battle_reports b WHERE b.group_id = pl.group_id AND b.g = pl.g AND b.s = pl.s AND b.p = pl.p) AS last_battle
         FROM planets pl LEFT JOIN players p ON p.id = pl.player_id LEFT JOIN alliances a ON a.id = p.alliance_id
         WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? ORDER BY pl.p`,
      )
      .all(ctx.groupId, g, s)
      .map((r: any) => ({ ...r, status: r.status ? JSON.parse(r.status) : [], debris: r.debris ? JSON.parse(r.debris) : null }));
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
      rows: rows.map((r) => ({
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
  const settings = ctx.universe.settings as typeof ctx.universe.settings & { phalanxRangeFactor?: number };
  const factor = settings.phalanxRangeFactor ?? 1;
  type Moon = { s: number; p: number; level: number; time: number; source: 'spy' | 'empire'; playerId: number | null; playerName: string | null };
  const moons = new Map<string, Moon>();

  const reports = db
    .prepare(
      `SELECT s, p, report_time, sections, player_id, player_name FROM spy_reports
       WHERE group_id = ? AND g = ? AND planet_type = 'moon' ORDER BY report_time DESC`,
    )
    .all(ctx.groupId, g) as { s: number; p: number; report_time: number; sections: string; player_id: number | null; player_name: string }[];
  for (const r of reports) {
    const key = `${r.s}:${r.p}`;
    if (moons.has(key)) continue;
    const buildings = (JSON.parse(r.sections) as Record<string, Record<string, number>>)[CLASS_BUILDINGS];
    // only reports that show the buildings tell the phalanx level
    if (!buildings) continue;
    moons.set(key, { s: r.s, p: r.p, level: buildings[PHALANX] ?? 0, time: r.report_time, source: 'spy', playerId: r.player_id, playerName: r.player_name });
  }

  for (const e of latestEmpires(db, ctx)) {
    for (const pl of e.rec.planets) {
      if (pl.type !== 'moon' || pl.coords.g !== g) continue;
      const key = `${pl.coords.s}:${pl.coords.p}`;
      const cur = moons.get(key);
      if (cur && cur.time > e.time) continue;
      moons.set(key, { s: pl.coords.s, p: pl.coords.p, level: pl.values[PHALANX] ?? 0, time: e.time, source: 'empire', playerId: cur?.playerId ?? null, playerName: cur?.playerName ?? null });
    }
  }

  const systems = ctx.universe.settings.systems;
  const own = new Set([...ownCoords(db, ctx).values()].flatMap((set) => [...set]));
  const out = [];
  for (const m of moons.values()) {
    const range = phalanxRange(m.level, factor);
    if (!m.level) continue;
    const d = Math.abs(m.s - s);
    const dist = ctx.universe.settings.circularSystems ? Math.min(d, systems - d) : d;
    if (dist > range) continue;
    // current owner from the galaxy data, falling back to the spy report
    const owner = db
      .prepare(
        `SELECT p.id, p.name, a.name AS ally_name, a.tag AS ally_tag FROM planets pl JOIN players p ON p.id = pl.player_id
         LEFT JOIN alliances a ON a.id = p.alliance_id WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ?`,
      )
      .get(ctx.groupId, g, m.s, m.p) as { id: number; name: string; ally_name: string | null; ally_tag: string | null } | undefined;
    const wrap = (x: number) => (ctx.universe.settings.circularSystems ? ((x - 1 + systems) % systems) + 1 : Math.min(systems, Math.max(1, x)));
    out.push({
      g, s: m.s, p: m.p, level: m.level, range, from: wrap(m.s - range), to: wrap(m.s + range), distance: dist,
      time: m.time, source: m.source, own: own.has(`${g}:${m.s}:${m.p}`),
      player: owner ? { id: owner.id, name: owner.name, ally: owner.ally_tag ?? owner.ally_name } : m.playerName ? { id: m.playerId, name: m.playerName, ally: null } : null,
    });
  }
  return out.sort((a, b) => b.time - a.time);
}
