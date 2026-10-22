import type { EmpireRecord } from '@pr0hub/core';
import { CLASS_BUILDINGS, CLASS_DEFENSE, CLASS_FLEET, classOf, elementPoints } from '@pr0hub/core/tech';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { withMoonTypes } from '../repo/empire.js';
import { contextOf, type Q } from './util.js';

export function imperiumRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  /** Latest own empire + game overview page of a member, for the live view. */
  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/imperium', async (req) => {
    const ctx = ctxOf(req);
    const userId = Number(req.query.user ?? ctx.user.id);
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId)) {
      throw new HttpError(404, 'member_not_found', 'Member not found');
    }
    const empire = db
      .prepare('SELECT created_at AS time, data FROM empire_snapshots WHERE group_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(ctx.groupId, userId) as { time: number; data: string } | undefined;
    const overview = db
      .prepare('SELECT page_time AS time, data FROM overview_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC LIMIT 1')
      .get(ctx.groupId, userId) as { time: number; data: string } | undefined;
    // the member's player (in-game name) and the latest synced statistics per category, for the live points
    const player = db
      .prepare(
        `SELECT p.id, p.name FROM group_members gm JOIN players p ON p.group_id = gm.group_id AND p.name = gm.ingame_name COLLATE NOCASE
         WHERE gm.group_id = ? AND gm.user_id = ?`,
      )
      .get(ctx.groupId, userId) as { id: number; name: string } | undefined;
    const stats = player
      ? (db
          .prepare(
            `SELECT st.type, ps.points, ps.rank, MAX(st.stat_time) AS time FROM player_scores ps JOIN stat_snapshots st ON st.id = ps.snapshot_id
             WHERE st.group_id = ? AND st.who = 'player' AND st.type BETWEEN 1 AND 5 AND ps.player_id = ? GROUP BY st.type`,
          )
          .all(ctx.groupId, player.id) as { type: number; points: number; rank: number; time: number }[])
      : [];
    // Fleets in flight are missing on the empire page but count in the statistics: the live fleet is the
    // stats fleet plus the change of the ships on the planets since the first empire page after that update.
    // The anchor is the newest of the fleet and the total statistics (the total is synced far more often; its
    // fleet is the total minus the other points of that empire page), so ships built in between are not lost.
    const fleetStat = stats.find((s) => s.type === 2);
    const totalStat = stats.find((s) => s.type === 1);
    const anchor = fleetStat && (!totalStat || fleetStat.time >= totalStat.time) ? fleetStat : totalStat;
    const fleetBase = anchor
      ? (db
          .prepare('SELECT created_at AS time, data FROM empire_snapshots WHERE group_id = ? AND user_id = ? AND created_at >= ? ORDER BY created_at, id LIMIT 1')
          .get(ctx.groupId, userId, anchor.time) as { time: number; data: string } | undefined)
      : undefined;
    // catch-up bonus: the game compares buildings ×1 + research ×0.8 + fleet ×0.6 with the best player of the universe
    const leader = db
      .prepare(
        `WITH latest AS (SELECT type, MAX(stat_time) AS t FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type IN (2, 3, 4) GROUP BY type)
         SELECT p.name, SUM(CASE st.type WHEN 4 THEN ps.points END) AS buildings, SUM(CASE st.type WHEN 3 THEN ps.points END) AS research,
                SUM(CASE st.type WHEN 2 THEN ps.points END) AS fleet,
                SUM(ps.points * CASE st.type WHEN 4 THEN 1 WHEN 3 THEN 0.8 ELSE 0.6 END) AS weighted
         FROM stat_snapshots st JOIN latest l ON l.type = st.type AND l.t = st.stat_time
         JOIN player_scores ps ON ps.snapshot_id = st.id JOIN players p ON p.id = ps.player_id
         WHERE st.group_id = ? AND st.who = 'player' GROUP BY ps.player_id ORDER BY weighted DESC LIMIT 1`,
      )
      .get(ctx.groupId, ctx.groupId) as { name: string; buildings: number | null; research: number | null; fleet: number | null; weighted: number } | undefined;
    // ship points on the planets and all other points (buildings, defense, research) of an empire page
    const empirePoints = (e: EmpireRecord) => {
      let fleet = 0;
      let other = 0;
      for (const pl of e.planets) {
        for (const [id, n] of Object.entries(pl.values)) {
          const cls = classOf(Number(id));
          if (cls === CLASS_FLEET) fleet += elementPoints(id, n);
          else if (cls === CLASS_BUILDINGS || cls === CLASS_DEFENSE) other += elementPoints(id, n);
        }
      }
      for (const [id, n] of Object.entries(e.research ?? {})) other += elementPoints(id, n);
      return { fleet, other };
    };
    const basePoints = fleetBase && empirePoints(JSON.parse(fleetBase.data) as EmpireRecord);
    // the stats fleet at the anchor update
    const anchorFleet = !anchor || !basePoints ? null : anchor.type === 2 ? anchor.points : anchor.points - basePoints.other;
    return {
      userId,
      empire: empire ? { time: empire.time, data: withMoonTypes(JSON.parse(empire.data) as EmpireRecord) } : null,
      overview: overview ? { time: overview.time, data: JSON.parse(overview.data) } : null,
      player: player ? { ...player, stats: Object.fromEntries(stats.map((s) => [s.type, s])) } : null,
      fleetBase: fleetBase && basePoints && anchorFleet != null ? { time: fleetBase.time, points: basePoints.fleet, stat: anchorFleet } : null,
      leader: leader ?? null,
    };
  });

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
}
