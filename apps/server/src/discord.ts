import type { FastifyBaseLogger } from 'fastify';
import type { SessionUser } from './auth.js';
import { config } from './config.js';
import { resolveGroup } from './context.js';
import { now, type DB } from './db.js';
import type { EventBus } from './events.js';
import { GroupDebounce, groupUniverse, SENT_KEEP, TICK_AHEAD, TICK_MS } from './notify.js';
import { LEAD_MINUTES, payloadOf, pushPrefs, testPayload, wanted, type PushLang, type PushPayload } from './push.js';
import { channelNotificationsFor, notificationsFor, type ChannelNotification, type Notification } from './repo/notifications.js';

/**
 * Discord: the bell's notifications sent to a user's own webhook (settings like push, see push.ts), and attacks on
 * members, new plans and launch reminders to the group's channel webhook, mentioning members who gave their Discord id.
 * Same delivery as push: after data events of a group (debounced) and on a ticker, each notification once per webhook.
 */

/** What a group's channel gets. */
export interface ChannelPrefs {
  attacks: boolean;
  plans: boolean;
  launch: boolean;
  /** launch reminder this many minutes before */
  leadMinutes: number;
  lang: PushLang;
}

export const CHANNEL_DEFAULTS: ChannelPrefs = { attacks: true, plans: true, launch: true, leadMinutes: 5, lang: 'de' };
const CHANNEL_FLAGS = ['attacks', 'plans', 'launch'] as const;

export function channelPrefs(db: DB, groupId: number): ChannelPrefs {
  const raw = db.prepare('SELECT discord_prefs FROM groups WHERE id = ?').pluck().get(groupId) as string | null | undefined;
  return { ...CHANNEL_DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<ChannelPrefs>) : {}) };
}

/** Settings from a request body: booleans, a lead time from `LEAD_MINUTES` and a language, the rest as before. */
export function parseChannelPrefs(before: ChannelPrefs, body: Record<string, unknown>): ChannelPrefs | null {
  const next = { ...before };
  for (const k of CHANNEL_FLAGS) if (body[k] !== undefined) next[k] = body[k] === true;
  if (body.leadMinutes !== undefined) {
    if (!LEAD_MINUTES.includes(Number(body.leadMinutes))) return null;
    next.leadMinutes = Number(body.leadMinutes);
  }
  if (body.lang !== undefined) {
    if (body.lang !== 'de' && body.lang !== 'en') return null;
    next.lang = body.lang;
  }
  return next;
}

const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{17,20})\/[\w-]{30,100}$/;
export const DISCORD_ID = /^\d{17,20}$/;

/** Only Discord's own webhook URLs are taken (the hub posts to them). */
export const isWebhook = (url: string) => WEBHOOK.test(url);

/** The webhook URL is a secret: the API only shows its start. */
export function webhookHint(url: string | null): string | null {
  const id = url?.match(WEBHOOK)?.[1];
  return id ? `discord.com/api/webhooks/${id.slice(0, 6)}…` : null;
}

export interface DiscordEmbed {
  title: string;
  description: string;
  url?: string;
  color: number;
}

export interface DiscordMessage {
  content?: string;
  embeds: DiscordEmbed[];
  allowed_mentions: { parse: []; users: string[] };
}

/** Posts one message to a webhook; resolves with the HTTP status (`retryAfter` in seconds for 429). */
export type DiscordSender = (url: string, message: DiscordMessage) => Promise<{ status: number; retryAfter?: number }>;

const fetchSender: DiscordSender = async (url, message) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status !== 429) return { status: res.status };
  const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
  return { status: 429, retryAfter: body.retry_after ?? Number(res.headers.get('retry-after') ?? 1) };
};

/** Discord takes this many embeds per message. */
const EMBEDS_PER_MESSAGE = 10;
/** A rate limit is waited for once if it ends within this many seconds. */
const MAX_RETRY_AFTER = 10;
const COLORS: Record<ChannelNotification['kind'] | Notification['kind'], number> = {
  attack: 0xe74c3c, launch: 0xf39c12, invite: 0x3498db, plan: 0x3498db, comment: 0x95a5a6,
};

type Item = { kind: keyof typeof COLORS; payload: PushPayload; mention?: string | null };
type Target = { key: string; url: string; clear: () => void };

export interface DiscordOptions {
  sender?: DiscordSender;
  log?: Pick<FastifyBaseLogger, 'warn' | 'info'>;
}

export class DiscordService {
  private sender: DiscordSender;
  private debounce: GroupDebounce;
  private log: DiscordOptions['log'];

  constructor(
    private db: DB,
    private bus: EventBus,
    opts: DiscordOptions = {},
  ) {
    this.sender = opts.sender ?? fetchSender;
    this.log = opts.log;
    this.debounce = new GroupDebounce((groupId) => this.deliver(groupId).catch((err) => this.log?.warn({ err, groupId }, 'discord delivery failed')));
  }

  /** Delivers after data events of a group (debounced); returns the unsubscribe. */
  listen(): () => void {
    return this.debounce.listen(this.bus);
  }

  /** Launch reminders: checks the groups with plan fleets ahead for a member's or the group's webhook; returns the stop. */
  start(): () => void {
    const timer = setInterval(() => {
      this.tick().catch((err) => this.log?.warn({ err }, 'discord reminders failed'));
    }, TICK_MS);
    return () => clearInterval(timer);
  }

  async tick(t = now()) {
    const groups = this.db
      .prepare(
        `SELECT DISTINCT a.group_id FROM attack_plans a JOIN attack_plan_fleets f ON f.plan_id = a.id JOIN groups g ON g.id = a.group_id
         JOIN users u ON u.id = f.user_id
         WHERE a.status IN ('planning', 'launched') AND a.time_precision = 'exact' AND a.target_time > ? AND a.target_time < ?
           AND f.status IN ('invited', 'ready') AND (u.discord_webhook IS NOT NULL OR g.discord_webhook IS NOT NULL)`,
      )
      .pluck()
      .all(t, t + TICK_AHEAD) as number[];
    for (const g of groups) await this.deliver(g, t);
  }

  close() {
    this.debounce.close();
  }

  /**
   * Sends the group's notifications not sent yet: to each member's own webhook what `notificationsFor` lists for them
   * (comments and invitations not while they have a hub tab of the group in front, but they count as sent), and to the
   * group's webhook what the channel gets.
   */
  async deliver(groupId: number, t = now()) {
    const universe = groupUniverse(this.db, groupId);
    if (!universe) return;
    this.db.prepare('DELETE FROM discord_sent WHERE sent_at < ?').run(t - SENT_KEEP);
    const mark = this.db.prepare('INSERT OR IGNORE INTO discord_sent (target, key, sent_at) VALUES (?, ?, ?)');
    const outbox: { target: Target; items: Item[] }[] = [];
    const tz = universe.settings.timezone;

    const users = this.db
      .prepare(
        `SELECT u.id, u.username, u.is_admin, u.lang, u.date_format, u.discord_webhook FROM group_members m JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ? AND u.discord_webhook IS NOT NULL`,
      )
      .all(groupId) as { id: number; username: string; is_admin: number; lang: string; date_format: string; discord_webhook: string }[];
    const watching = new Set(this.bus.presence(groupId).filter((m) => m.active).map((m) => m.userId));
    for (const row of users) {
      const user: SessionUser = { id: row.id, username: row.username, isAdmin: !!row.is_admin, lang: row.lang, dateFormat: row.date_format };
      const ctx = resolveGroup(this.db, user, universe, groupId);
      const prefs = pushPrefs(this.db, user.id, 'discord_prefs');
      const lang = user.lang === 'en' ? 'en' : 'de';
      const items: Item[] = [];
      for (const n of notificationsFor(this.db, ctx, t)) {
        if (!wanted(n, prefs, user.id, t)) continue;
        if (!mark.run(`u:${user.id}`, n.id, t).changes) continue;
        if ((n.kind === 'comment' || n.kind === 'invite') && watching.has(user.id)) continue;
        items.push({ kind: n.kind, payload: payloadOf(n, lang, universe.slug, tz, groupId, t) });
      }
      if (items.length) outbox.push({ target: this.userTarget(user.id, row.discord_webhook), items });
    }

    const channel = this.db.prepare('SELECT discord_webhook FROM groups WHERE id = ?').pluck().get(groupId) as string | null;
    if (channel) {
      const prefs = channelPrefs(this.db, groupId);
      const mentionOf = this.db.prepare('SELECT discord_user_id FROM users WHERE id = ?').pluck();
      const items: Item[] = [];
      for (const n of channelNotificationsFor(this.db, universe, groupId, t)) {
        if (!channelWants(n, prefs, t)) continue;
        if (!mark.run(`g:${groupId}`, n.id, t).changes) continue;
        // the attacked member and the one who launches are mentioned, not the creator of a plan
        const mention = n.kind === 'plan' ? null : (mentionOf.get(n.userId) as string | null | undefined);
        items.push({ kind: n.kind, payload: payloadOf(n, prefs.lang, universe.slug, tz, groupId, t, true), mention });
      }
      if (items.length) outbox.push({ target: this.groupTarget(groupId, channel), items });
    }

    for (const m of outbox) await this.send(m.target, m.items);
  }

  /** A test message to the user's own webhook; null without one, false when Discord refused it. */
  async testUser(userId: number, lang: PushLang): Promise<boolean | null> {
    const url = this.db.prepare('SELECT discord_webhook FROM users WHERE id = ?').pluck().get(userId) as string | null;
    if (!url) return null;
    return this.send(this.userTarget(userId, url), [{ kind: 'plan', payload: testPayload(lang, 'discordTest') }]);
  }

  /** A test message to the group's channel; null without a webhook. */
  async testGroup(groupId: number): Promise<boolean | null> {
    const url = this.db.prepare('SELECT discord_webhook FROM groups WHERE id = ?').pluck().get(groupId) as string | null;
    if (!url) return null;
    return this.send(this.groupTarget(groupId, url), [{ kind: 'plan', payload: testPayload(channelPrefs(this.db, groupId).lang, 'discordTest') }]);
  }

  private userTarget(userId: number, url: string): Target {
    return { key: `user ${userId}`, url, clear: () => this.db.prepare('UPDATE users SET discord_webhook = NULL WHERE id = ? AND discord_webhook = ?').run(userId, url) };
  }

  private groupTarget(groupId: number, url: string): Target {
    return { key: `group ${groupId}`, url, clear: () => this.db.prepare('UPDATE groups SET discord_webhook = NULL WHERE id = ? AND discord_webhook = ?').run(groupId, url) };
  }

  /** Posts the items in messages of up to 10 embeds; a webhook Discord no longer knows is removed. True when all went out. */
  private async send(target: Target, items: Item[]): Promise<boolean> {
    let ok = true;
    for (let i = 0; i < items.length; i += EMBEDS_PER_MESSAGE) {
      const chunk = items.slice(i, i + EMBEDS_PER_MESSAGE);
      const mentions = [...new Set(chunk.map((it) => it.mention).filter((m): m is string => !!m && DISCORD_ID.test(m)))];
      const message: DiscordMessage = {
        ...(mentions.length ? { content: mentions.map((m) => `<@${m}>`).join(' ') } : {}),
        embeds: chunk.map((it) => ({
          title: it.payload.title.slice(0, 256),
          description: it.payload.body.slice(0, 4096),
          color: COLORS[it.kind],
          ...(config.publicUrl ? { url: config.publicUrl + it.payload.url } : {}),
        })),
        allowed_mentions: { parse: [], users: mentions },
      };
      try {
        let res = await this.sender(target.url, message);
        if (res.status === 429 && (res.retryAfter ?? 0) <= MAX_RETRY_AFTER) {
          await new Promise((r) => setTimeout(r, Math.ceil((res.retryAfter ?? 1) * 1000)));
          res = await this.sender(target.url, message);
        }
        if (res.status === 401 || res.status === 404) {
          target.clear();
          this.log?.info({ target: target.key }, 'discord webhook gone, removed');
          return false;
        }
        if (res.status < 200 || res.status >= 300) {
          ok = false;
          this.log?.warn({ target: target.key, status: res.status }, 'discord send failed');
        }
      } catch (err) {
        ok = false;
        this.log?.warn({ target: target.key, err: (err as Error).message }, 'discord send failed');
      }
    }
    return ok;
  }
}

/** Whether the group's channel wants this notification now (launch reminders from its lead time on). */
function channelWants(n: ChannelNotification, prefs: ChannelPrefs, t: number): boolean {
  switch (n.kind) {
    case 'attack':
      return prefs.attacks;
    case 'plan':
      return prefs.plans;
    case 'launch':
      return prefs.launch && n.time - prefs.leadMinutes * 60 <= t;
  }
}
