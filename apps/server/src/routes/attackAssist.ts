import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { attackAssist, attackSimulation, findAttack } from '../repo/attackAssist.js';
import { contextOf } from './util.js';

/** Incoming attack assistant: one hostile attack on a member (see repo/attackAssist.ts). */
export function attackAssistRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string }; Querystring: { key?: string; member?: string; arrival?: string; from?: string; sim?: string } }>(
    '/api/:uni/attack-assist',
    async (req) => {
      const ctx = ctxOf(req);
      const q = req.query;
      const num = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
      const attack = findAttack(db, ctx, { key: q.key, member: num(q.member), arrival: num(q.arrival), from: q.from });
      if (!attack) throw new HttpError(404, 'attack_not_found', 'Hostile attack not found (arrived or not pasted)');
      const assist = attackAssist(db, ctx, attack);
      const { setup, ...rest } = assist;
      const sim = q.sim === '0' || attack.arrival <= ctx.now ? null : await attackSimulation(ctx, assist);
      return { ...rest, simulated: !!setup, sim, now: ctx.now };
    },
  );
}
