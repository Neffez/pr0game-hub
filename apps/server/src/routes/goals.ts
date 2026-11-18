import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { allianceGoals, goalSettings, parseGoalSettings } from '../repo/goals.js';
import { achievements, ranking, RANKING_PERIODS, type RankingPeriod } from '../repo/achievements.js';
import { requireGroupAdminOf } from './admin.js';
import { contextOf } from './util.js';

/**
 * Sync incentives: alliance goals (progress for the members, the targets for the group's admins, see repo/goals.ts),
 * badges, streaks and the ranking (repo/achievements.ts).
 */
export function goalRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string } }>('/api/:uni/goals', async (req) => ({ goals: allianceGoals(db, ctxOf(req)) }));

  app.get<{ Params: { uni: string } }>('/api/:uni/achievements', async (req) => ({ members: achievements(db, ctxOf(req)) }));

  app.get<{ Params: { uni: string }; Querystring: { period?: string } }>('/api/:uni/ranking', async (req) => {
    const period = (req.query.period ?? 'week') as RankingPeriod;
    if (!RANKING_PERIODS.includes(period)) throw new HttpError(400, 'invalid_period', 'Unknown period');
    return { period, ...ranking(db, ctxOf(req), period) };
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
