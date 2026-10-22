import { CLASS_BUILDINGS, CLASS_RESEARCH, PHALANX } from '@pr0hub/core/tech';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { latestEmpires, ownCoords } from '../repo/empire.js';
import { clampInt, contextOf, likeTerm, parseSections, type Q } from './util.js';

export function playersRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /**
   * Latest synced statistics page like in the game (one category = who + type at its newest stat time),
   * enriched like the FF-Hub: points of all categories, known planets, change since the previous
   * synced stand and the viewer's own values as reference. Several pastes of the same stat time
   * (rank ranges 1-100, 101-200 …) add up to one snapshot.
   */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/stats', async (req) => {
    const ctx = ctxOf(req);
    const who = req.query.who === 'alliance' ? 'alliance' : 'player';
    const type = [1, 2, 3, 4, 5, 6].includes(Number(req.query.type)) ? Number(req.query.type) : 1;
    const scoreTable = (w: string) => (w === 'player' ? 'player_scores' : 'alliance_scores');

    // per category: newest stand and which pages of 100 ranks it contains (sync overview)
    const categories = (
      db
        .prepare('SELECT id, who, type, MAX(stat_time) AS stat_time FROM stat_snapshots WHERE group_id = ? GROUP BY who, type')
        .all(ctx.groupId) as { id: number; who: string; type: number; stat_time: number }[]
    ).map((c) => ({
      who: c.who,
      type: c.type,
      stat_time: c.stat_time,
      pages: db.prepare(`SELECT DISTINCT (rank - 1) / 100 FROM ${scoreTable(c.who)} WHERE snapshot_id = ? ORDER BY 1`).pluck().all(c.id) as number[],
    }));

    const snaps = db
      .prepare('SELECT id, stat_time FROM stat_snapshots WHERE group_id = ? AND who = ? AND type = ? ORDER BY stat_time DESC LIMIT 2')
      .all(ctx.groupId, who, type) as { id: number; stat_time: number }[];
    const [snap, prevSnap] = snaps;

    // the viewer's own player (in-game name of the membership) and its alliance
    const me = db
      .prepare(
        `SELECT p.id, p.alliance_id FROM group_members gm JOIN players p ON p.group_id = gm.group_id AND p.name = gm.ingame_name COLLATE NOCASE
         WHERE gm.group_id = ? AND gm.user_id = ?`,
      )
      .get(ctx.groupId, ctx.user.id) as { id: number; alliance_id: number | null } | undefined;
    /** newest points per category (1-5) of the given players */
    const latestPoints = (ids: number[]) => {
      const out = new Map<number, Record<number, number>>();
      if (!ids.length) return out;
      const rows = db
        .prepare(
          `SELECT ps.player_id, st.type, ps.points, MAX(st.stat_time) AS t FROM player_scores ps JOIN stat_snapshots st ON st.id = ps.snapshot_id
           WHERE st.group_id = ? AND st.who = 'player' AND st.type BETWEEN 1 AND 5 AND ps.player_id IN (${ids.map(() => '?').join(',')})
           GROUP BY ps.player_id, st.type`,
        )
        .all(ctx.groupId, ...ids) as { player_id: number; type: number; points: number }[];
      for (const r of rows) out.set(r.player_id, { ...out.get(r.player_id), [r.type]: r.points });
      return out;
    };
    const mine = me ? (latestPoints([me.id]).get(me.id) ?? {}) : {};
    const base = { who, type, categories, me: me ? { id: me.id, allyId: me.alliance_id, points: mine } : null };
    if (!snap) return { ...base, statTime: null, prevTime: null, rows: [] };

    if (who === 'alliance') {
      const prev = new Map(
        prevSnap
          ? (db.prepare('SELECT alliance_id, rank, points FROM alliance_scores WHERE snapshot_id = ?').all(prevSnap.id) as any[]).map((r) => [r.alliance_id, r])
          : [],
      );
      const rows = (
        db
          .prepare(
            `SELECT s.rank, s.rank_change, s.points, s.members, a.id, a.name, a.tag
             FROM alliance_scores s JOIN alliances a ON a.id = s.alliance_id WHERE s.snapshot_id = ? ORDER BY s.rank`,
          )
          .all(snap.id) as any[]
      ).map((r) => ({
        ...r,
        own: me?.alliance_id === r.id,
        prev_rank: prev.get(r.id)?.rank ?? null,
        delta: prev.has(r.id) ? r.points - prev.get(r.id).points : null,
      }));
      return { ...base, statTime: snap.stat_time, prevTime: prevSnap?.stat_time ?? null, rows };
    }

    const rows = db
      .prepare(
        `SELECT ps.rank, ps.rank_change, ps.points, ps.title, p.id, p.name, p.status, a.id AS ally_id, a.name AS ally_name, a.tag AS ally_tag,
           EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = p.group_id AND gm.ingame_name = p.name COLLATE NOCASE) AS member,
           (SELECT COUNT(*) FROM planets pl WHERE pl.player_id = p.id AND pl.destroyed = 0) AS planet_count,
           (SELECT pl.g || ':' || pl.s || ':' || pl.p FROM planets pl WHERE pl.player_id = p.id AND pl.destroyed = 0 ORDER BY pl.id LIMIT 1) AS first_planet
         FROM player_scores ps JOIN players p ON p.id = ps.player_id LEFT JOIN alliances a ON a.id = p.alliance_id
         WHERE ps.snapshot_id = ? ORDER BY ps.rank`,
      )
      .all(snap.id) as any[];
    const prev = new Map(
      prevSnap
        ? (db.prepare('SELECT player_id, rank, points FROM player_scores WHERE snapshot_id = ?').all(prevSnap.id) as any[]).map((r) => [r.player_id, r])
        : [],
    );
    const points = latestPoints(rows.map((r) => r.id));
    return {
      ...base,
      statTime: snap.stat_time,
      prevTime: prevSnap?.stat_time ?? null,
      rows: rows.map((r) => ({
        ...r,
        status: JSON.parse(r.status || '[]'),
        own: r.id === me?.id,
        ownAlly: !!me?.alliance_id && r.ally_id === me.alliance_id,
        prev_rank: prev.get(r.id)?.rank ?? null,
        delta: prev.has(r.id) ? r.points - prev.get(r.id).points : null,
        scores: points.get(r.id) ?? {},
      })),
    };
  });

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
    if (!player) throw new HttpError(404, 'player_not_found', 'Player not found');

    const history = db
      .prepare(
        `SELECT s.type, s.stat_time AS time, ps.points, ps.rank FROM player_scores ps JOIN stat_snapshots s ON s.id = ps.snapshot_id
         WHERE ps.player_id = ? ORDER BY s.stat_time`,
      )
      .all(id);
    const planets = db
      .prepare(
        `SELECT pl.g, pl.s, pl.p, pl.name, pl.has_moon, pl.moon_name, pl.updated_at,
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
         -- by id (players belong to one group) or by the name in the report
         WHERE id IN (SELECT id FROM spy_reports WHERE player_id = ? UNION SELECT id FROM spy_reports WHERE group_id = ? AND player_name = ? COLLATE NOCASE) ORDER BY report_time DESC LIMIT 30`,
      )
      .all(id, ctx.groupId, player.name)
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
    const note = req.body?.note ?? null;
    if (note !== null && (typeof note !== 'string' || note.length > NOTE_MAX)) throw new HttpError(400, 'note_invalid', 'Invalid note');
    db.prepare('UPDATE players SET note = ? WHERE id = ? AND group_id = ?').run(note || null, Number(req.params.id), ctx.groupId);
    return { ok: true };
  });
}

/** Longest player note in characters. */
const NOTE_MAX = 5000;

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
       -- by id (players belong to one group) or by the name in the report
       WHERE id IN (SELECT id FROM spy_reports WHERE player_id = ? UNION SELECT id FROM spy_reports WHERE group_id = ? AND player_name = ? COLLATE NOCASE) ORDER BY report_time DESC`,
    )
    .all(playerId, ctx.groupId, name) as { g: number; s: number; p: number; planet_type: string; report_time: number; sections: string }[];
  for (const r of reports) {
    const sections = JSON.parse(r.sections) as Record<string, Record<string, number>>;
    if (!research && sections[CLASS_RESEARCH]) research = { values: sections[CLASS_RESEARCH], time: r.report_time, source: 'spy' };
    const key = `${r.g}:${r.s}:${r.p}`;
    if (r.planet_type === 'moon' && sections[CLASS_BUILDINGS] && !phalanx[key]) {
      phalanx[key] = { level: sections[CLASS_BUILDINGS][PHALANX] ?? 0, time: r.report_time, source: 'spy' };
    }
  }

  // alliance member: their own empire page knows it exactly
  const coords = new Set(planets.map((p) => `${p.g}:${p.s}:${p.p}`));
  for (const { time, rec } of latestEmpires(db, ctx)) {
    if (!rec.planets.some((p) => coords.has(`${p.coords.g}:${p.coords.s}:${p.coords.p}`))) continue;
    if (!research || research.time <= time) research = { values: rec.research, time, source: 'empire' };
    for (const pl of rec.planets) {
      const key = `${pl.coords.g}:${pl.coords.s}:${pl.coords.p}`;
      if (pl.type === 'moon' && (!phalanx[key] || phalanx[key].time <= time)) {
        phalanx[key] = { level: pl.values[PHALANX] ?? 0, time, source: 'empire' };
      }
    }
  }
  return { research, phalanx };
}
