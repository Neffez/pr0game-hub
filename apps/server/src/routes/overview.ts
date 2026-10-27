import { CLASS_BUILDINGS, CLASS_DEFENSE, CLASS_FLEET, CLASS_RESOURCES, classOf, sectionPoints } from '@pr0hub/core/tech';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { scoreEntry, SLOT, SLOT_TOLERANCE, SLOTS, statSlots, TOLERANCE, TYPES, WINDOWS, type ScoreRow } from '../domain/stats.js';
import { latestEmpire, latestEmpires } from '../repo/empire.js';
import { sharedFleets } from '../repo/fleets.js';
import { memberPlayer, memberPlayers } from '../repo/members.js';
import { latestScores } from '../repo/stats.js';
import { contextOf, groupBy } from './util.js';

export function overviewRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string } }>('/api/:uni/context', async (req) => {
    const ctx = ctxOf(req);
    const members = db
      .prepare(
        `SELECT u.id, u.username, COALESCE(m.ingame_name, u.username) AS name, m.role, u.is_admin AS global_admin, m.ingame_name, m.last_seen_at
         FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY name COLLATE NOCASE`,
      )
      .all(ctx.groupId);
    // own research + planets (latest empire page) for flight time and missile links: silo level and missiles per planet
    const empire = latestEmpire(db, ctx, ctx.user.id);
    const rec = empire?.rec;
    // own player and total points: weak/strong (noob protection) are derived from them
    const playerId = memberPlayer(db, ctx, ctx.user.id);
    return {
      universe: ctx.universe,
      group: { id: ctx.groupId, name: ctx.groupName, role: ctx.role },
      toolsUrl: config.toolsUrl,
      members,
      me: ctx.user,
      player: playerId ? { id: playerId, points: latestScores(db, ctx.groupId, [playerId], [1]).get(playerId)?.[1]?.points ?? null } : null,
      own: rec
        ? {
            time: empire!.time,
            research: rec.research,
            planets: rec.planets.map((p) => ({ name: p.name, coords: p.coords, type: p.type, silo: p.values[44] ?? 0, ipm: p.values[503] ?? 0 })),
          }
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
           -- one index lookup per player (see migration 055)
           SELECT ps.player_id, ps.points, ps.rank, ps.rank_change, ps.stat_time FROM players p
           JOIN player_scores ps ON ps.rowid = (
             SELECT rowid FROM player_scores WHERE player_id = p.id AND type = ? AND stat_time < ? ORDER BY stat_time DESC LIMIT 1)
           WHERE p.group_id = ?
           ORDER BY player_id, stat_time DESC`,
        )
        .all(ctx.groupId, type, since, type, since, ctx.groupId) as (ScoreRow & { player_id: number })[];
      for (const [playerId, history] of groupBy(rows, (r) => r.player_id)) {
        const entry = players.get(playerId) ?? { scores: {} };
        entry.scores[type] = scoreEntry(history, sections[type]);
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

/** Missions shown as attack: attack, ACS attack, destroy (game mission ids). */
const ATTACK_MISSIONS = [1, 2, 9];
const SPY_MISSION = 6;

/**
 * One row per known planet/moon (galaxy view or spy report) with the latest spy values.
 * Each section comes from the newest report that contains it, as low-level reports only show resources.
 */
function planetRows(db: DB, ctx: GroupContext) {
  const rows = new Map<string, any>();
  const key = (g: number, s: number, p: number, type: string) => `${g}:${s}:${p}:${type}`;
  const add = (g: number, s: number, p: number, type: string, name: string | null, playerId: number | null) => {
    const k = key(g, s, p, type);
    if (!rows.has(k)) rows.set(k, { g, s, p, type, name, player_id: playerId, spy: null, own: null, last_battle: null, next_attack: null, next_spy: null });
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
  const members = memberPlayers(db, ctx);
  for (const { userId, time, rec } of latestEmpires(db, ctx)) {
    // former members' pages stay, but they're no longer the own alliance
    if (!members.has(userId)) continue;
    const playerId = members.get(userId) ?? null;
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

  // Attacks and spying of the members still flying to a planet (as far as they share them, like FF-Hub): the next
  // arrival and who flies. Without a report afterwards the flight counts as recalled, so arrived flights are left out.
  const t = now();
  const names = db
    .prepare('SELECT m.user_id, COALESCE(m.ingame_name, u.username) AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
    .all(ctx.groupId) as { user_id: number; name: string }[];
  for (const m of names) {
    for (const f of sharedFleets(db, ctx.groupId, m.user_id, ctx.user.id)?.data ?? []) {
      const field = f.mission != null && ATTACK_MISSIONS.includes(f.mission) ? 'next_attack' : f.mission === SPY_MISSION ? 'next_spy' : null;
      if (!field || f.owner !== 'own' || f.phase !== 'out' || !f.to || f.arrival <= t) continue;
      const row = rows.get(key(f.to.coords.g, f.to.coords.s, f.to.coords.p, f.to.type === 'moon' ? 'moon' : 'planet'));
      if (!row) continue;
      const next = (row[field] ??= { arrival: f.arrival, members: [] });
      next.arrival = Math.min(next.arrival, f.arrival);
      if (!next.members.includes(m.name)) next.members.push(m.name);
    }
  }
  return [...rows.values()].filter((r) => r.player_id != null);
}
