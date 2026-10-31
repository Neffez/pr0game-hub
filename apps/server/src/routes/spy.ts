import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { clampInt, contextOf, DISPLAY, MEMBER, parseSections, type Q } from './util.js';

export function spyRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string; g: string; s: string; p: string }; Querystring: Q }>('/api/:uni/spy/:g/:s/:p', async (req) => {
    const ctx = ctxOf(req);
    const type = req.query.type === 'moon' ? 'moon' : 'planet';
    const limit = clampInt(req.query.limit, 20, 1, 500);
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
    const limit = clampInt(req.query.limit, 100, 1, 1000);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    // keyset paging (`before=<report_time>:<id>` of the last row): stable while new reports come in
    const before = req.query.before?.match(/^(\d+):(\d+)$/);
    const after = before ? 'AND (sr.report_time < ? OR (sr.report_time = ? AND sr.id < ?))' : '';
    const args = before ? [Number(before[1]), Number(before[1]), Number(before[2])] : [];
    return db
      .prepare(
        `SELECT sr.id, sr.g, sr.s, sr.p, sr.planet_type, sr.planet_name, sr.player_name, sr.player_id, sr.report_time, sr.sections,
           ${DISPLAY} AS reporter
         FROM spy_reports sr LEFT JOIN users u ON u.id = sr.user_id ${MEMBER('sr')}
         WHERE sr.group_id = ? ${after} ORDER BY sr.report_time DESC, sr.id DESC LIMIT ? OFFSET ?`,
      )
      .all(ctx.groupId, ...args, limit, before ? 0 : offset)
      .map(parseSections);
  });
}
