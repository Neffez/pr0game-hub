import type { EmpireRecord } from '@pr0hub/core';
import { CLASS_BUILDINGS, CLASS_DEFENSE, CLASS_FLEET, CLASS_RESOURCES, classOf, sectionPoints } from '@pr0hub/core/tech';
import type { FastifyInstance } from 'fastify';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { SLOT, SLOT_TOLERANCE, SLOTS, statSlots, TOLERANCE, TYPES, WINDOWS } from '../domain/stats.js';
import { latestEmpires, withMoonTypes } from '../repo/empire.js';
import { contextOf, groupBy } from './util.js';

export function overviewRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

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

  app.get<{ Params: { uni: string } }>('/api/:uni/overview', async (req) => {
    const ctx = ctxOf(req);

    const players = new Map<number, any>();
    /** Δ column sections per type (synced updates on the 6 h grid) */
    const sections: Record<number, ReturnType<typeof statSlots>> = {};
    for (const type of TYPES) {
      const newest = db
        .prepare("SELECT MAX(stat_time) FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = ?")
        .pluck()
        .get(ctx.groupId, type) as number | null;
      if (newest == null) {
        sections[type] = statSlots([]);
        continue;
      }
      sections[type] = statSlots(
        db
          .prepare("SELECT stat_time FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = ? AND stat_time >= ?")
          .pluck()
          .all(ctx.groupId, type, newest - ((SLOTS + 1) * SLOT - SLOT_TOLERANCE)) as number[],
      );
      // Only the history the widest Δ window needs, plus each player's newest score before it: that is the
      // reference when nothing newer is old enough, and the current score of players missing from recent updates.
      const since = newest - WINDOWS['7d'] - TOLERANCE;
      const rows = db
        .prepare(
          `SELECT ps.player_id, ps.points, ps.rank, ps.rank_change, s.stat_time
           FROM player_scores ps JOIN stat_snapshots s ON s.id = ps.snapshot_id
           WHERE s.group_id = ? AND s.who = 'player' AND s.type = ? AND s.stat_time >= ?
           UNION ALL
           SELECT player_id, points, rank, rank_change, stat_time FROM (
             -- SQLite takes the bare columns from the row with the MAX()
             SELECT ps.player_id, ps.points, ps.rank, ps.rank_change, MAX(s.stat_time) AS stat_time
             FROM player_scores ps JOIN stat_snapshots s ON s.id = ps.snapshot_id
             WHERE s.group_id = ? AND s.who = 'player' AND s.type = ? AND s.stat_time < ? GROUP BY ps.player_id)
           ORDER BY player_id, stat_time DESC`,
        )
        .all(ctx.groupId, type, since, ctx.groupId, type, since) as {
        player_id: number; points: number; rank: number; rank_change: number | null; stat_time: number;
      }[];
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
        // FF-Hub style 6 h sections, the same for every player (see statSlots)
        const at = (t: number) => history.find((h) => h.stat_time === t);
        const slots = sections[type].map((sec) => {
          const to = sec && at(sec.to);
          const from = sec && at(sec.from);
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
           -- first inactive entry since the last active one
           (SELECT MIN(seen_at) FROM player_status_log l WHERE l.player_id = p.id AND l.status LIKE '%inactive%'
              AND l.seen_at >= COALESCE((SELECT MAX(seen_at) FROM player_status_log l2 WHERE l2.player_id = p.id AND l2.status NOT LIKE '%inactive%'), 0)
           ) AS inactive_since
         FROM players p LEFT JOIN alliances a ON a.id = p.alliance_id WHERE p.group_id = ?`,
      )
      .all(ctx.groupId) as any[];

    // every known player (also from galaxy views and spy reports), with the latest synced points they have, if any
    const result = info.map((p) => ({ ...p, status: JSON.parse(p.status), aliases: JSON.parse(p.aliases), scores: players.get(p.id)?.scores ?? {} }));

    return { players: result, planets: planetRows(db, ctx), coverage: coverage(db, ctx), slots: sections[1] };
  });
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
    .prepare('SELECT g, s, p, name, player_id, has_moon, moon_name FROM planets WHERE group_id = ? AND destroyed = 0 AND player_id IS NOT NULL')
    .all(ctx.groupId) as any[];
  for (const pl of planets) {
    add(pl.g, pl.s, pl.p, 'planet', pl.name, pl.player_id);
    if (pl.has_moon) add(pl.g, pl.s, pl.p, 'moon', pl.moon_name, pl.player_id);
  }

  // Newest spy report per position, and per section the newest report that has it (SQLite takes the bare
  // columns from the row with the MAX()).
  const latest = db
    .prepare(
      `SELECT g, s, p, planet_type, planet_name, player_id, MAX(report_time) AS report_time, COUNT(*) AS count FROM spy_reports
       WHERE group_id = ? AND p <= ? GROUP BY g, s, p, planet_type`,
    )
    .all(ctx.groupId, ctx.universe.settings.positions) as any[];
  for (const r of latest) {
    const row = add(r.g, r.s, r.p, r.planet_type, r.planet_name, r.player_id);
    if (!row.player_id) row.player_id = r.player_id;
    if (r.planet_type === 'moon' && r.planet_name) row.name = r.planet_name;
    row.spy = { time: r.report_time, count: r.count };
  }
  for (const [cls, field] of [[CLASS_RESOURCES, 'res'], [CLASS_BUILDINGS, 'building'], [CLASS_FLEET, 'fleet'], [CLASS_DEFENSE, 'defense']] as const) {
    const path = `$."${cls}"`;
    const sections = db
      .prepare(
        `SELECT g, s, p, planet_type, json_extract(sections, ?) AS v, MAX(report_time) AS report_time FROM spy_reports
         WHERE group_id = ? AND p <= ? AND json_extract(sections, ?) IS NOT NULL GROUP BY g, s, p, planet_type`,
      )
      .all(path, ctx.groupId, ctx.universe.settings.positions, path) as any[];
    for (const r of sections) {
      const spy = rows.get(key(r.g, r.s, r.p, r.planet_type)).spy;
      const values = JSON.parse(r.v);
      spy[field] = cls === CLASS_RESOURCES ? values : sectionPoints(values);
      spy[field + 'Time'] = r.report_time;
    }
  }

  // Own alliance: points per planet from the members' latest empire pages (like FF-Hub).
  const members = new Map(
    (db
      .prepare('SELECT m.user_id, m.ingame_name, u.username FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
      .all(ctx.groupId) as { user_id: number; ingame_name: string | null; username: string }[]).map((m) => [m.user_id, m]),
  );
  for (const { userId, time, rec } of latestEmpires(db, ctx)) {
    const m = members.get(userId);
    // former members' pages stay, but they're no longer the own alliance
    if (!m) continue;
    const playerId = empirePlayer(db, ctx, rec, [m.ingame_name, m.username]);
    for (const pl of rec.planets) {
      const row = add(pl.coords.g, pl.coords.s, pl.coords.p, pl.type, pl.name, playerId);
      row.player_id ??= playerId;
      if (!row.name) row.name = pl.name;
      const part = (cls: number) => Object.fromEntries(Object.entries(pl.values).filter(([id]) => classOf(Number(id)) === cls));
      row.own = { time, building: sectionPoints(part(0)), fleet: sectionPoints(part(200)), defense: sectionPoints(part(400)) };
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
