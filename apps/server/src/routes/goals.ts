import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { allianceGoals, goalSettings, parseGoalSettings } from '../repo/goals.js';
import { requireGroupAdminOf } from './admin.js';
import { contextOf } from './util.js';

/** Alliance goals: progress for the members, the targets for the group's admins (see repo/goals.ts). */
export function goalRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string } }>('/api/:uni/goals', async (req) => ({ goals: allianceGoals(db, ctxOf(req)) }));

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
