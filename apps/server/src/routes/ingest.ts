import { looksLikeUniverseJson, type StatsType } from '@pr0hub/core';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import { groupContext } from '../context.js';
import type { DB } from '../db.js';
import { foreignUniverse, ingest } from '../ingest.js';
import { buildUniverseJson } from '../universeJson.js';

interface IngestBody {
  html?: string | null;
  text?: string | null;
  statsType?: StatsType | null;
  /** "g:s" for a galaxy view copied without its galaxy/system inputs */
  system?: string | null;
  dryRun?: boolean;
}

export function ingestRoutes(app: FastifyInstance, db: DB) {
  /** Paste from the web UI. `dryRun` returns the preview without storing. */
  app.post<{ Params: { uni: string }; Body: IngestBody }>('/api/:uni/ingest', async (req) => {
    const ctx = groupContext(db, req, req.params.uni);
    const body = req.body ?? {};
    if (!body.html && !body.text) throw new HttpError(400, 'nothing_pasted', 'Nothing pasted');
    if (foreignUniverse(body.html, ctx.universe.settings.gameUrl)) {
      throw new HttpError(400, 'wrong_universe', `The pasted page is from another universe than ${ctx.universe.name}`);
    }
    return ingest(
      db,
      { groupId: ctx.groupId, userId: ctx.user.id, timezone: ctx.universe.settings.timezone },
      { html: body.html, text: body.text, statsType: body.statsType, system: body.system, source: 'paste' },
      { dryRun: !!body.dryRun },
    );
  });

  /** universe.json upload (whole universe, several MB). */
  app.post<{ Params: { uni: string }; Body: { text?: string } }>(
    '/api/:uni/universe-json',
    { bodyLimit: 64 * 1024 * 1024 },
    async (req) => {
      const ctx = groupContext(db, req, req.params.uni);
      const text = req.body?.text;
      if (!text || !looksLikeUniverseJson(text)) throw new HttpError(400, 'universe_json_invalid', 'Not a valid universe.json');
      return ingest(
        db,
        { groupId: ctx.groupId, userId: ctx.user.id, timezone: ctx.universe.settings.timezone },
        { text, source: 'upload' },
      );
    },
  );

  /** universe.json download, built from the hub's galaxy data in pr0game's own export format. */
  app.get<{ Params: { uni: string } }>('/api/:uni/universe-json', async (req, reply) => {
    const ctx = groupContext(db, req, req.params.uni);
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', 'attachment; filename="universe.json"')
      .send(buildUniverseJson(db, ctx.groupId, ctx.universe.settings.positions));
  });
}
