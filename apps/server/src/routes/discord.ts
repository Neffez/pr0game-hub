import type { FastifyInstance } from 'fastify';
import { HttpError, requireUser } from '../auth.js';
import type { DB } from '../db.js';
import { channelPrefs, DISCORD_ID, isWebhook, parseChannelPrefs, webhookHint, type DiscordService } from '../discord.js';
import { parsePushPrefs, pushPrefs } from '../push.js';
import { requireGroupAdminOf } from './admin.js';

interface PersonalBody {
  webhook?: unknown;
  userId?: unknown;
  prefs?: Record<string, unknown>;
}

interface ChannelBody {
  webhook?: unknown;
  prefs?: Record<string, unknown>;
}

/** A webhook from a request body: undefined keeps it, null or '' removes it, else it must be a Discord webhook URL. */
function webhookOf(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const url = String(v).trim();
  if (!isWebhook(url)) throw new HttpError(400, 'discord_webhook_invalid', 'Not a Discord webhook URL');
  return url;
}

const sendResult = (ok: boolean | null) => {
  if (ok === null) throw new HttpError(409, 'discord_not_configured', 'No Discord webhook set');
  if (!ok) throw new HttpError(502, 'discord_send_failed', 'Discord did not take the message');
  return { ok: true };
};

export function discordRoutes(app: FastifyInstance, db: DB, discord: DiscordService) {
  const personal = (userId: number) => {
    const row = db.prepare('SELECT discord_webhook, discord_user_id FROM users WHERE id = ?').get(userId) as { discord_webhook: string | null; discord_user_id: string | null };
    return { webhook: webhookHint(row.discord_webhook), userId: row.discord_user_id, prefs: pushPrefs(db, userId, 'discord_prefs') };
  };

  /** The caller's own webhook (only its start), their Discord id for mentions and which notifications go there. */
  app.get('/api/auth/discord', async (req) => personal(requireUser(req).id));

  app.post<{ Body: PersonalBody }>('/api/auth/discord', async (req) => {
    const user = requireUser(req);
    const body = req.body ?? {};
    const webhook = webhookOf(body.webhook);
    let discordId: string | null | undefined;
    if (body.userId !== undefined) {
      discordId = body.userId === null || body.userId === '' ? null : String(body.userId).trim();
      if (discordId !== null && !DISCORD_ID.test(discordId)) throw new HttpError(400, 'discord_user_id_invalid', 'Invalid Discord user id');
    }
    const prefs = body.prefs ? parsePushPrefs(pushPrefs(db, user.id, 'discord_prefs'), body.prefs) : undefined;
    if (prefs === null) throw new HttpError(400, 'discord_settings_invalid', 'Invalid Discord settings');
    db.transaction(() => {
      if (webhook !== undefined) db.prepare('UPDATE users SET discord_webhook = ? WHERE id = ?').run(webhook, user.id);
      if (discordId !== undefined) db.prepare('UPDATE users SET discord_user_id = ? WHERE id = ?').run(discordId, user.id);
      if (prefs) db.prepare('UPDATE users SET discord_prefs = ? WHERE id = ?').run(JSON.stringify(prefs), user.id);
    })();
    return personal(user.id);
  });

  /** A test message to the caller's own webhook. */
  app.post('/api/auth/discord/test', async (req) => {
    const user = requireUser(req);
    return sendResult(await discord.testUser(user.id, user.lang === 'en' ? 'en' : 'de'));
  });

  const channel = (groupId: number) => {
    const url = db.prepare('SELECT discord_webhook FROM groups WHERE id = ?').pluck().get(groupId) as string | null | undefined;
    if (url === undefined) throw new HttpError(404, 'not_found', 'Not found');
    return { webhook: webhookHint(url), prefs: channelPrefs(db, groupId) };
  };

  /** The group's channel webhook (only its start) and what it gets; group admins. */
  app.get<{ Params: { id: string } }>('/api/admin/groups/:id/discord', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdminOf(db, req, groupId);
    return channel(groupId);
  });

  app.put<{ Params: { id: string }; Body: ChannelBody }>('/api/admin/groups/:id/discord', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdminOf(db, req, groupId);
    channel(groupId);
    const webhook = webhookOf(req.body?.webhook);
    const prefs = req.body?.prefs ? parseChannelPrefs(channelPrefs(db, groupId), req.body.prefs) : undefined;
    if (prefs === null) throw new HttpError(400, 'discord_settings_invalid', 'Invalid Discord settings');
    db.transaction(() => {
      if (webhook !== undefined) db.prepare('UPDATE groups SET discord_webhook = ? WHERE id = ?').run(webhook, groupId);
      if (prefs) db.prepare('UPDATE groups SET discord_prefs = ? WHERE id = ?').run(JSON.stringify(prefs), groupId);
    })();
    return channel(groupId);
  });

  /** A test message to the group's channel. */
  app.post<{ Params: { id: string } }>('/api/admin/groups/:id/discord/test', async (req) => {
    const groupId = Number(req.params.id);
    requireGroupAdminOf(db, req, groupId);
    return sendResult(await discord.testGroup(groupId));
  });
}
