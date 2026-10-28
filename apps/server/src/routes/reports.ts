import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { ownCoords } from '../repo/empire.js';
import { battleHallParticipantFilter } from '../repo/players.js';
import { latestScores } from '../repo/stats.js';
import { contextOf, DISPLAY, likeTerm, MEMBER, range, type Q } from './util.js';

export function reportsRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /** Archived battle hall reports, 100 per page; sort by units or date, filter by participant. */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/battle-hall', async (req) => {
    const ctx = ctxOf(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const order = req.query.sort === 'time' ? 'time DESC' : 'units DESC';
    const q = (req.query.q ?? '').trim();
    const participant = q ? battleHallParticipantFilter(db, ctx.groupId, q) : null;
    const where = `h.group_id = ?${participant ? ` AND ${participant.clause}` : ''}`;
    const args: unknown[] = [ctx.groupId, ...(participant?.args ?? [])];
    const total = db.prepare(`SELECT COUNT(*) FROM battle_hall h WHERE ${where}`).pluck().get(...args) as number;
    const rows = db
      .prepare(
        `SELECT h.*, EXISTS (SELECT 1 FROM combat_reports c WHERE c.group_id = h.group_id AND c.report_id = h.report_id) AS archived,
           COALESCE((SELECT c.moon_destruction FROM combat_reports c WHERE c.group_id = h.group_id AND c.report_id = h.report_id), 0) AS moon_destruction
         FROM battle_hall h WHERE ${where} ORDER BY h.${order}, h.id LIMIT 100 OFFSET ?`,
      )
      .all(...args, (page - 1) * 100) as any[];
    return {
      total, page, pages: Math.max(1, Math.ceil(total / 100)),
      entries: rows.map((r) => ({ ...r, attackers: JSON.parse(r.attackers), defenders: JSON.parse(r.defenders) })),
    };
  });

  /** One archived battle report, fleets expanded to element id -> amount before/after. */
  app.get<{ Params: { uni: string; id: string } }>('/api/:uni/combat-reports/:id', async (req) => {
    const ctx = ctxOf(req);
    const r = db.prepare('SELECT * FROM combat_reports WHERE group_id = ? AND report_id = ?').get(ctx.groupId, req.params.id) as any;
    if (!r) throw new HttpError(404, 'report_not_archived', 'Report not archived');
    const hall = db.prepare('SELECT units, attackers, defenders FROM battle_hall WHERE group_id = ? AND report_id = ?').get(ctx.groupId, req.params.id) as any;
    return {
      ...r,
      units: hall?.units ?? null,
      fleets: (JSON.parse(r.fleets) as [number, string, [number, number, number][]][]).map(([side, name, ships]) => ({
        side: side === 0 ? 'attacker' : 'defender',
        name,
        ships: ships.map(([id, before, after]) => ({ id, before, after })),
      })),
    };
  });

  /** Activity log, newest first; `kinds` filters (comma separated). */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/activity', async (req) => {
    const ctx = ctxOf(req);
    const { from, to } = range(req.query);
    const kinds = (req.query.kinds ?? '').split(',').filter(Boolean);
    const rows = db
      .prepare(
        `SELECT l.id, l.time, l.kind, l.g, l.s, l.p, l.planet_type, l.data, p.id AS player_id, p.name AS player_name, p.status,
           a.tag AS ally_tag, a.name AS ally_name
         FROM activity_log l LEFT JOIN players p ON p.id = l.player_id LEFT JOIN alliances a ON a.id = p.alliance_id
         WHERE l.group_id = ? AND l.time BETWEEN ? AND ? ${kinds.length ? `AND l.kind IN (${kinds.map(() => '?').join(',')})` : ''}
         ORDER BY l.time DESC, l.id DESC LIMIT 1000`,
      )
      .all(ctx.groupId, from, to, ...kinds) as any[];
    const counts = db
      .prepare('SELECT kind, COUNT(*) AS n FROM activity_log WHERE group_id = ? AND time BETWEEN ? AND ? GROUP BY kind')
      .all(ctx.groupId, from, to);
    // newest total points of the players: weak/strong (noob protection) are derived from them
    const scores = latestScores(db, ctx.groupId, [...new Set(rows.map((r) => r.player_id).filter((id) => id != null))], [1]);
    return {
      counts: Object.fromEntries((counts as { kind: string; n: number }[]).map((c) => [c.kind, c.n])),
      entries: rows.map((r) => ({ ...r, data: JSON.parse(r.data), status: r.status ? JSON.parse(r.status) : [], points: scores.get(r.player_id)?.[1]?.points ?? null })),
    };
  });

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/raids', async (req) => {
    const ctx = ctxOf(req);
    const { from, to } = range(req.query);
    const own = ownCoords(db, ctx);
    const rows = db
      .prepare(
        `SELECT b.*, ${DISPLAY} AS username FROM battle_reports b LEFT JOIN users u ON u.id = b.user_id ${MEMBER('b')}
         WHERE b.group_id = ? AND COALESCE(b.time, b.created_at) BETWEEN ? AND ? AND b.p <= ?
         ORDER BY COALESCE(b.time, b.created_at) DESC`,
      )
      .all(ctx.groupId, from, to, ctx.universe.settings.positions) as any[];
    const raids = rows.map((r) => ({ ...r, defense: own.get(r.user_id)?.has(`${r.g}:${r.s}:${r.p}`) ?? false }));

    const perUser = new Map<number | null, any>();
    for (const r of raids.filter((x) => !x.defense)) {
      const e = perUser.get(r.user_id) ?? { userId: r.user_id, username: r.username, raids: 0, metal: 0, crystal: 0, deuterium: 0, lost: 0, debris: 0 };
      e.raids++;
      e.metal += r.loot_metal;
      e.crystal += r.loot_crystal;
      e.deuterium += r.loot_deuterium;
      e.lost += r.lost_attacker;
      e.debris += r.debris_metal + r.debris_crystal;
      perUser.set(r.user_id, e);
    }
    const recycling = db
      .prepare(
        `SELECT r.*, ${DISPLAY} AS username FROM recycle_reports r LEFT JOIN users u ON u.id = r.user_id ${MEMBER('r')}
         WHERE r.group_id = ? AND COALESCE(r.time, r.created_at) BETWEEN ? AND ? ORDER BY COALESCE(r.time, r.created_at) DESC`,
      )
      .all(ctx.groupId, from, to) as any[];
    const recyclePerUser = new Map<number | null, any>();
    for (const r of recycling) {
      const e = recyclePerUser.get(r.user_id) ?? { userId: r.user_id, username: r.username, runs: 0, metal: 0, crystal: 0, left: 0 };
      e.runs++;
      e.metal += r.metal;
      e.crystal += r.crystal;
      e.left += Math.max(0, r.total_metal - r.metal) + Math.max(0, r.total_crystal - r.crystal);
      recyclePerUser.set(r.user_id, e);
    }
    return {
      from, to, perUser: [...perUser.values()], reports: raids.slice(0, 500),
      recyclePerUser: [...recyclePerUser.values()], recycling: recycling.slice(0, 500),
    };
  });

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/expeditions', async (req) => {
    const ctx = ctxOf(req);
    const { from, to } = range(req.query);
    const rows = db
      .prepare(
        `SELECT e.*, ${DISPLAY} AS username FROM expeditions e JOIN users u ON u.id = e.user_id ${MEMBER('e')}
         WHERE e.group_id = ? AND COALESCE(e.time, e.created_at) BETWEEN ? AND ? ORDER BY COALESCE(e.time, e.created_at) DESC`,
      )
      .all(ctx.groupId, from, to) as any[];

    const perUser = new Map<number | null, any>();
    for (const r of rows) {
      const e = perUser.get(r.user_id) ?? { userId: r.user_id, username: r.username, total: 0, events: {}, resources: {}, ships: {} };
      e.total++;
      const key = r.size === 'None' ? r.event : `${r.event}:${r.size}`;
      e.events[key] = (e.events[key] ?? 0) + 1;
      for (const [id, n] of Object.entries(JSON.parse(r.found_resources) as Record<string, number>)) e.resources[id] = (e.resources[id] ?? 0) + n;
      for (const [id, n] of Object.entries(JSON.parse(r.found_ships) as Record<string, number>)) e.ships[id] = (e.ships[id] ?? 0) + n;
      perUser.set(r.user_id, e);
    }
    const expected = Object.fromEntries(
      ctx.universe.deck.map((c) => [c.size === 'None' ? c.type : `${c.type}:${c.size}`, c.count]),
    );
    return {
      from,
      to,
      perUser: [...perUser.values()],
      deckSize: ctx.universe.deck.reduce((s, c) => s + c.count, 0),
      expected,
      list: rows.slice(0, 300).map((r) => ({ ...r, found_resources: JSON.parse(r.found_resources), found_ships: JSON.parse(r.found_ships) })),
    };
  });

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/hostile', async (req) => {
    const ctx = ctxOf(req);
    const { from, to } = range(req.query);
    const list = db
      .prepare(
        `SELECT h.*, ${DISPLAY} AS username FROM hostile_spying h LEFT JOIN users u ON u.id = h.user_id ${MEMBER('h')}
         WHERE h.group_id = ? AND (h.time IS NULL OR h.time BETWEEN ? AND ?) ORDER BY h.time DESC LIMIT 1000`,
      )
      .all(ctx.groupId, from, to);
    const bySpy = db
      .prepare(
        `SELECT from_player, COUNT(*) AS count, MAX(time) AS last, COUNT(DISTINCT user_id) AS victims
         FROM hostile_spying WHERE group_id = ? AND (time IS NULL OR time BETWEEN ? AND ?) GROUP BY from_player ORDER BY count DESC`,
      )
      .all(ctx.groupId, from, to);
    return { from, to, list, bySpy };
  });
}
