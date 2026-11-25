import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import { fleetSaveGuesses, type SpyRow } from '../repo/fleetSave.js';
import { clampInt, contextOf, DISPLAY, parseSections, type Q } from './util.js';

/** Reports read per step while only reports with a fleet save guess are asked for. */
const FLEET_SAVE_CHUNK = 500;

export function spyRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string; g: string; s: string; p: string }; Querystring: Q }>('/api/:uni/spy/:g/:s/:p', async (req) => {
    const ctx = ctxOf(req);
    const type = req.query.type === 'moon' ? 'moon' : 'planet';
    const limit = clampInt(req.query.limit, 20, 1, 500);
    const [g, s, p] = [Number(req.params.g), Number(req.params.s), Number(req.params.p)];
    const rows = db
      .prepare(
        `SELECT sr.id, sr.planet_name, sr.player_name, sr.player_id, sr.report_time, sr.sections, sr.destroy_chance, ${DISPLAY} AS reporter
         FROM spy_reports sr LEFT JOIN users u ON u.id = sr.user_id
         WHERE sr.group_id = ? AND sr.g = ? AND sr.s = ? AND sr.p = ? AND sr.planet_type = ?
         ORDER BY sr.report_time DESC LIMIT ?`,
      )
      .all(ctx.groupId, g, s, p, type, limit)
      .map(parseSections) as Omit<SpyRow, 'g' | 's' | 'p' | 'planet_type'>[];
    const total = db
      .prepare('SELECT COUNT(*) FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ?')
      .pluck()
      .get(ctx.groupId, g, s, p, type);
    const reports = fleetSaveGuesses(db, ctx, rows.map((r) => ({ ...r, g, s, p, planet_type: type })))
      // the position is the request's: not repeated per report
      .map(({ g: _g, s: _s, p: _p, planet_type: _t, ...r }) => r);
    return { reports, total };
  });

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/spy-reports', async (req) => {
    const ctx = ctxOf(req);
    const limit = clampInt(req.query.limit, 100, 1, 1000);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    // keyset paging (`before=<report_time>:<id>` of the last row): stable while new reports come in
    const before = req.query.before?.match(/^(\d+):(\d+)$/);
    const page = db.prepare(
      `SELECT sr.id, sr.g, sr.s, sr.p, sr.planet_type, sr.planet_name, sr.player_name, sr.player_id, sr.report_time, sr.sections,
         ${DISPLAY} AS reporter
       FROM spy_reports sr LEFT JOIN users u ON u.id = sr.user_id
       WHERE sr.group_id = ? AND (? IS NULL OR sr.report_time < ? OR (sr.report_time = ? AND sr.id < ?))
         AND (? = 0 OR (sr.planet_type = 'planet' AND json_extract(sr.sections, '$."900"') IS NOT NULL))
       ORDER BY sr.report_time DESC, sr.id DESC LIMIT ? OFFSET ?`,
    );
    const load = (cursor: [number, number] | null, onlyPlanets: boolean, n: number, skip: number) =>
      fleetSaveGuesses(
        db,
        ctx,
        page.all(ctx.groupId, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[1] ?? null, onlyPlanets ? 1 : 0, n, skip).map(parseSections) as SpyRow[],
      );
    const start: [number, number] | null = before ? [Number(before[1]), Number(before[2])] : null;
    if (req.query.fleetSave !== '1') return load(start, false, limit, before ? 0 : offset);
    // only reports with a fleet save guess: scanned in chunks until the page is full, the keyset continues after the
    // last report returned
    const out: ReturnType<typeof load> = [];
    let cursor = start;
    for (;;) {
      const chunk = load(cursor, true, FLEET_SAVE_CHUNK, 0);
      out.push(...chunk.filter((r) => r.fleetSave));
      if (out.length >= limit || chunk.length < FLEET_SAVE_CHUNK) return out.slice(0, limit);
      const last = chunk[chunk.length - 1];
      cursor = [last.report_time, last.id];
    }
  });
}
