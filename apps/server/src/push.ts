import { techName } from '@pr0hub/core/tech';
import type { FastifyBaseLogger } from 'fastify';
import webpush from 'web-push';
import type { SessionUser } from './auth.js';
import { config } from './config.js';
import { resolveGroup } from './context.js';
import { now, type DB } from './db.js';
import type { EventBus } from './events.js';
import { GroupDebounce, groupUniverse, SENT_KEEP, TICK_AHEAD, TICK_MS } from './notify.js';
import { notificationsFor, type ChannelNotification, type Notification } from './repo/notifications.js';

/**
 * Web push: the notifications of the bell (repo/notifications.ts) sent to the members' browsers and phones, each once.
 * Data events of a group (a paste with fleet movements, a plan, a comment) deliver for that group, a ticker delivers
 * the launch reminders and affordable buildings. Every member gets what `notificationsFor` lists for them as the viewer (group context and fleet
 * sharing apply), filtered by their settings. The push services only see the encrypted payload.
 */

/** Which notifications a user wants pushed (all of their devices) or sent to Discord; the bell lists everything. */
export interface PushPrefs {
  /** hostile fleets heading for the user */
  attackSelf: boolean;
  /** hostile fleets heading for other members */
  attackOthers: boolean;
  invites: boolean;
  comments: boolean;
  launch: boolean;
  /** the next level of a building the user waits for is affordable */
  buildings: boolean;
  /** launch reminder this many minutes before */
  leadMinutes: number;
}

export const PUSH_DEFAULTS: PushPrefs = { attackSelf: true, attackOthers: false, invites: true, comments: true, launch: true, buildings: true, leadMinutes: 5 };
export const LEAD_MINUTES = [1, 2, 5, 10, 15, 30];
const FLAGS = ['attackSelf', 'attackOthers', 'invites', 'comments', 'launch', 'buildings'] as const;

/** The user's settings for push (`push_prefs`) or for their Discord webhook (`discord_prefs`). */
export function pushPrefs(db: DB, userId: number, column: 'push_prefs' | 'discord_prefs' = 'push_prefs'): PushPrefs {
  const raw = db.prepare(`SELECT ${column} FROM users WHERE id = ?`).pluck().get(userId) as string | null | undefined;
  return { ...PUSH_DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<PushPrefs>) : {}) };
}

/** Settings from a request body: booleans and a lead time from `LEAD_MINUTES`, the rest as before. */
export function parsePushPrefs(before: PushPrefs, body: Record<string, unknown>): PushPrefs | null {
  const next = { ...before };
  for (const k of FLAGS) if (body[k] !== undefined) next[k] = body[k] === true;
  if (body.leadMinutes !== undefined) {
    if (!LEAD_MINUTES.includes(Number(body.leadMinutes))) return null;
    next.leadMinutes = Number(body.leadMinutes);
  }
  return next;
}

export interface PushPayload {
  title: string;
  body: string;
  /** page of the hub to open on a click */
  url: string;
  /** a newer notification with the same tag replaces the older one */
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one payload to one subscription; resolves with the push service's status code (errors carry `statusCode`). */
export type PushSender = (target: PushTarget, payload: string, opts: { ttl: number; urgency: 'normal' | 'high'; vapid: Vapid }) => Promise<number>;

interface Vapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

const webPushSender: PushSender = async (target, payload, opts) => {
  const res = await webpush.sendNotification(target, payload, {
    TTL: opts.ttl,
    urgency: opts.urgency,
    vapidDetails: { subject: opts.vapid.subject, publicKey: opts.vapid.publicKey, privateKey: opts.vapid.privateKey },
  });
  return res.statusCode;
};

type Subscription = { id: number; endpoint: string; p256dh: string; auth: string };

export interface PushOptions {
  /** `mailto:` or `https:` contact for the push services; empty: push is off */
  contact?: string;
  sender?: PushSender;
  log?: Pick<FastifyBaseLogger, 'warn' | 'info'>;
}

export class PushService {
  readonly enabled: boolean;
  private vapid: Vapid | null = null;
  private sender: PushSender;
  private debounce: GroupDebounce;
  private log: PushOptions['log'];

  constructor(
    private db: DB,
    private bus: EventBus,
    opts: PushOptions = {},
  ) {
    const contact = opts.contact ?? config.pushContact;
    this.enabled = /^(mailto:|https:\/\/)\S+$/.test(contact);
    this.sender = opts.sender ?? webPushSender;
    this.log = opts.log;
    if (this.enabled) this.vapid = { subject: contact, ...this.keys() };
    this.debounce = new GroupDebounce((groupId) => this.deliver(groupId).catch((err) => this.log?.warn({ err, groupId }, 'push delivery failed')));
  }

  /** The server's VAPID key pair, created on the first start. */
  private keys(): { publicKey: string; privateKey: string } {
    const row = this.db.prepare('SELECT public_key, private_key FROM push_vapid WHERE id = 1').get() as { public_key: string; private_key: string } | undefined;
    if (row) return { publicKey: row.public_key, privateKey: row.private_key };
    const keys = webpush.generateVAPIDKeys();
    this.db.prepare('INSERT OR IGNORE INTO push_vapid (id, public_key, private_key) VALUES (1, ?, ?)').run(keys.publicKey, keys.privateKey);
    return this.keys();
  }

  get publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  /** Delivers after data events of a group (debounced); returns the unsubscribe. */
  listen(): () => void {
    if (!this.enabled) return () => {};
    return this.debounce.listen(this.bus);
  }

  /** Launch reminders and affordable buildings: checks the groups with plan fleets or building alerts of push users; returns the stop. */
  start(): () => void {
    if (!this.enabled) return () => {};
    const timer = setInterval(() => {
      this.tick().catch((err) => this.log?.warn({ err }, 'push reminders failed'));
    }, TICK_MS);
    return () => clearInterval(timer);
  }

  async tick(t = now()) {
    const groups = this.db
      .prepare(
        `SELECT DISTINCT a.group_id FROM attack_plans a JOIN attack_plan_fleets f ON f.plan_id = a.id
         WHERE a.status IN ('planning', 'launched') AND a.time_precision = 'exact' AND a.target_time > ? AND a.target_time < ?
           AND f.status IN ('invited', 'ready') AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = f.user_id)
         UNION SELECT b.group_id FROM building_alerts b WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = b.user_id)`,
      )
      .pluck()
      .all(t, t + TICK_AHEAD) as number[];
    for (const g of groups) await this.deliver(g, t);
  }

  /** Stops pending deliveries (app close). */
  close() {
    this.debounce.close();
  }

  /**
   * Pushes the group's notifications every member with a subscription has not got yet. Comments and invitations are
   * not pushed while the member has a hub tab of the group in front (they see the bell), but count as sent.
   */
  async deliver(groupId: number, t = now()) {
    if (!this.enabled) return;
    const universe = groupUniverse(this.db, groupId);
    if (!universe) return;
    const users = this.db
      .prepare(
        `SELECT u.id, u.username, u.is_admin, u.lang, u.date_format FROM group_members m JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ? AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)`,
      )
      .all(groupId) as { id: number; username: string; is_admin: number; lang: string; date_format: string }[];
    if (!users.length) return;
    const watching = new Set(this.bus.presence(groupId).filter((m) => m.active).map((m) => m.userId));
    const mark = this.db.prepare('INSERT OR IGNORE INTO push_sent (user_id, key, sent_at) VALUES (?, ?, ?)');
    this.db.prepare('DELETE FROM push_sent WHERE sent_at < ?').run(t - SENT_KEEP);
    const outbox: { userId: number; payload: PushPayload; ttl: number; urgency: 'normal' | 'high' }[] = [];
    for (const row of users) {
      const user: SessionUser = { id: row.id, username: row.username, isAdmin: !!row.is_admin, lang: row.lang, dateFormat: row.date_format };
      const ctx = resolveGroup(this.db, user, universe, groupId);
      const prefs = pushPrefs(this.db, user.id);
      for (const n of notificationsFor(this.db, ctx, t)) {
        if (!wanted(n, prefs, user.id, t)) continue;
        // marked first: a delivery running at the same time (event and tick) sends it only once
        if (!mark.run(user.id, n.id, t).changes) continue;
        if ((n.kind === 'comment' || n.kind === 'invite') && watching.has(user.id)) continue;
        outbox.push({
          userId: user.id,
          payload: payloadOf(n, user.lang === 'en' ? 'en' : 'de', universe.slug, universe.settings.timezone, groupId, t),
          ttl: Math.max(60, n.kind === 'comment' || n.kind === 'building' ? 86400 : n.time - t),
          urgency: n.kind === 'attack' || n.kind === 'launch' ? 'high' : 'normal',
        });
      }
    }
    for (const m of outbox) await this.sendTo(m.userId, m.payload, m);
  }

  /** Sends to all devices of a user; subscriptions the push service no longer knows are removed. Returns the devices reached. */
  async sendTo(userId: number, payload: PushPayload, opts: { ttl: number; urgency: 'normal' | 'high' } = { ttl: 3600, urgency: 'normal' }): Promise<number> {
    if (!this.vapid) return 0;
    const subs = this.db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId) as Subscription[];
    const body = JSON.stringify(payload);
    let reached = 0;
    for (const s of subs) {
      try {
        await this.sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { ...opts, vapid: this.vapid });
        this.db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?').run(now(), s.id);
        reached++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        else this.log?.warn({ status, err: (err as Error).message }, 'push send failed');
      }
    }
    return reached;
  }
}

/** Whether the user wants this notification pushed now (launch reminders from their lead time on). */
export function wanted(n: Notification, prefs: PushPrefs, userId: number, t: number): boolean {
  switch (n.kind) {
    case 'attack':
      return n.userId === userId ? prefs.attackSelf : prefs.attackOthers;
    case 'invite':
      return prefs.invites;
    case 'comment':
      return prefs.comments;
    case 'launch':
      return prefs.launch && n.time - prefs.leadMinutes * 60 <= t;
    case 'building':
      return prefs.buildings;
  }
}

/** Texts of the push notifications (the server builds them, so they live here, not in the web app's locales). */
const DE = {
  attack: (m: string) => `⚔ Angriff auf ${m}`,
  acs: (n: number) => `Verbandsangriff (${n} Flotten)`,
  from: 'von',
  invite: (m: string) => `✉ Einladung von ${m}`,
  raid: 'Raid-Planer',
  hold: 'Halten',
  around: (t: string) => `gegen ${t}`,
  unknown: 'Ziel noch offen',
  comment: (m: string, on: string) => `💬 ${m} zu ${on}`,
  more: (n: number) => `(${n} neue)`,
  launch: (min: number) => `🚀 Start in ${min} Min`,
  launchBody: (from: string, to: string, at: string) => `${from} → ${to} · Start ${at}`,
  launchOf: (m: string, min: number) => `🚀 ${m}: Start in ${min} Min`,
  plan: (m: string) => `📋 Neuer Plan von ${m}`,
  building: (name: string, level: number) => `🏗 ${name} ${level} baubar`,
  buildingBody: (planet: string) => `Rohstoffe auf ${planet} reichen für die nächste Stufe`,
  missions: { 1: 'Angreifen', 2: 'Verbandsangriff', 6: 'Spionage', 9: 'Zerstören', 10: 'Raketenangriff' } as Record<number, string>,
  hostile: 'Feindliche Flotte',
  test: { title: 'pr0game Hub', body: 'Push-Benachrichtigungen funktionieren auf diesem Gerät.' },
  discordTest: { title: 'pr0game Hub', body: 'Discord-Benachrichtigungen kommen hier an.' },
};
/** Same keys as German: a missing text fails the typecheck. */
const EN: typeof DE = {
  attack: (m: string) => `⚔ Attack on ${m}`,
  acs: (n: number) => `ACS attack (${n} fleets)`,
  from: 'from',
  invite: (m: string) => `✉ Invitation from ${m}`,
  raid: 'Raid planner',
  hold: 'Hold',
  around: (t: string) => `around ${t}`,
  unknown: 'target still open',
  comment: (m: string, on: string) => `💬 ${m} on ${on}`,
  more: (n: number) => `(${n} new)`,
  launch: (min: number) => `🚀 Launch in ${min} min`,
  launchBody: (from: string, to: string, at: string) => `${from} → ${to} · launch ${at}`,
  launchOf: (m: string, min: number) => `🚀 ${m}: launch in ${min} min`,
  plan: (m: string) => `📋 New plan by ${m}`,
  building: (name: string, level: number) => `🏗 ${name} ${level} can be built`,
  buildingBody: (planet: string) => `Resources on ${planet} are enough for the next level`,
  missions: { 1: 'Attack', 2: 'ACS attack', 6: 'Espionage', 9: 'Destroy', 10: 'Missile attack' } as Record<number, string>,
  hostile: 'Hostile fleet',
  test: { title: 'pr0game Hub', body: 'Push notifications work on this device.' },
  discordTest: { title: 'pr0game Hub', body: 'Discord notifications arrive here.' },
};
const TEXT = { de: DE, en: EN };
export type PushLang = keyof typeof TEXT;

export const testPayload = (lang: PushLang, kind: 'test' | 'discordTest' = 'test'): PushPayload => ({ ...TEXT[lang][kind], url: `${config.basePath}/account`, tag: 'test' });

const coords = (g: number, s: number, p: number, moon: boolean) => `${moon ? '☾ ' : ''}[${g}:${s}:${p}]`;

/**
 * Title, text and target of a notification in the user's language, times in the universe's time zone. `channel`: for
 * a group's channel (launches name the member).
 */
export function payloadOf(n: Notification | ChannelNotification, lang: PushLang, uni: string, timeZone: string, groupId: number, t = now(), channel = false): PushPayload {
  const L = TEXT[lang];
  const clock = (epoch: number, opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' }) =>
    new Intl.DateTimeFormat(lang, { timeZone, hourCycle: 'h23', ...opts }).format(new Date(epoch * 1000));
  const link = (path: string, query: Record<string, string | number> = {}) =>
    `${config.basePath}/${uni}/${path}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])), group: String(groupId) })}`;
  const base = { tag: n.id };
  const day = { weekday: 'short', day: '2-digit', month: '2-digit' } as const;
  const planLine = (p: { g: number | null; s: number | null; p: number | null; planet_type: 'planet' | 'moon'; mission: 'attack' | 'hold'; time_precision: 'day' | 'hour' | 'exact' }, time: number) => {
    const when =
      p.time_precision === 'day'
        ? clock(time, day)
        : p.time_precision === 'hour'
          ? L.around(clock(time, { ...day, hour: '2-digit', minute: '2-digit' }))
          : clock(time, { ...day, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const target = p.g != null ? coords(p.g, p.s!, p.p!, p.planet_type === 'moon') : L.unknown;
    return [p.mission === 'hold' ? L.hold : L.raid, target, when].join(' · ');
  };
  switch (n.kind) {
    case 'attack': {
      const f = n.fleet;
      const what = n.fleets > 1 ? L.acs(n.fleets) : (f.mission != null && L.missions[f.mission]) || f.missionName || L.hostile;
      const to = f.to ? coords(f.to.coords.g, f.to.coords.s, f.to.coords.p, f.to.type === 'moon') : '';
      const who = f.player ?? f.fromPlayer?.name;
      const from = `${L.from} ${who ? who + ' ' : ''}${coords(f.from.coords.g, f.from.coords.s, f.from.coords.p, f.from.type === 'moon')}`;
      return { ...base, title: L.attack(n.member), body: [clock(n.time), to, what, from].filter(Boolean).join(' · '), url: link('fleet') };
    }
    case 'invite': {
      return { ...base, title: L.invite(n.member), body: planLine(n.plan, n.time), url: link('raid-planner', { plan: n.plan.id }) };
    }
    case 'plan':
      return { ...base, title: L.plan(n.member), body: planLine(n.plan, n.plan.target_time), url: link('raid-planner', { plan: n.plan.id }) };
    case 'comment': {
      const th = n.thread;
      const on = 'player' in th ? th.name : `${th.owner ? th.owner + ' ' : ''}${coords(th.g, th.s, th.p, th.type === 'moon')}`;
      const url = 'player' in th ? link(`player/${th.player}`) : link('spy', { c: `${th.g}:${th.s}:${th.p}`, type: th.type });
      return { ...base, title: L.comment(n.member, on), body: n.count > 1 ? `${n.excerpt} ${L.more(n.count)}` : n.excerpt, url };
    }
    case 'launch': {
      const p = n.plan;
      const min = Math.max(1, Math.round((n.time - t) / 60));
      const body = L.launchBody(coords(n.from.g, n.from.s, n.from.p, n.from.type === 'moon'), coords(p.g, p.s, p.p, p.planet_type === 'moon'), clock(n.time));
      return { ...base, title: channel ? L.launchOf(n.member, min) : L.launch(min), body, url: link('raid-planner', { plan: p.id }) };
    }
    case 'building': {
      const p = n.planet;
      const planet = `${p.name ? p.name + ' ' : ''}${coords(p.g, p.s, p.p, p.type === 'moon')}`;
      return { ...base, title: L.building(techName(n.element, lang), n.level), body: L.buildingBody(planet), url: link('buildings', { c: `${p.g}:${p.s}:${p.p}`, type: p.type }) };
    }
  }
}
