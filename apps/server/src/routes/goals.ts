import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { allianceGoals, goalSettings, parseGoalSettings } from '../repo/goals.js';
import { achievements, ranking, RANKING_PERIODS, type RankingPeriod } from '../repo/achievements.js';
import { recap, RECAP_PERIODS, type RecapPeriod } from '../repo/recap.js';
import { recapMarkdown } from '../recapText.js';
import { config } from '../config.js';
import { requireGroupAdminOf } from './admin.js';
import { contextOf } from './util.js';

/**
 * Sync incentives: alliance goals (progress for the members, the targets for the group's admins, see repo/goals.ts),
 * badges, streaks and the ranking (repo/achievements.ts).
 */
/** A period from the query (default this week); 400 for an unknown one. */
export function periodOf(value: string | undefined): RankingPeriod {
  const period = (value ?? 'week') as RankingPeriod;
  if (!RANKING_PERIODS.includes(period)) throw new HttpError(400, 'invalid_period', 'Unknown period');
  return period;
}

/** A recap period from the query (default this week); 400 for an unknown one. */
export function recapPeriodOf(value: string | undefined): RecapPeriod {
  const period = (value ?? 'week') as RecapPeriod;
  if (!RECAP_PERIODS.includes(period)) throw new HttpError(400, 'invalid_period', 'Unknown period');
  return period;
}

export function goalRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string } }>('/api/:uni/goals', async (req) => ({ goals: allianceGoals(db, ctxOf(req)) }));

  app.get<{ Params: { uni: string } }>('/api/:uni/achievements', async (req) => ({ members: achievements(db, ctxOf(req)) }));

  app.get<{ Params: { uni: string }; Querystring: { period?: string } }>('/api/:uni/ranking', async (req) => {
    const period = periodOf(req.query.period);
    return { period, ...ranking(db, ctxOf(req), period) };
  });

  /** The recap of a period: syncs, points, badges reached, highlights and what is open (repo/recap.ts). */
  app.get<{ Params: { uni: string }; Querystring: { period?: string } }>('/api/:uni/recap', async (req) => recap(db, ctxOf(req), recapPeriodOf(req.query.period)));

  /** The recap as Markdown to copy (the text of the Discord post), in the caller's or the asked language. */
  app.get<{ Params: { uni: string }; Querystring: { period?: string; lang?: string } }>('/api/:uni/recap/text', async (req) => {
    const ctx = ctxOf(req);
    const lang = req.query.lang === 'en' || req.query.lang === 'de' ? req.query.lang : ctx.user.lang === 'en' ? 'en' : 'de';
    const link = config.publicUrl ? `${config.publicUrl}${config.basePath}/${ctx.universe.slug}/health?tab=recap&group=${ctx.groupId}` : null;
    return { text: recapMarkdown(recap(db, ctx, recapPeriodOf(req.query.period)), lang, link) };
  });

  app.get<{ Params: { id: string } }>('/api/admin/groups/:id/goals', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdminOf(db, req, groupId);
    return goalSettings(db, groupId);
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/admin/groups/:id/goals', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdminOf(db, req, groupId);
    const settings = parseGoalSettings(goalSettings(db, groupId), req.body);
    if (!settings) throw new HttpError(400, 'goals_invalid', 'Invalid goal settings');
    db.prepare('UPDATE groups SET goals = ? WHERE id = ?').run(JSON.stringify(settings), groupId);
    return settings;
  });
}
