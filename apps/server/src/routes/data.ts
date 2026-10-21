import { computeDeck, type DeckEvent, type EmpireRecord } from '@pr0hub/core';
import { classOf, sectionPoints } from '@pr0hub/core/tech';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../auth.js';
import { groupContext, type GroupContext } from '../context.js';
import type { DB } from '../db.js';

type Q = Record<string, string | undefined>;

/** Escapes LIKE wildcards of user input (use with ESCAPE '\\'). */
const likeTerm = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

/** Members are shown with their in-game name (falls back to the hub username). */
const DISPLAY = 'COALESCE(gm.ingame_name, u.username)';
const MEMBER = (t: string) => `LEFT JOIN group_members gm ON gm.group_id = ${t}.group_id AND gm.user_id = ${t}.user_id`;

/** Delta windows in seconds. Snapshots up to 15 min "too new" still count (pastes aren't exact). */
const WINDOWS: Record<string, number> = {
  prev: 0,
  '6h': 6 * 3600,
  '12h': 12 * 3600,
  '18h': 18 * 3600,
  '24h': 86400,
  '48h': 2 * 86400,
  '7d': 7 * 86400,
};
const TOLERANCE = 900;
const TYPES = [1, 2, 3, 4, 5] as const;

export function dataRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = (req: FastifyRequest<{ Params: { uni: string } }>) => groupContext(db, req, req.params.uni);

  app.get<{ Params: { uni: string } }>('/api/:uni/context', async (req) => {
    const ctx = ctxOf(req);
    const members = db
      .prepare(
        `SELECT u.id, u.username, COALESCE(m.ingame_name, u.username) AS name, m.role, m.ingame_name
         FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY name COLLATE NOCASE`,
      )
      .all(ctx.groupId);
    // own research + planets (latest empire page) for flight time links
    const empire = db
      .prepare('SELECT data, created_at FROM empire_snapshots WHERE group_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(ctx.groupId, ctx.user.id) as { data: string; created_at: number } | undefined;
    const rec = empire ? withMoonTypes(JSON.parse(empire.data) as EmpireRecord) : null;
    return {
      universe: ctx.universe,
      group: { id: ctx.groupId, name: ctx.groupName, role: ctx.role },
      members,
      me: ctx.user,
      own: rec
        ? { time: empire!.created_at, research: rec.research, planets: rec.planets.map((p) => ({ name: p.name, coords: p.coords, type: p.type })) }
        : null,
    };
  });

  // ------------------------------------------------------------ overview

  app.get<{ Params: { uni: string } }>('/api/:uni/overview', async (req) => {
    const ctx = ctxOf(req);

    const players = new Map<number, any>();
    for (const type of TYPES) {
      const rows = db
        .prepare(
          `SELECT ps.player_id, ps.points, ps.rank, ps.rank_change, s.stat_time
           FROM player_scores ps JOIN stat_snapshots s ON s.id = ps.snapshot_id
           WHERE s.group_id = ? AND s.who = 'player' AND s.type = ?
           ORDER BY ps.player_id, s.stat_time DESC`,
        )
        .all(ctx.groupId, type) as { player_id: number; points: number; rank: number; rank_change: number | null; stat_time: number }[];
      for (const [playerId, history] of groupBy(rows, (r) => r.player_id)) {
        const cur = history[0];
        const deltas: Record<string, { delta: number; since: number; partial: boolean }> = {};
        for (const [win, secs] of Object.entries(WINDOWS)) {
          const back = secs === 0 ? 1 : secs - TOLERANCE;
          let ref = history.find((r) => r.stat_time <= cur.stat_time - back);
          // Not enough history yet: compare with the oldest snapshot, marked as partial.
          const partial = !ref && history.length > 1;
          if (partial) ref = history[history.length - 1];
          if (ref) deltas[win] = { delta: cur.points - ref.points, since: ref.stat_time, partial };
        }
        // FF-Hub style 6 h slots: Δ6h = newest stand − 6 h before, Δ12h = the slot before that, …
        const at = (t: number) => history.find((h) => Math.abs(h.stat_time - t) <= 3600);
        const slots = [1, 2, 3, 4].map((k) => {
          const to = k === 1 ? cur : at(cur.stat_time - (k - 1) * 6 * 3600);
          const from = at(cur.stat_time - k * 6 * 3600);
          return to && from ? { delta: to.points - from.points, from: from.stat_time, to: to.stat_time } : null;
        });
        const entry = players.get(playerId) ?? { scores: {} };
        entry.scores[type] = { points: cur.points, rank: cur.rank, rankChange: cur.rank_change, time: cur.stat_time, deltas, slots };
        players.set(playerId, entry);
      }
    }

    const info = db
      .prepare(
        `SELECT p.id, p.ingame_id, p.name, p.status, p.note, p.last_seen, a.id AS ally_id, a.name AS ally_name, a.tag AS ally_tag,
           (SELECT json_group_array(name) FROM player_aliases x WHERE x.player_id = p.id) AS aliases,
           (SELECT MIN(seen_at) FROM player_status_log l WHERE l.player_id = p.id AND l.status LIKE '%inactive%'
              AND NOT EXISTS (SELECT 1 FROM player_status_log l2 WHERE l2.player_id = p.id AND l2.seen_at > l.seen_at AND l2.status NOT LIKE '%inactive%')) AS inactive_since
         FROM players p LEFT JOIN alliances a ON a.id = p.alliance_id WHERE p.group_id = ?`,
      )
      .all(ctx.groupId) as any[];

    const result = info
      .filter((p) => players.has(p.id))
      .map((p) => ({ ...p, status: JSON.parse(p.status), aliases: JSON.parse(p.aliases), scores: players.get(p.id).scores }));

    return { players: result, planets: planetRows(db, ctx), coverage: coverage(db, ctx) };
  });

  // -------------------------------------------------------------- players

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/players', async (req) => {
    const ctx = ctxOf(req);
    const q = likeTerm((req.query.q ?? '').trim());
    return db
      .prepare(
        `SELECT p.id, p.ingame_id, p.name, a.name AS ally_name FROM players p LEFT JOIN alliances a ON a.id = p.alliance_id
         WHERE p.group_id = ? AND (p.name LIKE ? ESCAPE '\\' OR p.id IN (SELECT player_id FROM player_aliases WHERE name LIKE ? ESCAPE '\\'))
         ORDER BY p.last_seen DESC LIMIT 50`,
      )
      .all(ctx.groupId, q, q);
  });

  app.get<{ Params: { uni: string; id: string } }>('/api/:uni/players/:id', async (req) => {
    const ctx = ctxOf(req);
    const id = Number(req.params.id);
    const player = db
      .prepare(
        `SELECT p.*, a.name AS ally_name, a.tag AS ally_tag, a.ingame_id AS ally_ingame_id
         FROM players p LEFT JOIN alliances a ON a.id = p.alliance_id WHERE p.id = ? AND p.group_id = ?`,
      )
      .get(id, ctx.groupId) as any;
    if (!player) throw new HttpError(404, 'Spieler nicht gefunden');

    const history = db
      .prepare(
        `SELECT s.type, s.stat_time AS time, ps.points, ps.rank FROM player_scores ps JOIN stat_snapshots s ON s.id = ps.snapshot_id
         WHERE ps.player_id = ? ORDER BY s.stat_time`,
      )
      .all(id);
    const planets = db
      .prepare(
        `SELECT pl.g, pl.s, pl.p, pl.name, pl.has_moon, pl.updated_at,
           (SELECT MAX(report_time) FROM spy_reports sr WHERE sr.group_id = pl.group_id AND sr.g = pl.g AND sr.s = pl.s AND sr.p = pl.p
              AND sr.planet_type = 'planet') AS last_spy,
           (SELECT MAX(report_time) FROM spy_reports sr WHERE sr.group_id = pl.group_id AND sr.g = pl.g AND sr.s = pl.s AND sr.p = pl.p
              AND sr.planet_type = 'moon') AS last_spy_moon
         FROM planets pl WHERE pl.player_id = ? ORDER BY pl.g, pl.s, pl.p`,
      )
      .all(id);
    const spyReports = db
      .prepare(
        `SELECT id, g, s, p, planet_type, planet_name, report_time, sections FROM spy_reports
         WHERE group_id = ? AND (player_id = ? OR player_name = ?) ORDER BY report_time DESC LIMIT 30`,
      )
      .all(ctx.groupId, id, player.name)
      .map(parseSections);
    const statusLog = db.prepare('SELECT status, seen_at FROM player_status_log WHERE player_id = ? ORDER BY seen_at DESC LIMIT 50').all(id);
    const aliases = db.prepare('SELECT name, seen_until FROM player_aliases WHERE player_id = ? ORDER BY seen_until DESC').all(id);
    const intel = playerIntel(db, ctx, id, player.name, planets as { g: number; s: number; p: number }[]);

    // own total and fleet points for comparison in the chart
    const ownId = ownPlayerId(db, ctx);
    const ownHistory =
      ownId && ownId !== id
        ? db
            .prepare(
              `SELECT s.type, s.stat_time AS time, ps.points FROM player_scores ps JOIN stat_snapshots s ON s.id = ps.snapshot_id
               WHERE ps.player_id = ? AND s.type IN (1, 2) ORDER BY s.stat_time`,
            )
            .all(ownId)
        : [];
    return {
      player: { ...player, status: JSON.parse(player.status) },
      history, ownHistory, planets, spyReports, statusLog, aliases, ...intel,
    };
  });

  app.put<{ Params: { uni: string; id: string }; Body: { note: string | null } }>('/api/:uni/players/:id/note', async (req) => {
    const ctx = ctxOf(req);
    db.prepare('UPDATE players SET note = ? WHERE id = ? AND group_id = ?').run(req.body?.note || null, Number(req.params.id), ctx.groupId);
    return { ok: true };
  });

  // ------------------------------------------------------------ spy reports

  app.get<{ Params: { uni: string; g: string; s: string; p: string }; Querystring: Q }>('/api/:uni/spy/:g/:s/:p', async (req) => {
    const ctx = ctxOf(req);
    const type = req.query.type === 'moon' ? 'moon' : 'planet';
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 500);
    const reports = db
      .prepare(
        `SELECT sr.id, sr.planet_name, sr.player_name, sr.player_id, sr.report_time, sr.sections, sr.destroy_chance, ${DISPLAY} AS reporter
         FROM spy_reports sr LEFT JOIN users u ON u.id = sr.user_id ${MEMBER('sr')}
         WHERE sr.group_id = ? AND sr.g = ? AND sr.s = ? AND sr.p = ? AND sr.planet_type = ?
         ORDER BY sr.report_time DESC LIMIT ?`,
      )
      .all(ctx.groupId, Number(req.params.g), Number(req.params.s), Number(req.params.p), type, limit)
      .map(parseSections);
    const total = db
      .prepare('SELECT COUNT(*) FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ?')
      .pluck()
      .get(ctx.groupId, Number(req.params.g), Number(req.params.s), Number(req.params.p), type);
    return { reports, total };
  });

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/spy-reports', async (req) => {
    const ctx = ctxOf(req);
    return db
      .prepare(
        `SELECT sr.id, sr.g, sr.s, sr.p, sr.planet_type, sr.planet_name, sr.player_name, sr.player_id, sr.report_time, sr.sections,
           ${DISPLAY} AS reporter
         FROM spy_reports sr LEFT JOIN users u ON u.id = sr.user_id ${MEMBER('sr')} WHERE sr.group_id = ? ORDER BY sr.report_time DESC LIMIT ?`,
      )
      .all(ctx.groupId, Math.min(Number(req.query.limit ?? 100) || 100, 1000))
      .map(parseSections);
  });

  // --------------------------------------------------------------- galaxy

  app.get<{ Params: { uni: string } }>('/api/:uni/galaxy-views', async (req) => {
    const ctx = ctxOf(req);
    return db
      .prepare(
        `SELECT v.g, v.s, v.seen_at, ${DISPLAY} AS username FROM galaxy_views v LEFT JOIN users u ON u.id = v.user_id ${MEMBER('v')} WHERE v.group_id = ?`,
      )
      .all(ctx.groupId);
  });

  // ------------------------------------------------------- universe browser

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
        `SELECT pl.p, pl.name, pl.has_moon, pl.destroyed, pl.debris, pl.updated_at,
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
        const res = (JSON.parse(rep.sections) as Record<string, Record<string, number>>)['900'];
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

  // --------------------------------------------------------- battle hall

  /** Archived battle hall reports, 100 per page; sort by units or date, filter by participant. */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/battle-hall', async (req) => {
    const ctx = ctxOf(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const order = req.query.sort === 'time' ? 'time DESC' : 'units DESC';
    const q = (req.query.q ?? '').trim();
    const where = `group_id = ?${q ? " AND (attackers LIKE ? ESCAPE '\\' OR defenders LIKE ? ESCAPE '\\')" : ''}`;
    const args: unknown[] = [ctx.groupId, ...(q ? [likeTerm(q), likeTerm(q)] : [])];
    const total = db.prepare(`SELECT COUNT(*) FROM battle_hall WHERE ${where}`).pluck().get(...args) as number;
    const rows = db
      .prepare(
        `SELECT h.*, EXISTS (SELECT 1 FROM combat_reports c WHERE c.group_id = h.group_id AND c.report_id = h.report_id) AS archived
         FROM battle_hall h WHERE ${where.replace(/(group_id|attackers|defenders)/g, 'h.$1')} ORDER BY h.${order}, h.id LIMIT 100 OFFSET ?`,
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
    if (!r) throw new HttpError(404, 'Bericht nicht archiviert');
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

  // ------------------------------------------------------------ activity

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
    return {
      counts: Object.fromEntries((counts as { kind: string; n: number }[]).map((c) => [c.kind, c.n])),
      entries: rows.map((r) => ({ ...r, data: JSON.parse(r.data), status: r.status ? JSON.parse(r.status) : [] })),
    };
  });

  // ------------------------------------------------------------- raids

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

    const perUser = new Map<string, any>();
    for (const r of raids.filter((x) => !x.defense)) {
      const e = perUser.get(r.username) ?? { userId: r.user_id, username: r.username, raids: 0, metal: 0, crystal: 0, deuterium: 0, lost: 0, debris: 0 };
      e.raids++;
      e.metal += r.loot_metal;
      e.crystal += r.loot_crystal;
      e.deuterium += r.loot_deuterium;
      e.lost += r.lost_attacker;
      e.debris += r.debris_metal + r.debris_crystal;
      perUser.set(r.username, e);
    }
    const recycling = db
      .prepare(
        `SELECT r.*, ${DISPLAY} AS username FROM recycle_reports r LEFT JOIN users u ON u.id = r.user_id ${MEMBER('r')}
         WHERE r.group_id = ? AND COALESCE(r.time, r.created_at) BETWEEN ? AND ? ORDER BY COALESCE(r.time, r.created_at) DESC`,
      )
      .all(ctx.groupId, from, to) as any[];
    const recyclePerUser = new Map<string, any>();
    for (const r of recycling) {
      const e = recyclePerUser.get(r.username) ?? { userId: r.user_id, username: r.username, runs: 0, metal: 0, crystal: 0, left: 0 };
      e.runs++;
      e.metal += r.metal;
      e.crystal += r.crystal;
      e.left += Math.max(0, r.total_metal - r.metal) + Math.max(0, r.total_crystal - r.crystal);
      recyclePerUser.set(r.username, e);
    }
    return {
      from, to, perUser: [...perUser.values()], reports: raids.slice(0, 500),
      recyclePerUser: [...recyclePerUser.values()], recycling: recycling.slice(0, 500),
    };
  });

  // -------------------------------------------------------- expeditions

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/expeditions', async (req) => {
    const ctx = ctxOf(req);
    const { from, to } = range(req.query);
    const rows = db
      .prepare(
        `SELECT e.*, ${DISPLAY} AS username FROM expeditions e JOIN users u ON u.id = e.user_id ${MEMBER('e')}
         WHERE e.group_id = ? AND COALESCE(e.time, e.created_at) BETWEEN ? AND ? ORDER BY COALESCE(e.time, e.created_at) DESC`,
      )
      .all(ctx.groupId, from, to) as any[];

    const perUser = new Map<string, any>();
    for (const r of rows) {
      const e = perUser.get(r.username) ?? { userId: r.user_id, username: r.username, total: 0, events: {}, resources: {}, ships: {} };
      e.total++;
      const key = r.size === 'None' ? r.event : `${r.event}:${r.size}`;
      e.events[key] = (e.events[key] ?? 0) + 1;
      for (const [id, n] of Object.entries(JSON.parse(r.found_resources) as Record<string, number>)) e.resources[id] = (e.resources[id] ?? 0) + n;
      for (const [id, n] of Object.entries(JSON.parse(r.found_ships) as Record<string, number>)) e.ships[id] = (e.ships[id] ?? 0) + n;
      perUser.set(r.username, e);
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

  // ---------------------------------------------------------------- deck

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/deck', async (req) => {
    const ctx = ctxOf(req);
    const userId = Number(req.query.user ?? ctx.user.id);
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId)) {
      throw new HttpError(404, 'Mitglied nicht gefunden');
    }
    const settings = (db.prepare('SELECT * FROM deck_settings WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId) as any) ?? {
      start_time: null,
      initial_drawn: '{}',
      unknown_depletion: 0,
    };
    const events = db
      .prepare(
        `SELECT event, size, depletion, time FROM expeditions WHERE group_id = ? AND user_id = ? AND (? IS NULL OR COALESCE(time, created_at) >= ?)
         ORDER BY COALESCE(time, created_at), id`,
      )
      .all(ctx.groupId, userId, settings.start_time, settings.start_time) as (DeckEvent & { time: number })[];
    const state = computeDeck(ctx.universe.deck, events, {
      unknownDepletionChance: settings.unknown_depletion,
      initialDrawn: JSON.parse(settings.initial_drawn),
    });
    return {
      userId,
      settings: { startTime: settings.start_time, initialDrawn: JSON.parse(settings.initial_drawn), unknownDepletion: settings.unknown_depletion },
      lastEvents: events.slice(-15).reverse(),
      state,
    };
  });

  app.put<{ Params: { uni: string }; Body: { startTime?: number | null; initialDrawn?: Record<string, number>; unknownDepletion?: number } }>(
    '/api/:uni/deck',
    async (req) => {
      const ctx = ctxOf(req);
      const b = req.body ?? {};
      db.prepare(
        `INSERT INTO deck_settings (group_id, user_id, start_time, initial_drawn, unknown_depletion) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (group_id, user_id) DO UPDATE SET start_time = excluded.start_time, initial_drawn = excluded.initial_drawn,
           unknown_depletion = excluded.unknown_depletion`,
      ).run(
        ctx.groupId,
        ctx.user.id,
        b.startTime ?? null,
        JSON.stringify(b.initialDrawn ?? {}),
        Math.min(Math.max(Number(b.unknownDepletion ?? 0), 0), 1),
      );
      return { ok: true };
    },
  );

  // ------------------------------------------------------------ imperium

  /** Latest own empire + game overview page of a member, for the live view. */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/imperium', async (req) => {
    const ctx = ctxOf(req);
    const userId = Number(req.query.user ?? ctx.user.id);
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId)) {
      throw new HttpError(404, 'Mitglied nicht gefunden');
    }
    const empire = db
      .prepare('SELECT created_at AS time, data FROM empire_snapshots WHERE group_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(ctx.groupId, userId) as { time: number; data: string } | undefined;
    const overview = db
      .prepare('SELECT page_time AS time, data FROM overview_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC LIMIT 1')
      .get(ctx.groupId, userId) as { time: number; data: string } | undefined;
    return {
      userId,
      empire: empire ? { time: empire.time, data: withMoonTypes(JSON.parse(empire.data) as EmpireRecord) } : null,
      overview: overview ? { time: overview.time, data: JSON.parse(overview.data) } : null,
    };
  });

  // ------------------------------------------------------------ alliance

  app.get<{ Params: { uni: string } }>('/api/:uni/alliance', async (req) => {
    const ctx = ctxOf(req);
    const rows = db
      .prepare(
        `SELECT u.id AS user_id, u.username, m.ingame_name, e.created_at, e.data
         FROM group_members m JOIN users u ON u.id = m.user_id
         LEFT JOIN empire_snapshots e ON e.id = (SELECT id FROM empire_snapshots x WHERE x.group_id = m.group_id AND x.user_id = m.user_id ORDER BY created_at DESC, id DESC LIMIT 1)
         WHERE m.group_id = ? ORDER BY u.username`,
      )
      .all(ctx.groupId) as any[];
    return rows.map((r) => ({ ...r, data: r.data ? withMoonTypes(JSON.parse(r.data) as EmpireRecord) : null }));
  });

  // ------------------------------------------------------ hostile spying

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/hostile', async (req) => {
    const ctx = ctxOf(req);
    const { from, to } = range(req.query);
    const list = db
      .prepare(
        `SELECT h.*, ${DISPLAY} AS username FROM hostile_spying h LEFT JOIN users u ON u.id = h.user_id ${MEMBER('h')}
         WHERE h.group_id = ? AND COALESCE(h.time, 0) BETWEEN ? AND ? ORDER BY h.time DESC LIMIT 1000`,
      )
      .all(ctx.groupId, from, to);
    const bySpy = db
      .prepare(
        `SELECT from_player, COUNT(*) AS count, MAX(time) AS last, COUNT(DISTINCT user_id) AS victims
         FROM hostile_spying WHERE group_id = ? AND COALESCE(time, 0) BETWEEN ? AND ? GROUP BY from_player ORDER BY count DESC`,
      )
      .all(ctx.groupId, from, to);
    return { from, to, list, bySpy };
  });
}

function parseSections(r: any) {
  return { ...r, sections: JSON.parse(r.sections) };
}

function range(q: Q) {
  const to = Number(q.to) || Math.floor(Date.now() / 1000) + 86400;
  const from = Number(q.from) || to - 86400 * 8;
  return { from, to };
}

/** Own planet coordinates per user from their latest empire snapshot (to tell raids from defenses). */
function ownCoords(db: DB, ctx: GroupContext): Map<number, Set<string>> {
  const rows = db
    .prepare(
      `SELECT e.user_id, e.data FROM empire_snapshots e WHERE e.group_id = ? AND e.id = (
         SELECT id FROM empire_snapshots x WHERE x.group_id = e.group_id AND x.user_id = e.user_id ORDER BY created_at DESC, id DESC LIMIT 1)`,
    )
    .all(ctx.groupId) as { user_id: number; data: string }[];
  return new Map(
    rows.map((r) => [r.user_id, new Set((JSON.parse(r.data) as EmpireRecord).planets.map((p) => `${p.coords.g}:${p.coords.s}:${p.coords.p}`))]),
  );
}

/** Latest snapshots per type with covered rank range, so the UI can show which pages are missing. */
function coverage(db: DB, ctx: GroupContext) {
  return db
    .prepare(
      `SELECT s.type, s.stat_time, COUNT(ps.player_id) AS rows, MIN(ps.rank) AS min_rank, MAX(ps.rank) AS max_rank
       FROM stat_snapshots s JOIN player_scores ps ON ps.snapshot_id = s.id
       WHERE s.group_id = ? AND s.who = 'player' AND s.stat_time >= (SELECT MAX(stat_time) FROM stat_snapshots WHERE group_id = ?) - 86400 * 2
       GROUP BY s.id ORDER BY s.stat_time DESC, s.type`,
    )
    .all(ctx.groupId, ctx.groupId);
}

function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/**
 * One row per known planet/moon (galaxy view or spy report) with the latest spy values.
 * Each section comes from the newest report that contains it, as low-level reports only show resources.
 */
function planetRows(db: DB, ctx: GroupContext) {
  const rows = new Map<string, any>();
  const key = (g: number, s: number, p: number, type: string) => `${g}:${s}:${p}:${type}`;
  const add = (g: number, s: number, p: number, type: string, name: string | null, playerId: number | null) => {
    const k = key(g, s, p, type);
    if (!rows.has(k)) rows.set(k, { g, s, p, type, name, player_id: playerId, spy: null, own: null, last_battle: null });
    return rows.get(k);
  };

  const planets = db
    .prepare('SELECT g, s, p, name, player_id, has_moon FROM planets WHERE group_id = ? AND destroyed = 0 AND player_id IS NOT NULL')
    .all(ctx.groupId) as any[];
  for (const pl of planets) {
    add(pl.g, pl.s, pl.p, 'planet', pl.name, pl.player_id);
    if (pl.has_moon) add(pl.g, pl.s, pl.p, 'moon', null, pl.player_id);
  }

  const reports = db
    .prepare(
      `SELECT g, s, p, planet_type, planet_name, player_id, report_time, sections FROM spy_reports
       WHERE group_id = ? AND p <= ? ORDER BY g, s, p, planet_type, report_time DESC`,
    )
    .all(ctx.groupId, ctx.universe.settings.positions) as any[];
  for (const [, list] of groupBy(reports, (r) => key(r.g, r.s, r.p, r.planet_type))) {
    const latest = list[0];
    const row = add(latest.g, latest.s, latest.p, latest.planet_type, latest.planet_name, latest.player_id);
    if (!row.player_id) row.player_id = latest.player_id;
    if (latest.planet_type === 'moon' && latest.planet_name) row.name = latest.planet_name;
    const spy: any = { time: latest.report_time, count: list.length };
    for (const [cls, field] of [['900', 'res'], ['0', 'building'], ['200', 'fleet'], ['400', 'defense']] as const) {
      const r = list.find((x) => x.sections.includes(`"${cls}":`));
      if (!r) continue;
      const values = JSON.parse(r.sections)[cls];
      spy[field] = cls === '900' ? values : sectionPoints(values);
      spy[field + 'Time'] = r.report_time;
    }
    row.spy = spy;
  }

  // Own alliance: points per planet from the members' latest empire pages (like FF-Hub).
  const empires = db
    .prepare(
      `SELECT e.created_at, e.data, m.ingame_name, u.username FROM empire_snapshots e
       JOIN group_members m ON m.group_id = e.group_id AND m.user_id = e.user_id JOIN users u ON u.id = e.user_id
       WHERE e.group_id = ? AND e.id = (SELECT id FROM empire_snapshots x WHERE x.group_id = e.group_id AND x.user_id = e.user_id
         ORDER BY created_at DESC, id DESC LIMIT 1)`,
    )
    .all(ctx.groupId) as { created_at: number; data: string; ingame_name: string | null; username: string }[];
  for (const e of empires) {
    const rec = withMoonTypes(JSON.parse(e.data) as EmpireRecord);
    const playerId = empirePlayer(db, ctx, rec, [e.ingame_name, e.username]);
    for (const pl of rec.planets) {
      const row = add(pl.coords.g, pl.coords.s, pl.coords.p, pl.type, pl.name, playerId);
      row.player_id ??= playerId;
      if (!row.name) row.name = pl.name;
      const part = (cls: number) => Object.fromEntries(Object.entries(pl.values).filter(([id]) => classOf(Number(id)) === cls));
      row.own = { time: e.created_at, building: sectionPoints(part(0)), fleet: sectionPoints(part(200)), defense: sectionPoints(part(400)) };
    }
  }

  const battles = db
    .prepare(
      `SELECT g, s, p, planet_type, MAX(COALESCE(time, created_at)) AS last FROM battle_reports WHERE group_id = ? GROUP BY g, s, p, planet_type`,
    )
    .all(ctx.groupId) as any[];
  for (const b of battles) {
    const row = rows.get(key(b.g, b.s, b.p, b.planet_type));
    if (row) row.last_battle = b.last;
  }
  return [...rows.values()].filter((r) => r.player_id != null);
}

/**
 * Snapshots stored before moon detection have no planet type: a moon shares the
 * coordinates of the planet listed before it and is the one with a moon base (41).
 */
function withMoonTypes(rec: EmpireRecord): EmpireRecord {
  const seen = new Set<string>();
  for (const p of rec.planets) {
    const key = `${p.coords.g}:${p.coords.s}:${p.coords.p}`;
    if (!p.type) p.type = seen.has(key) || (p.values[41] ?? 0) > 0 ? 'moon' : 'planet';
    seen.add(key);
  }
  return rec;
}

/** Hub player of an alliance member: owner of one of their planets (galaxy), otherwise by in-game name / username. */
function empirePlayer(db: DB, ctx: GroupContext, rec: EmpireRecord, names: (string | null)[]): number | null {
  for (const p of rec.planets) {
    const id = db
      .prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND player_id IS NOT NULL')
      .pluck()
      .get(ctx.groupId, p.coords.g, p.coords.s, p.coords.p) as number | undefined;
    if (id) return id;
  }
  for (const name of names) {
    if (!name) continue;
    const id = db.prepare('SELECT id FROM players WHERE group_id = ? AND name = ? COLLATE NOCASE').pluck().get(ctx.groupId, name) as number | undefined;
    if (id) return id;
  }
  return null;
}

/** Phalanx range in systems (ShowPhalanxPage::GetPhalanxRange). */
function phalanxRange(level: number, factor: number) {
  return level <= 1 ? 0 : Math.floor((level * level - 1) * factor);
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
    const buildings = (JSON.parse(r.sections) as Record<string, Record<string, number>>)['0'];
    // only reports that show the buildings tell the phalanx level
    if (!buildings) continue;
    moons.set(key, { s: r.s, p: r.p, level: buildings['42'] ?? 0, time: r.report_time, source: 'spy', playerId: r.player_id, playerName: r.player_name });
  }

  const empires = db
    .prepare(
      `SELECT e.created_at, e.data FROM empire_snapshots e WHERE e.group_id = ? AND e.id = (
         SELECT id FROM empire_snapshots x WHERE x.group_id = e.group_id AND x.user_id = e.user_id ORDER BY created_at DESC, id DESC LIMIT 1)`,
    )
    .all(ctx.groupId) as { created_at: number; data: string }[];
  for (const e of empires) {
    for (const pl of withMoonTypes(JSON.parse(e.data) as EmpireRecord).planets) {
      if (pl.type !== 'moon' || pl.coords.g !== g) continue;
      const key = `${pl.coords.s}:${pl.coords.p}`;
      const cur = moons.get(key);
      if (cur && cur.time > e.created_at) continue;
      moons.set(key, { s: pl.coords.s, p: pl.coords.p, level: pl.values[42] ?? 0, time: e.created_at, source: 'empire', playerId: cur?.playerId ?? null, playerName: cur?.playerName ?? null });
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

/** Hub player of the current user: owner of their empire planets, otherwise by in-game name. */
function ownPlayerId(db: DB, ctx: GroupContext): number | null {
  const coords = ownCoords(db, ctx).get(ctx.user.id);
  for (const c of coords ?? []) {
    const [g, s, p] = c.split(':').map(Number);
    const id = db.prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND player_id IS NOT NULL').pluck().get(ctx.groupId, g, s, p) as
      | number
      | undefined;
    if (id) return id;
  }
  const name = db.prepare('SELECT ingame_name FROM group_members WHERE group_id = ? AND user_id = ?').pluck().get(ctx.groupId, ctx.user.id) as string | null;
  if (!name) return null;
  return (db.prepare('SELECT id FROM players WHERE group_id = ? AND name = ? COLLATE NOCASE').pluck().get(ctx.groupId, name) as number | undefined) ?? null;
}

/**
 * What is known about a player beyond the stats: research levels and phalanx levels of the moons,
 * from the newest spy reports showing them or the empire page when the player is an alliance member.
 */
function playerIntel(db: DB, ctx: GroupContext, playerId: number, name: string, planets: { g: number; s: number; p: number }[]) {
  type Known<T> = { values: T; time: number; source: 'spy' | 'empire' } | null;
  let research: Known<Record<string, number>> = null;
  const phalanx: Record<string, { level: number; time: number; source: 'spy' | 'empire' }> = {};

  const reports = db
    .prepare(
      `SELECT g, s, p, planet_type, report_time, sections FROM spy_reports
       WHERE group_id = ? AND (player_id = ? OR player_name = ?) ORDER BY report_time DESC`,
    )
    .all(ctx.groupId, playerId, name) as { g: number; s: number; p: number; planet_type: string; report_time: number; sections: string }[];
  for (const r of reports) {
    const sections = JSON.parse(r.sections) as Record<string, Record<string, number>>;
    if (!research && sections['100']) research = { values: sections['100'], time: r.report_time, source: 'spy' };
    const key = `${r.g}:${r.s}:${r.p}`;
    if (r.planet_type === 'moon' && sections['0'] && !phalanx[key]) {
      phalanx[key] = { level: sections['0']['42'] ?? 0, time: r.report_time, source: 'spy' };
    }
  }

  // alliance member: their own empire page knows it exactly
  const coords = new Set(planets.map((p) => `${p.g}:${p.s}:${p.p}`));
  for (const [userId, set] of ownCoords(db, ctx)) {
    if (![...set].some((c) => coords.has(c))) continue;
    const e = db
      .prepare('SELECT created_at, data FROM empire_snapshots WHERE group_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(ctx.groupId, userId) as { created_at: number; data: string };
    const rec = withMoonTypes(JSON.parse(e.data) as EmpireRecord);
    if (!research || research.time <= e.created_at) research = { values: rec.research, time: e.created_at, source: 'empire' };
    for (const pl of rec.planets) {
      const key = `${pl.coords.g}:${pl.coords.s}:${pl.coords.p}`;
      if (pl.type === 'moon' && (!phalanx[key] || phalanx[key].time <= e.created_at)) {
        phalanx[key] = { level: pl.values[42] ?? 0, time: e.created_at, source: 'empire' };
      }
    }
  }
  return { research, phalanx };
}
