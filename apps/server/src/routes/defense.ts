import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { defenseAdvice, defenseInput } from '../repo/defense.js';
import { contextOf } from './util.js';

/** Defense advisor (see repo/defense.ts): the attackers of one of the viewer's planets and the defense against them. */
export function defenseRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string }; Querystring: { planet?: string; ships?: string; debris?: string; loot?: string; threats?: string; sim?: string } }>(
    '/api/:uni/defense-advice',
    async (req) => {
      const ctx = ctxOf(req);
      const q = req.query;
      if (!q.planet || !/^\d+:\d+:\d+:(planet|moon)$/.test(q.planet)) throw new HttpError(400, 'planet_invalid', 'planet: "g:s:p:planet" or "g:s:p:moon"');
      const threats = q.threats != null ? q.threats.split(',').map((k) => k.trim()).filter(Boolean) : null;
      const input = defenseInput(db, ctx, {
        key: q.planet,
        ships: q.ships !== '0',
        debris: q.debris !== '0',
        loot: q.loot === 'full' ? 'full' : 'now',
        threats,
      });
      const { search, ...rest } = input;
      const advice = q.sim === '0' ? null : await defenseAdvice(ctx, search);
      return { ...rest, simulated: search.threats.map((t) => t.key), advice, now: ctx.now };
    },
  );
}
