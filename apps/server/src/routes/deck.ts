import { computeDeck, type DeckEvent } from '@pr0hub/core';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { events } from '../events.js';
import { contextOf, type Q } from './util.js';

export function deckRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);

  app.get<{ Params: { uni: string }; Querystring: Q }>('/api/:uni/deck', async (req) => {
    const ctx = ctxOf(req);
    const userId = Number(req.query.user ?? ctx.user.id);
    if (!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId)) {
      throw new HttpError(404, 'member_not_found', 'Member not found');
    }
    const settings = (db.prepare('SELECT * FROM deck_settings WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId) as any) ?? {
      start_time: null,
      initial_drawn: '{}',
      unknown_depletion: 0,
    };
    const events = db
      .prepare(
        `SELECT id, event, size, depletion, COALESCE(time, created_at) AS time, dedupe_key LIKE 'manual:%' AS manual FROM expeditions
         WHERE group_id = ? AND user_id = ? AND (? IS NULL OR COALESCE(time, created_at) >= ?)
         ORDER BY COALESCE(time, created_at), id`,
      )
      .all(ctx.groupId, userId, settings.start_time, settings.start_time) as (DeckEvent & { id: number; time: number; manual: number })[];
    const state = computeDeck(ctx.universe.deck, events, {
      unknownDepletionChance: settings.unknown_depletion,
      initialDrawn: JSON.parse(settings.initial_drawn),
    });
    return {
      userId,
      settings: { startTime: settings.start_time, initialDrawn: JSON.parse(settings.initial_drawn), unknownDepletion: settings.unknown_depletion },
      lastEvents: events.slice(-15).reverse(),
      state,
    };
  });

  app.put<{ Params: { uni: string }; Body: { startTime?: number | null; initialDrawn?: Record<string, number>; unknownDepletion?: number } }>(
    '/api/:uni/deck',
    async (req) => {
      const ctx = ctxOf(req);
      const b = req.body ?? {};
      const startTime = b.startTime ?? null;
      if (startTime !== null && !(Number.isInteger(startTime) && startTime > 0)) throw new HttpError(400, 'time_invalid', 'Invalid time');
      const drawn = b.initialDrawn ?? {};
      const valid =
        typeof drawn === 'object' &&
        !Array.isArray(drawn) &&
        Object.keys(drawn).length <= 100 &&
        Object.values(drawn).every((n) => Number.isInteger(n) && n >= 0 && n <= 10000);
      if (!valid) throw new HttpError(400, 'deck_settings_invalid', 'Invalid deck settings');
      db.prepare(
        `INSERT INTO deck_settings (group_id, user_id, start_time, initial_drawn, unknown_depletion) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (group_id, user_id) DO UPDATE SET start_time = excluded.start_time, initial_drawn = excluded.initial_drawn,
           unknown_depletion = excluded.unknown_depletion`,
      ).run(
        ctx.groupId,
        ctx.user.id,
        startTime,
        JSON.stringify(drawn),
        Math.min(Math.max(Number(b.unknownDepletion ?? 0), 0), 1) || 0,
      );
      return { ok: true };
    },
  );

  /**
   * Manually counted expedition result (e.g. a report that was not synced). Stored like a synced
   * expedition (dedupe key "manual:…"), so it counts in the deck and in the expedition statistics.
   */
  app.post<{ Params: { uni: string }; Body: { event?: string; size?: string; depletion?: string | null; time?: number | null } }>(
    '/api/:uni/deck/events',
    async (req) => {
      const ctx = ctxOf(req);
      const { event, size, depletion, time } = req.body ?? {};
      if (!ctx.universe.deck.some((c) => c.type === event && c.size === size)) throw new HttpError(400, 'card_not_in_deck', 'Card is not part of the deck');
      if (depletion != null && (event !== 'Nothing' || !['none', 'few', 'medium', 'many'].includes(depletion))) {
        throw new HttpError(400, 'depletion_invalid', 'Invalid depletion');
      }
      const at = time == null ? Math.floor(Date.now() / 1000) : Number(time);
      if (!Number.isInteger(at) || at <= 0) throw new HttpError(400, 'time_invalid', 'Invalid time');
      const id = db
        .prepare(
          `INSERT INTO expeditions (group_id, user_id, dedupe_key, time, event, size, depletion) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ctx.groupId, ctx.user.id, `manual:${randomUUID()}`, at, event, size, depletion ?? null).lastInsertRowid;
      events.publish(ctx.groupId, { type: 'data', tables: ['expeditions'], userId: ctx.user.id });
      return { id: Number(id) };
    },
  );

  /** Removes a manually counted expedition result (own entries only). */
  app.delete<{ Params: { uni: string; id: string } }>('/api/:uni/deck/events/:id', async (req) => {
    const ctx = ctxOf(req);
    const res = db
      .prepare("DELETE FROM expeditions WHERE id = ? AND group_id = ? AND user_id = ? AND dedupe_key LIKE 'manual:%'")
      .run(Number(req.params.id), ctx.groupId, ctx.user.id);
    if (!res.changes) throw new HttpError(404, 'manual_event_not_found', 'Manual event not found');
    events.publish(ctx.groupId, { type: 'data', tables: ['expeditions'], userId: ctx.user.id });
    return { ok: true };
  });
}
