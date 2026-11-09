import { explainNoData, looksLikeUniverseJson, type StatsType } from '@pr0hub/core';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import { groupContext } from '../context.js';
import type { DB } from '../db.js';
import { foreignUniverse, ingest } from '../ingest.js';
import { buildUniverseJson } from '../universeJson.js';
import { SAMPLE_MAX, saveSample } from '../repo/samples.js';

/** Caps paste/upload cost: parse + gzip + a transaction of an 8–16 MiB body. */
export const INGEST_LIMITS = { perUserPerMinute: 120, perGroupPerMinute: 200, universeJsonConcurrent: 1 };

const ingestHits = new Map<string, number[]>();
let universeJsonRunning = 0;

function takeHits(key: string, limit: number, at: number) {
  const list = (ingestHits.get(key) ?? []).filter((t) => at - t < 60_000);
  if (list.length >= limit) throw new HttpError(429, 'ingest_rate_limit', 'Too many syncs, try again in a moment');
  list.push(at);
  ingestHits.set(key, list);
  if (ingestHits.size > 10000) for (const [k, v] of ingestHits) if (!v.some((t) => at - t < 60_000)) ingestHits.delete(k);
}

/** One slot per user and per group within a minute. `at` is for tests. */
export function takeIngestSlot(userId: number, groupId: number, at = Date.now()) {
  takeHits(`u:${userId}`, INGEST_LIMITS.perUserPerMinute, at);
  takeHits(`g:${groupId}`, INGEST_LIMITS.perGroupPerMinute, at);
}

interface IngestBody {
  html?: string | null;
  text?: string | null;
  statsType?: StatsType | null;
  /** "g:s" for a galaxy view copied without its galaxy/system inputs */
  system?: string | null;
  /** member to sync for (e.g. a report they sent), default: oneself */
  forUser?: number | null;
  dryRun?: boolean;
}

export function ingestRoutes(app: FastifyInstance, db: DB) {
  /** Paste from the web UI. `dryRun` returns the preview without storing. */
  app.post<{ Params: { uni: string }; Body: IngestBody }>('/api/:uni/ingest', async (req) => {
    const ctx = groupContext(db, req, req.params.uni);
    takeIngestSlot(ctx.user.id, ctx.groupId);
    const body = req.body ?? {};
    if (!body.html && !body.text) throw new HttpError(400, 'nothing_pasted', 'Nothing pasted');
    if (foreignUniverse(body.html, ctx.universe.settings.gameUrl)) {
      throw new HttpError(400, 'wrong_universe', `The pasted page is from another universe than ${ctx.universe.name}`);
    }
    const forUser = body.forUser != null && body.forUser !== ctx.user.id ? Number(body.forUser) : null;
    if (forUser != null && !db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(ctx.groupId, forUser)) {
      throw new HttpError(400, 'member_not_found', 'Member not found');
    }
    return ingest(
      db,
      { groupId: ctx.groupId, userId: forUser ?? ctx.user.id, timezone: ctx.universe.settings.timezone, syncedBy: forUser != null ? ctx.user.id : undefined },
      { html: body.html, text: body.text, statsType: body.statsType, system: body.system, source: 'paste' },
      { dryRun: !!body.dryRun, ctx, log: req.log },
    );
  });

  /**
   * A page the hub found nothing in, sent to the hub's admins as a parser sample (anonymized, see `saveSample`). The
   * explanation is worked out here again, not taken from the client.
   */
  app.post<{ Params: { uni: string }; Body: { html?: string | null; text?: string | null; note?: string | null } }>('/api/:uni/ingest/sample', async (req) => {
    const ctx = groupContext(db, req, req.params.uni);
    takeIngestSlot(ctx.user.id, ctx.groupId);
    const html = req.body?.html || null;
    const text = req.body?.text || null;
    if (!html && !text) throw new HttpError(400, 'nothing_pasted', 'Nothing pasted');
    if ((html?.length ?? 0) + (text?.length ?? 0) > SAMPLE_MAX) throw new HttpError(413, 'sample_too_large', 'Page too large for a sample');
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) || null : null;
    const why = explainNoData({ html, text: text ?? (html ?? '').replace(/<[^>]+>/g, '\n') });
    const id = saveSample(db, ctx, { html, text, code: why.code, page: why.page ?? null, note });
    // the hub's admins hear about it by push and Discord, when set up
    const sample = { id, username: ctx.user.username, code: why.code, page: why.page ?? null, note };
    for (const service of [app.push, app.discord]) service.notifySample(sample).catch((err) => req.log.warn({ err }, 'parser sample notification failed'));
    return { id, explain: why };
  });

  /**
   * universe.json upload (whole universe, a few MB). Parsing takes about three times the file in memory on top of the
   * hub's own: the limit keeps that within a small container.
   */
  app.post<{ Params: { uni: string }; Body: { text?: string } }>(
    '/api/:uni/universe-json',
    { bodyLimit: 16 * 1024 * 1024 },
    async (req) => {
      const ctx = groupContext(db, req, req.params.uni);
      takeIngestSlot(ctx.user.id, ctx.groupId);
      if (universeJsonRunning >= INGEST_LIMITS.universeJsonConcurrent) {
        throw new HttpError(429, 'ingest_busy', 'A universe.json upload is already running');
      }
      universeJsonRunning++;
      try {
        const text = req.body?.text;
        if (!text || !looksLikeUniverseJson(text)) throw new HttpError(400, 'universe_json_invalid', 'Not a valid universe.json');
        return ingest(
          db,
          { groupId: ctx.groupId, userId: ctx.user.id, timezone: ctx.universe.settings.timezone },
          { text, source: 'upload' },
          { ctx, log: req.log },
        );
      } finally {
        universeJsonRunning--;
      }
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
