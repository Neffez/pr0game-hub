import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import { checkSize, flights, parseBattleRequest, planetFromSpy, runInWorker, simSettingsOf, throttle, toolsLink, type ApiSlot } from '../battle.js';
import type { DB } from '../db.js';
import { contextOf, parseSections } from './util.js';

/**
 * Battle simulator for scripts and AI agents: the battle on the game's engine (Battlerust) many times, summarized. It
 * writes nothing, so read-only API tokens may call it (`allowToken`). Without a planet in `defenders[0]` the newest
 * spy report of the group at `target` is the planet.
 */
export function battleRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.post<{ Params: { uni: string } }>('/api/:uni/battle/simulate', { config: { allowToken: true } }, async (req) => {
    const ctx = ctxOf(req);
    const body = parseBattleRequest(req.body);
    let planet = body.defenders[0];
    let resources = body.resources;
    let spyReport: { id: number; time: number; reporter: string | null } | null = null;
    if (!planet) {
      const [g, s, p] = body.target!;
      const row = db
        .prepare(
          `SELECT sr.id, sr.report_time, sr.sections, COALESCE(gm.ingame_name, u.username) AS reporter FROM spy_reports sr
           LEFT JOIN users u ON u.id = sr.user_id LEFT JOIN group_members gm ON gm.group_id = sr.group_id AND gm.user_id = sr.user_id
           WHERE sr.group_id = ? AND sr.g = ? AND sr.s = ? AND sr.p = ? AND sr.planet_type = ? ORDER BY sr.report_time DESC LIMIT 1`,
        )
        .get(ctx.groupId, g, s, p, body.planetType);
      if (!row) throw new HttpError(404, 'spy_report_not_found', 'No spy report of the target in the group');
      const report = parseSections(row) as { id: number; report_time: number; reporter: string | null; sections: Record<string, Record<string, number>> };
      const fromSpy = planetFromSpy(Object.assign({}, ...Object.values(report.sections)));
      planet = fromSpy.planet;
      resources ??= fromSpy.resources;
      spyReport = { id: report.id, time: report.report_time, reporter: report.reporter };
    }
    const defenders = [planet, ...(body.defenders.slice(1) as ApiSlot[])];
    const setup = {
      attackers: body.attackers.map((a) => ({ units: a.units, research: a.research, carried: a.carried })),
      defenders: defenders.map((d) => ({ units: d.units, research: d.research })),
      resources: resources ?? undefined,
    };
    checkSize(setup, body.runs);
    throttle(ctx.user.id);
    const u = ctx.universe.settings;
    const settings = simSettingsOf(u, body.settings);
    const { typical, ...summary } = await runInWorker(setup, body.runs, settings);
    return {
      ...summary,
      settings,
      spyReport,
      flights: flights(u, body.attackers, body.target),
      typical: { winner: typical.run.winner, rounds: typical.run.rounds, ...(body.report ? { engine: typical.output } : {}) },
      link: toolsLink(u, { ...body, resources }, planet, settings),
    };
  });
}
