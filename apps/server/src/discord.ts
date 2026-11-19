import type { FastifyBaseLogger } from 'fastify';
import type { SessionUser } from './auth.js';
import { localToEpoch } from '@pr0hub/core';
import { config } from './config.js';
import { isRunning, resolveGroup, universeNow, type GroupContext, type Universe } from './context.js';
import { now, type DB } from './db.js';
import type { EventBus } from './events.js';
import { AlertSchedule, GroupDebounce, groupUniverse, dropHeld, dueHeld, heldBy, heldTargets, hold, quietBreakOf, sentHeld, SENT_KEEP, storageMuted, TICK_AHEAD, TICK_MS } from './notify.js';
import {
  accessRequestAdmins, accessRequestPayload, LEAD_MINUTES, payloadOf, pushPrefs, samplePayload, SPY_MISSION, testPayload, wanted, type ParserSample, type PushLang, type PushPayload,
} from './push.js';
import { channelNotificationsFor, notificationsFor, type ChannelNotification, type Notification } from './repo/notifications.js';
import { addDays, dayOf } from './repo/achievements.js';
import { recap, type Recap } from './repo/recap.js';
import { recapMessage } from './recapText.js';

/**
 * Discord: the bell's notifications sent to a user's own webhook (settings like push, see push.ts), and attacks on
 * members, new plans and launch reminders to the group's channel webhook (a channel of the alliance's members only),
 * mentioning members who gave their Discord id.
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
  /** hostile espionage counts as an attack */
  spying: boolean;
  /** the recap of last week every Monday morning */
  recap: boolean;
}

export const CHANNEL_DEFAULTS: ChannelPrefs = { attacks: true, plans: true, launch: true, leadMinutes: 5, lang: 'de', spying: true, recap: false };
const CHANNEL_FLAGS = ['attacks', 'plans', 'launch', 'spying', 'recap'] as const;

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
  /** `attachment://<name>` for a file sent with the message */
  image?: { url: string };
}

export interface DiscordMessage {
  content?: string;
  embeds: DiscordEmbed[];
  allowed_mentions: { parse: []; users: string[] };
}

/** A file posted with a message (a PNG image). */
export interface DiscordFile {
  name: string;
  data: Buffer;
}

/** Posts one message to a webhook; resolves with the HTTP status (`retryAfter` in seconds for 429). */
export type DiscordSender = (url: string, message: DiscordMessage, files?: DiscordFile[]) => Promise<{ status: number; retryAfter?: number }>;

const fetchSender: DiscordSender = async (url, message, files) => {
  let payload: string | FormData = JSON.stringify(message);
  if (files?.length) {
    const form = new FormData();
    form.set('payload_json', payload);
    files.forEach((f, i) => form.set(`files[${i}]`, new Blob([new Uint8Array(f.data)], { type: 'image/png' }), f.name));
    payload = form;
  }
  const res = await fetch(url, {
    method: 'POST',
    ...(typeof payload === 'string' ? { headers: { 'content-type': 'application/json' } } : {}),
    body: payload,
    signal: AbortSignal.timeout(files?.length ? 30_000 : 10_000),
  });
  if (res.status !== 429) return { status: res.status };
  const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
  return { status: 429, retryAfter: body.retry_after ?? Number(res.headers.get('retry-after') ?? 1) };
};

/** Discord takes this many embeds per message. */
const EMBEDS_PER_MESSAGE = 10;
/** A rate limit is waited for once if it ends within this many seconds. */
const MAX_RETRY_AFTER = 10;
/** Colour of the recap's embed: the hub's accent. */
const RECAP_COLOR = 0xf2683c;
/** The weekly recap goes out on Mondays from this hour on (universe's time zone). */
export const RECAP_HOUR = 9;
const COLORS: Record<ChannelNotification['kind'] | Notification['kind'] | 'access', number> = {
  attack: 0xe74c3c, launch: 0xf39c12, invite: 0x3498db, plan: 0x3498db, comment: 0x95a5a6, building: 0x2ecc71, fleet: 0x6e8eea, storage: 0xe67e22, settlement: 0xf1c40f, buildorder: 0x27ae60, phalanx: 0x9b59b6, expedition: 0x6e8eea, access: 0x1abc9c,
};

type Item = { kind: keyof typeof COLORS; payload: PushPayload; mention?: string | null };
/** Held notifications are sent at the end of the quiet hours when they last at least this long (seconds). */
const HELD_TTL = 86400;
type Target = { key: string; url: string; clear: () => void };

export interface DiscordOptions {
  sender?: DiscordSender;
  log?: Pick<FastifyBaseLogger, 'warn' | 'info'>;
}

export class DiscordService {
  private sender: DiscordSender;
  private debounce: GroupDebounce;
  private alerts: AlertSchedule;
  private log: DiscordOptions['log'];

  constructor(
    private db: DB,
    private bus: EventBus,
    opts: DiscordOptions = {},
  ) {
    this.sender = opts.sender ?? fetchSender;
    this.log = opts.log;
    this.debounce = new GroupDebounce((groupId) => this.deliver(groupId).catch((err) => this.log?.warn({ err, groupId }, 'discord delivery failed')));
    this.alerts = new AlertSchedule(db);
  }

  /** Delivers after data events of a group (debounced); returns the unsubscribe. */
  listen(): () => void {
    return this.debounce.listen(this.bus);
  }

  /**
   * Launch reminders, affordable buildings, fleet alerts and full storages: checks the groups with plan fleets ahead for
   * a member's or the group's webhook and, when due, the other groups of members with a webhook; returns the stop.
   */
  start(): () => void {
    const timer = setInterval(() => {
      this.tick().catch((err) => this.log?.warn({ err }, 'discord reminders failed'));
    }, TICK_MS);
    return () => clearInterval(timer);
  }

  async tick(t = now()) {
    await this.flushHeld(t);
    await this.weeklyRecaps(t);
    const groups = this.db
      .prepare(
        `SELECT DISTINCT a.group_id FROM attack_plans a JOIN attack_plan_fleets f ON f.plan_id = a.id JOIN groups g ON g.id = a.group_id
         JOIN users u ON u.id = f.user_id
         WHERE a.status IN ('planning', 'launched') AND a.time_precision = 'exact' AND a.target_time > ? AND a.target_time < ?
           AND f.status IN ('invited', 'ready') AND (u.discord_webhook IS NOT NULL OR g.discord_webhook IS NOT NULL)`,
      )
      .pluck()
      .all(t, t + TICK_AHEAD) as number[];
    // groups of members with a webhook (building and fleet alerts, storages) only when one of them may be ready (see AlertSchedule)
    const alerts = this.db
      .prepare('SELECT DISTINCT m.group_id FROM group_members m JOIN users u ON u.id = m.user_id WHERE u.discord_webhook IS NOT NULL')
      .pluck()
      .all() as number[];
    for (const g of alerts) if (!groups.includes(g) && this.alerts.due(g, t)) groups.push(g);
    // one group per try: a group that fails must not keep the groups after it from their reminders
    for (const g of groups) {
      try {
        await this.deliver(g, t);
      } catch (err) {
        this.log?.warn({ err, groupId: g }, 'discord delivery failed');
      }
    }
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
    // a universe before its start or after its end sends nothing
    if (!universe || !isRunning(universe, t)) return;
    // when the ticks look at the group's building and fleet alerts and storages again (also when nobody here gets anything)
    this.alerts.plan(groupId, universe, t);
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
      const rules = { storageMuted: storageMuted(this.db, groupId, user.id) };
      for (const n of notificationsFor(this.db, ctx, t)) {
        if (!wanted(n, prefs, user.id, t, rules)) continue;
        if (!mark.run(`u:${user.id}`, n.id, t).changes) continue;
        if ((n.kind === 'comment' || n.kind === 'invite') && watching.has(user.id)) continue;
        const payload = payloadOf(n, lang, universe.slug, tz, groupId, t);
        // quiet hours of the webhook: kept until they end, while the notification still matters
        if (heldBy(prefs.quiet, quietBreakOf(n, user.id), t)) hold(this.db, `u:${user.id}`, n.kind, payload, t + heldTtl(n, t), t);
        else items.push({ kind: n.kind, payload });
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

  private flushing = false;

  /**
   * Sends what the quiet hours of a member's webhook held back, once they are over (or were switched off). Rows are
   * deleted per message after Discord accepted it; one flush at a time.
   */
  async flushHeld(t = now()) {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const target of heldTargets(this.db, 'u')) {
        const userId = Number(target.slice(2));
        const url = this.db.prepare('SELECT discord_webhook FROM users WHERE id = ?').pluck().get(userId) as string | null | undefined;
        if (!url) {
          dropHeld(this.db, target);
          continue;
        }
        if (heldBy(pushPrefs(this.db, userId, 'discord_prefs').quiet, null, t)) continue;
        const rows = dueHeld(this.db, target, t);
        for (let i = 0; i < rows.length; i += EMBEDS_PER_MESSAGE) {
          const chunk = rows.slice(i, i + EMBEDS_PER_MESSAGE);
          const items = chunk.map((r) => ({ kind: r.kind in COLORS ? (r.kind as Item['kind']) : 'comment', payload: JSON.parse(r.payload) as PushPayload }));
          if (await this.send(this.userTarget(userId, url), items)) sentHeld(this.db, chunk);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Tells the global admins with a webhook about a new access request. */
  async notifyAccessRequest(request: { id: number; username: string; message: string }) {
    for (const a of accessRequestAdmins(this.db, 'discord_prefs', 'discord_webhook IS NOT NULL')) {
      const url = this.db.prepare('SELECT discord_webhook FROM users WHERE id = ?').pluck().get(a.id) as string;
      await this.send(this.userTarget(a.id, url), [{ kind: 'access', payload: accessRequestPayload(a.lang === 'en' ? 'en' : 'de', request) }]);
    }
  }

  /** Tells the global admins with a webhook about a new parser sample. */
  async notifySample(sample: ParserSample) {
    for (const a of accessRequestAdmins(this.db, 'discord_prefs', 'discord_webhook IS NOT NULL', 'parserSamples')) {
      const url = this.db.prepare('SELECT discord_webhook FROM users WHERE id = ?').pluck().get(a.id) as string;
      await this.send(this.userTarget(a.id, url), [{ kind: 'access', payload: samplePayload(a.lang === 'en' ? 'en' : 'de', sample) }]);
    }
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

  /**
   * The group's recap of `period` to its channel (title and text as an embed, with `image` a PNG of it attached);
   * null without a webhook, false when Discord refused it.
   */
  async sendRecap(ctx: GroupContext, period: Recap['period'], image?: Buffer): Promise<boolean | null> {
    const url = this.db.prepare('SELECT discord_webhook FROM groups WHERE id = ?').pluck().get(ctx.groupId) as string | null;
    if (!url) return null;
    return this.postRecap(this.groupTarget(ctx.groupId, url), ctx, period, image);
  }

  /**
   * Last week's recap to the channels that want it, once per group and week: from Monday `RECAP_HOUR` on, or later in
   * the week when the server missed Monday. A universe that ended during last week gets its final recap (its last
   * week up to the end); one that ended before or had not started gets none.
   */
  async weeklyRecaps(t = now()) {
    const rows = this.db.prepare('SELECT id, discord_webhook, discord_prefs FROM groups WHERE discord_webhook IS NOT NULL').all() as { id: number; discord_webhook: string; discord_prefs: string | null }[];
    for (const row of rows) {
      if (!channelPrefs(this.db, row.id).recap) continue;
      const universe = groupUniverse(this.db, row.id);
      if (!universe) continue;
      const tz = universe.settings.timezone;
      const today = dayOf(t, tz);
      const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t * 1000)));
      if (weekday === 0 && hour < RECAP_HOUR) continue;
      const monday = addDays(today, -weekday);
      const lastMonday = addDays(monday, -7);
      // the universe ran during last week
      const weekStart = localToEpoch(`${monday} 00:00:00`, tz);
      if (universe.startsAt != null && universe.startsAt >= weekStart) continue;
      if (universe.endedAt != null && universe.endedAt < localToEpoch(`${lastMonday} 00:00:00`, tz)) continue;
      const key = `recap:${lastMonday}`;
      if (this.db.prepare('SELECT 1 FROM discord_sent WHERE target = ? AND key = ?').get(`g:${row.id}`, key)) continue;
      // marked first: a failing webhook is not tried again every tick
      this.db.prepare('INSERT OR IGNORE INTO discord_sent (target, key, sent_at) VALUES (?, ?, ?)').run(`g:${row.id}`, key, t);
      const ctx = channelContext(this.db, universe, row.id, t);
      // the context of an ended universe stands at its end: an end during last week makes that week its "this week"
      const endedLastWeek = universe.endedAt != null && universe.endedAt < weekStart;
      await this.postRecap(this.groupTarget(row.id, row.discord_webhook), ctx, endedLastWeek ? 'week' : 'lastWeek');
    }
  }

  private async postRecap(target: Target, ctx: GroupContext, period: Recap['period'], image?: Buffer): Promise<boolean> {
    const data = recap(this.db, ctx, period);
    const { title, body } = recapMessage(data, channelPrefs(this.db, ctx.groupId).lang);
    const link = config.publicUrl ? `${config.publicUrl}${config.basePath}/${ctx.universe.slug}/health?tab=recap&group=${ctx.groupId}` : undefined;
    const message: DiscordMessage = {
      embeds: [{ title: title.slice(0, 256), description: body.slice(0, 4096), color: RECAP_COLOR, ...(link ? { url: link } : {}), ...(image ? { image: { url: 'attachment://recap.png' } } : {}) }],
      allowed_mentions: { parse: [], users: [] },
    };
    return (await this.post(target, message, image ? [{ name: 'recap.png', data: image }] : undefined)) ?? false;
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
      const res = await this.post(target, message);
      if (res === null) return false;
      if (!res) ok = false;
    }
    return ok;
  }

  /** Posts one message (one retry after a short rate limit); null when the webhook is gone (it is removed then). */
  private async post(target: Target, message: DiscordMessage, files?: DiscordFile[]): Promise<boolean | null> {
    try {
      let res = await this.sender(target.url, message, files);
      if (res.status === 429 && (res.retryAfter ?? 0) <= MAX_RETRY_AFTER) {
        await new Promise((r) => setTimeout(r, Math.ceil((res.retryAfter ?? 1) * 1000)));
        res = await this.sender(target.url, message, files);
      }
      if (res.status === 401 || res.status === 404) {
        target.clear();
        this.log?.info({ target: target.key }, 'discord webhook gone, removed');
        return null;
      }
      if (res.status < 200 || res.status >= 300) {
        this.log?.warn({ target: target.key, status: res.status }, 'discord send failed');
        return false;
      }
      return true;
    } catch (err) {
      this.log?.warn({ target: target.key, err: (err as Error).message }, 'discord send failed');
      return false;
    }
  }
}

/** A group's context without a member (for what goes to its channel). */
function channelContext(db: DB, universe: Universe, groupId: number, t: number): GroupContext {
  const g = db.prepare('SELECT name, tag FROM groups WHERE id = ?').get(groupId) as { name: string; tag: string | null };
  const user: SessionUser = { id: 0, username: '', isAdmin: false, lang: 'de', dateFormat: 'de' };
  return { user, universe, groupId, groupName: g.name, groupTag: g.tag, role: 'member', now: universeNow(universe, t) };
}

/** Whether the group's channel wants this notification now (launch reminders from its lead time on). */
function channelWants(n: ChannelNotification, prefs: ChannelPrefs, t: number): boolean {
  switch (n.kind) {
    case 'attack':
      return prefs.attacks && (prefs.spying || n.fleet.mission !== SPY_MISSION);
    case 'plan':
      return prefs.plans;
    case 'launch':
      return prefs.launch && n.time - prefs.leadMinutes * 60 <= t;
  }
}

/** How long a notification held back by quiet hours still matters: events with a time until then, the rest a day. */
function heldTtl(n: Notification, t: number): number {
  return Math.max(60, n.kind === 'attack' || n.kind === 'launch' || n.kind === 'invite' || n.kind === 'fleet' ? n.time - t : HELD_TTL);
}
