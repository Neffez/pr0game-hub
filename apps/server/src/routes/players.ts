import { CLASS_BUILDINGS, CLASS_RESEARCH, PHALANX } from '@pr0hub/core/tech';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { events } from '../events.js';
import { ACTIVITY_DAYS, activityScores, addActivity, playerActivity } from '../repo/activity.js';
import { latestEmpires } from '../repo/empire.js';
import { memberPlayer, memberPlayers } from '../repo/members.js';
import { latestScores } from '../repo/stats.js';
import { contextOf, likeTerm, parseSections, type Q } from './util.js';

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

    // the viewer's own player and its alliance; players of all members are marked
    const members = memberPlayers(db, ctx);
    const meId = members.get(ctx.user.id) ?? null;
    const me = meId
      ? { id: meId, alliance_id: db.prepare('SELECT alliance_id FROM players WHERE id = ?').pluck().get(meId) as number | null }
      : undefined;
    const memberIds = new Set([...members.values()].filter((id) => id != null));
    /** newest points per category (1-5) of the given players */
    const latestPoints = (ids: number[]) =>
      new Map(
        [...latestScores(db, ctx.groupId, ids)].map(([id, scores]) => [id, Object.fromEntries(Object.entries(scores).map(([t, s]) => [t, s.points]))]),
      );
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
        member: memberIds.has(r.id) ? 1 : 0,
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
    const ownId = memberPlayer(db, ctx, ctx.user.id);
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

  /** The player of the request's group (404 otherwise). */
  const groupPlayer = (ctx: GroupContext, id: string) => {
    const player = db.prepare('SELECT id FROM players WHERE id = ? AND group_id = ?').pluck().get(Number(id), ctx.groupId) as number | undefined;
    if (!player) throw new HttpError(404, 'player_not_found', 'Player not found');
    return player;
  };

  /** Evidence of when the player was online during the last days, for the activity pattern. */
  app.get<{ Params: { uni: string; id: string } }>('/api/:uni/players/:id/activity', async (req) => {
    const ctx = ctxOf(req);
    const id = groupPlayer(ctx, req.params.id);
    const from = now() - ACTIVITY_DAYS * 86400;
    return { from, events: playerActivity(db, ctx, id, from), scores: activityScores(db, id, from) };
  });

  /** A member reports that the player is (or was at `time`) online. */
  app.post<{ Params: { uni: string; id: string }; Body: { time?: number | null } }>('/api/:uni/players/:id/activity', async (req) => {
    const ctx = ctxOf(req);
    const id = groupPlayer(ctx, req.params.id);
    const t = now();
    const time = req.body?.time ?? t;
    if (!Number.isInteger(time) || time > t + 60 || time < t - ACTIVITY_DAYS * 86400) {
      throw new HttpError(400, 'activity_time_invalid', 'The time must lie within the last days and not in the future');
    }
    // the same report twice (a double click) counts once
    addActivity(db, ctx.groupId, { playerId: id, time, spread: 0, source: 'manual', userId: ctx.user.id, key: `manual:${ctx.user.id}:${id}:${Math.floor(time / 60)}` });
    events.publish(ctx.groupId, { type: 'data', tables: ['player_activity'], userId: ctx.user.id });
    return { ok: true };
  });

  /** Withdraws one of the member's own manual reports. */
  app.delete<{ Params: { uni: string; id: string; eventId: string } }>('/api/:uni/players/:id/activity/:eventId', async (req) => {
    const ctx = ctxOf(req);
    const id = groupPlayer(ctx, req.params.id);
    const res = db
      .prepare("DELETE FROM player_activity WHERE id = ? AND player_id = ? AND group_id = ? AND source = 'manual' AND user_id = ?")
      .run(Number(req.params.eventId), id, ctx.groupId, ctx.user.id);
    if (!res.changes) throw new HttpError(404, 'activity_not_found', 'Report not found');
    events.publish(ctx.groupId, { type: 'data', tables: ['player_activity'], userId: ctx.user.id });
    return { ok: true };
  });

  app.put<{ Params: { uni: string; id: string }; Body: { note: string | null } }>('/api/:uni/players/:id/note', async (req) => {
    const ctx = ctxOf(req);
    const note = req.body?.note ?? null;
    if (note !== null && (typeof note !== 'string' || note.length > NOTE_MAX)) throw new HttpError(400, 'note_invalid', 'Invalid note');
    const res = db.prepare('UPDATE players SET note = ? WHERE id = ? AND group_id = ?').run(note || null, Number(req.params.id), ctx.groupId);
    if (res.changes) events.publish(ctx.groupId, { type: 'data', tables: ['players'], userId: ctx.user.id });
    return { ok: true };
  });
}

/** Longest player note in characters. */
const NOTE_MAX = 5000;

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
