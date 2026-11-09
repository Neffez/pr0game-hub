import type { FleetBody } from '@pr0hub/core';
import { STORAGE, techName } from '@pr0hub/core/tech';
import type { FastifyBaseLogger } from 'fastify';
import webpush from 'web-push';
import type { SessionUser } from './auth.js';
import { config } from './config.js';
import { isRunning, resolveGroup } from './context.js';
import { now, type DB } from './db.js';
import type { EventBus } from './events.js';
import {
  AlertSchedule, GroupDebounce, groupUniverse, heldBy, heldTargets, hold, parseQuiet, quietBreakOf, SENT_KEEP, storageMuted, storedQuiet, takeHeld, TICK_AHEAD, TICK_MS,
  type QuietBreak, type QuietHours,
} from './notify.js';
import { notificationsFor, type ChannelNotification, type Notification } from './repo/notifications.js';

/**
 * Web push: the notifications of the bell (repo/notifications.ts) sent to the members' browsers and phones, each once.
 * Data events of a group (a paste with fleet movements, a plan, a comment) deliver for that group, a ticker delivers
 * the launch reminders, affordable buildings and full storages. Every member gets what `notificationsFor` lists for them as the viewer (group context and fleet
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
  /** an own fleet the user set an alert for arrives (or is about to) */
  fleets: boolean;
  /** a storage on one of the user's planets is full */
  storage: boolean;
  /** the next step of the user's build order on a planet can start */
  buildOrder: boolean;
  /** a hostile sensor phalanx newly known to reach one of the user's planets */
  phalanx: boolean;
  /** a loot settlement the user takes part in was finalized and they have deliveries to send or get */
  settlements: boolean;
  /** someone requests access on the login page (global admins) */
  accessRequests: boolean;
  /** a member sent a page the hub could not read as a parser sample (global admins) */
  parserSamples: boolean;
  /** launch reminder this many minutes before */
  leadMinutes: number;
  /** hostile espionage counts as an attack (off: only fleets that are not spying) */
  spying: boolean;
  /** comments only when they mention the user */
  mentionsOnly: boolean;
  /** quiet hours of the user's Discord webhook; push devices keep their own (`push_subscriptions.quiet`), always null there */
  quiet: QuietHours | null;
}

export const PUSH_DEFAULTS: PushPrefs = {
  attackSelf: true, attackOthers: false, invites: true, comments: true, launch: true, buildings: true, fleets: true, storage: true, buildOrder: true, phalanx: true, settlements: true, accessRequests: true, parserSamples: true, leadMinutes: 5,
  spying: true, mentionsOnly: false, quiet: null,
};
export const LEAD_MINUTES = [1, 2, 5, 10, 15, 30];
const FLAGS = [
  'attackSelf', 'attackOthers', 'invites', 'comments', 'launch', 'buildings', 'fleets', 'storage', 'buildOrder', 'phalanx', 'settlements', 'accessRequests', 'parserSamples', 'spying', 'mentionsOnly',
] as const;

/** The user's settings for push (`push_prefs`) or for their Discord webhook (`discord_prefs`). */
export function pushPrefs(db: DB, userId: number, column: 'push_prefs' | 'discord_prefs' = 'push_prefs'): PushPrefs {
  const raw = db.prepare(`SELECT ${column} FROM users WHERE id = ?`).pluck().get(userId) as string | null | undefined;
  return { ...PUSH_DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<PushPrefs>) : {}) };
}

/**
 * Settings from a request body: booleans and a lead time from `LEAD_MINUTES`, the rest as before.
 * `quiet`: the quiet hours are part of these settings (Discord webhook).
 */
export function parsePushPrefs(before: PushPrefs, body: Record<string, unknown>, quiet = false): PushPrefs | null {
  const next = { ...before };
  if (quiet && body.quiet !== undefined) {
    const q = parseQuiet(body.quiet);
    if (q === undefined) return null;
    next.quiet = q;
  }
  if (!quiet) next.quiet = null;
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

type Subscription = { id: number; endpoint: string; p256dh: string; auth: string; quiet: string | null };

export interface PushOptions {
  /** `mailto:` or `https:` contact for the push services; empty: push is off */
  contact?: string;
  sender?: PushSender;
  log?: Pick<FastifyBaseLogger, 'warn' | 'info'>;
  /** wait after a group's last data event before delivering (default 2 s; tests shorten it) */
  debounceMs?: number;
}

export class PushService {
  readonly enabled: boolean;
  private vapid: Vapid | null = null;
  private sender: PushSender;
  private debounce: GroupDebounce;
  private alerts: AlertSchedule;
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
    this.debounce = new GroupDebounce((groupId) => this.deliver(groupId).catch((err) => this.log?.warn({ err, groupId }, 'push delivery failed')), opts.debounceMs);
    this.alerts = new AlertSchedule(db);
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

  /**
   * Launch reminders, affordable buildings, fleet alerts and full storages: checks the groups with plan fleets of push
   * users and, when due, the other groups of push users; returns the stop.
   */
  start(): () => void {
    if (!this.enabled) return () => {};
    const timer = setInterval(() => {
      this.tick().catch((err) => this.log?.warn({ err }, 'push reminders failed'));
    }, TICK_MS);
    return () => clearInterval(timer);
  }

  async tick(t = now()) {
    await this.flushHeld(t);
    const groups = this.db
      .prepare(
        `SELECT DISTINCT a.group_id FROM attack_plans a JOIN attack_plan_fleets f ON f.plan_id = a.id
         WHERE a.status IN ('planning', 'launched') AND a.time_precision = 'exact' AND a.target_time > ? AND a.target_time < ?
           AND f.status IN ('invited', 'ready') AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = f.user_id)`,
      )
      .pluck()
      .all(t, t + TICK_AHEAD) as number[];
    // groups of push users (building and fleet alerts, storages) only when one of them may be ready (see AlertSchedule)
    const alerts = this.db
      .prepare('SELECT DISTINCT m.group_id FROM group_members m WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = m.user_id)')
      .pluck()
      .all() as number[];
    for (const g of alerts) if (!groups.includes(g) && this.alerts.due(g, t)) groups.push(g);
    for (const g of groups) await this.deliver(g, t);
  }

  /** Stops pending deliveries (app close). */
  close() {
    this.debounce.close();
  }

  /** Tells the global admins with a subscription about a new access request. */
  async notifyAccessRequest(request: { id: number; username: string; message: string }) {
    if (!this.enabled) return;
    const admins = accessRequestAdmins(this.db, 'push_prefs', 'EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = users.id)');
    for (const a of admins) await this.sendTo(a.id, accessRequestPayload(a.lang === 'en' ? 'en' : 'de', request), { ttl: 86400, urgency: 'normal' }, { t: now(), kind: 'access', breaks: null });
  }

  /** Tells the global admins with a subscription about a new parser sample. */
  async notifySample(sample: ParserSample) {
    if (!this.enabled) return;
    const admins = accessRequestAdmins(this.db, 'push_prefs', 'EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = users.id)', 'parserSamples');
    for (const a of admins) await this.sendTo(a.id, samplePayload(a.lang === 'en' ? 'en' : 'de', sample), { ttl: 86400, urgency: 'normal' }, { t: now(), kind: 'access', breaks: null });
  }

  /**
   * Pushes the group's notifications every member with a subscription has not got yet. Comments and invitations are
   * not pushed while the member has a hub tab of the group in front (they see the bell), but count as sent.
   */
  async deliver(groupId: number, t = now()) {
    if (!this.enabled) return;
    const universe = groupUniverse(this.db, groupId);
    // a universe before its start or after its end sends nothing
    if (!universe || !isRunning(universe, t)) return;
    // when the ticks look at the group's building and fleet alerts and storages again (also when nobody here gets anything)
    this.alerts.plan(groupId, universe, t);
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
    const outbox: { userId: number; payload: PushPayload; ttl: number; urgency: 'normal' | 'high'; quiet: Quiet }[] = [];
    for (const row of users) {
      const user: SessionUser = { id: row.id, username: row.username, isAdmin: !!row.is_admin, lang: row.lang, dateFormat: row.date_format };
      const ctx = resolveGroup(this.db, user, universe, groupId);
      const prefs = pushPrefs(this.db, user.id);
      const rules = { storageMuted: storageMuted(this.db, groupId, user.id) };
      for (const n of notificationsFor(this.db, ctx, t)) {
        if (!wanted(n, prefs, user.id, t, rules)) continue;
        // marked first: a delivery running at the same time (event and tick) sends it only once
        if (!mark.run(user.id, n.id, t).changes) continue;
        if ((n.kind === 'comment' || n.kind === 'invite') && watching.has(user.id)) continue;
        outbox.push({
          userId: user.id,
          payload: payloadOf(n, user.lang === 'en' ? 'en' : 'de', universe.slug, universe.settings.timezone, groupId, t),
          ttl: Math.max(60, n.kind === 'comment' || n.kind === 'building' || n.kind === 'storage' || n.kind === 'settlement' || n.kind === 'phalanx' ? 86400 : n.time - t),
          urgency: n.kind === 'attack' || n.kind === 'launch' || n.kind === 'fleet' ? 'high' : 'normal',
          quiet: { t, kind: n.kind, breaks: quietBreakOf(n, user.id) },
        });
      }
    }
    for (const m of outbox) await this.sendTo(m.userId, m.payload, m, m.quiet);
  }

  /**
   * Sends to all devices of a user; subscriptions the push service no longer knows are removed. With `quiet`, a device
   * in its quiet hours gets it when they end (unless it breaks them). Returns the devices reached now.
   */
  async sendTo(userId: number, payload: PushPayload, opts: { ttl: number; urgency: 'normal' | 'high' } = { ttl: 3600, urgency: 'normal' }, quiet?: Quiet): Promise<number> {
    if (!this.vapid) return 0;
    const subs = this.db.prepare('SELECT id, endpoint, p256dh, auth, quiet FROM push_subscriptions WHERE user_id = ?').all(userId) as Subscription[];
    const body = JSON.stringify(payload);
    let reached = 0;
    for (const s of subs) {
      if (quiet && heldBy(storedQuiet(s.quiet), quiet.breaks, quiet.t)) hold(this.db, `p:${s.id}`, quiet.kind, payload, quiet.t + opts.ttl, quiet.t);
      else if (await this.sendSub(s, body, opts)) reached++;
    }
    return reached;
  }

  private async sendSub(s: Subscription, body: string, opts: { ttl: number; urgency: 'normal' | 'high' }): Promise<boolean> {
    try {
      await this.sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { ...opts, vapid: this.vapid! });
      this.db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?').run(now(), s.id);
      return true;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      else this.log?.warn({ status, err: (err as Error).message }, 'push send failed');
      return false;
    }
  }

  /** Sends what the quiet hours of a device held back, once they are over (or were switched off). */
  async flushHeld(t = now()) {
    if (!this.vapid) return;
    for (const target of heldTargets(this.db, 'p')) {
      const s = this.db.prepare('SELECT id, endpoint, p256dh, auth, quiet FROM push_subscriptions WHERE id = ?').get(Number(target.slice(2))) as Subscription | undefined;
      if (s && heldBy(storedQuiet(s.quiet), null, t)) continue;
      const rows = takeHeld(this.db, target, t);
      if (!s) continue;
      for (const r of rows) await this.sendSub(s, r.payload, { ttl: Math.max(60, r.expires_at - t), urgency: 'normal' });
    }
  }
}

/** For quiet hours: the time, the kind of the notification and the exception it falls under. */
type Quiet = { t: number; kind: string; breaks: QuietBreak | null };

/** Whether the user wants this notification pushed now (launch reminders and fleet alerts from their lead time on). */
export function wanted(n: Notification, prefs: PushPrefs, userId: number, t: number, rules: { storageMuted?: Set<string> } = {}): boolean {
  switch (n.kind) {
    case 'attack':
      if (!prefs.spying && n.fleet.mission === SPY_MISSION) return false;
      if (n.userId === userId) return prefs.attackSelf;
      return prefs.attackOthers;
    case 'invite':
      return prefs.invites;
    case 'comment':
      return prefs.comments && (!prefs.mentionsOnly || !!n.mention);
    case 'launch':
      return prefs.launch && n.time - prefs.leadMinutes * 60 <= t;
    case 'building':
      return prefs.buildings;
    case 'fleet':
      return prefs.fleets && n.time - n.lead * 60 <= t;
    case 'storage':
      return prefs.storage && !rules.storageMuted?.has(`${n.planet.g}:${n.planet.s}:${n.planet.p}`);
    case 'settlement':
      return prefs.settlements;
    case 'buildorder':
      return prefs.buildOrder;
    case 'phalanx':
      return prefs.phalanx;
  }
}

/** The game's espionage mission. */
export const SPY_MISSION = 6;

/** Amount in a short form (1,2 Mio. / 1.2M). */
const short = (v: number, lang: string) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(v);

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
  mention: (m: string, on: string) => `📣 ${m} erwähnt dich zu ${on}`,
  settlement: (at: string) => `Beuteabrechnung ${at}`,
  finalized: (at: string) => `💰 Beuteabrechnung ${at} festgeschrieben`,
  youSend: (to: string, what: string) => `Du schickst ${to}: ${what}`,
  youGet: (from: string, what: string) => `Du bekommst von ${from}: ${what}`,
  more: (n: number) => `(${n} neue)`,
  launch: (min: number) => `🚀 Start in ${min} Min`,
  launchBody: (from: string, to: string, at: string) => `${from} → ${to} · Start ${at}`,
  launchOf: (m: string, min: number) => `🚀 ${m}: Start in ${min} Min`,
  plan: (m: string) => `📋 Neuer Plan von ${m}`,
  building: (name: string, level: number) => `🏗 ${name} ${level} baubar`,
  research: (name: string, level: number) => `🔬 ${name} ${level} erforschbar`,
  buildingBody: (planet: string) => `Rohstoffe auf ${planet} reichen für die nächste Stufe`,
  orderBuilding: (name: string, level: number) => `📋 ${name} ${level} jetzt bauen`,
  orderResearch: (name: string, level: number) => `📋 ${name} ${level} jetzt forschen`,
  orderUnits: (n: number, name: string) => `📋 ${n}× ${name} jetzt bauen`,
  orderProd: '📋 Produktion jetzt umstellen',
  orderTransport: '📋 Transport jetzt losschicken',
  orderBody: (planet: string) => `Nächster Schritt der Bauliste auf ${planet}`,
  storage: (name: string) => `📦 ${name} voll`,
  storageBody: (planet: string, since: string) => `${planet} · seit ${since}, die Produktion steht`,
  phalanx: (who: string) => `🔭 Phalanx von ${who} erreicht dich`,
  phalanxBody: (moon: string, level: number, planets: string) => `Mond ${moon}, Stufe ${level} · erreicht ${planets}`,
  accessRequest: (name: string) => `🔑 Zugangsanfrage von ${name}`,
  sample: (name: string) => `🧩 Parser-Beispiel von ${name}`,
  sampleBody: (why: string) => `Nicht erkannte Seite (${why}), unter Admin → Parser-Beispiele`,
  fleetArrived: (what: string) => `✈ ${what}: Flotte angekommen`,
  fleetBack: (what: string) => `↩ ${what}: Flotte zurück`,
  fleetSoon: (what: string, min: number) => `⏰ ${what}: Ankunft in ${min} Min`,
  missions: {
    1: 'Angreifen', 2: 'Verbandsangriff', 3: 'Transport', 4: 'Stationieren', 5: 'Halten', 6: 'Spionage', 7: 'Kolonisieren', 8: 'Abbau',
    9: 'Zerstören', 10: 'Raketenangriff', 15: 'Expedition', 16: 'Marktplatz', 17: 'Transfer',
  } as Record<number, string>,
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
  mention: (m: string, on: string) => `📣 ${m} mentioned you on ${on}`,
  settlement: (at: string) => `loot settlement ${at}`,
  finalized: (at: string) => `💰 Loot settlement ${at} finalized`,
  youSend: (to: string, what: string) => `You send ${to}: ${what}`,
  youGet: (from: string, what: string) => `You get from ${from}: ${what}`,
  more: (n: number) => `(${n} new)`,
  launch: (min: number) => `🚀 Launch in ${min} min`,
  launchBody: (from: string, to: string, at: string) => `${from} → ${to} · launch ${at}`,
  launchOf: (m: string, min: number) => `🚀 ${m}: launch in ${min} min`,
  plan: (m: string) => `📋 New plan by ${m}`,
  building: (name: string, level: number) => `🏗 ${name} ${level} can be built`,
  research: (name: string, level: number) => `🔬 ${name} ${level} can be researched`,
  buildingBody: (planet: string) => `Resources on ${planet} are enough for the next level`,
  orderBuilding: (name: string, level: number) => `📋 Build ${name} ${level} now`,
  orderResearch: (name: string, level: number) => `📋 Research ${name} ${level} now`,
  orderUnits: (n: number, name: string) => `📋 Build ${n}× ${name} now`,
  orderProd: '📋 Change the production now',
  orderTransport: '📋 Send the transport now',
  orderBody: (planet: string) => `Next step of the build order on ${planet}`,
  storage: (name: string) => `📦 ${name} full`,
  storageBody: (planet: string, since: string) => `${planet} · since ${since}, production has stopped`,
  phalanx: (who: string) => `🔭 Phalanx of ${who} reaches you`,
  phalanxBody: (moon: string, level: number, planets: string) => `Moon ${moon}, level ${level} · reaches ${planets}`,
  accessRequest: (name: string) => `🔑 Access request from ${name}`,
  sample: (name: string) => `🧩 Parser sample from ${name}`,
  sampleBody: (why: string) => `Page not recognized (${why}), under Admin → Parser samples`,
  fleetArrived: (what: string) => `✈ ${what}: fleet arrived`,
  fleetBack: (what: string) => `↩ ${what}: fleet is back`,
  fleetSoon: (what: string, min: number) => `⏰ ${what}: arrival in ${min} min`,
  missions: {
    1: 'Attack', 2: 'ACS attack', 3: 'Transport', 4: 'Deploy', 5: 'Hold', 6: 'Espionage', 7: 'Colonize', 8: 'Harvest', 9: 'Destroy',
    10: 'Missile attack', 15: 'Expedition', 16: 'Marketplace', 17: 'Transfer',
  } as Record<number, string>,
  hostile: 'Hostile fleet',
  test: { title: 'pr0game Hub', body: 'Push notifications work on this device.' },
  discordTest: { title: 'pr0game Hub', body: 'Discord notifications arrive here.' },
};
const TEXT = { de: DE, en: EN };
export type PushLang = keyof typeof TEXT;

export const testPayload = (lang: PushLang, kind: 'test' | 'discordTest' = 'test'): PushPayload => ({ ...TEXT[lang][kind], url: `${config.basePath}/account`, tag: 'test' });

/** A request for access on the login page (global admins, outside of any alliance): opens the admin page. */
export const accessRequestPayload = (lang: PushLang, request: { id: number; username: string; message: string }): PushPayload => ({
  title: TEXT[lang].accessRequest(request.username),
  body: request.message,
  url: `${config.basePath}/admin`,
  tag: `access:${request.id}`,
});

/** A page sent as a parser sample: who sent it, why the hub found nothing (`code`, the game's `page` when known) and their note. */
export interface ParserSample {
  id: number;
  username: string;
  code: string;
  page: string | null;
  note: string | null;
}

/** A new parser sample (global admins): opens the admin page. */
export const samplePayload = (lang: PushLang, s: ParserSample): PushPayload => ({
  title: TEXT[lang].sample(s.username),
  body: [TEXT[lang].sampleBody(s.page ? `${s.code}: ${s.page}` : s.code), s.note].filter(Boolean).join(' · '),
  url: `${config.basePath}/admin`,
  tag: `sample:${s.id}`,
});

/** Global admins (id and language) with `where` who want to hear about access requests (or `flag`) by the settings in `column`. */
export function accessRequestAdmins(db: DB, column: 'push_prefs' | 'discord_prefs', where: string, flag: 'accessRequests' | 'parserSamples' = 'accessRequests') {
  const admins = db.prepare(`SELECT id, lang FROM users WHERE is_admin = 1 AND ${where}`).all() as { id: number; lang: string }[];
  return admins.filter((a) => pushPrefs(db, a.id, column)[flag]);
}

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
      // opens the incoming attack assistant
      const url = link('attack', { member: n.userId, arrival: n.time, from: `${f.from.coords.g}:${f.from.coords.s}:${f.from.coords.p}` });
      return { ...base, title: L.attack(n.member), body: [clock(n.time), to, what, from].filter(Boolean).join(' · '), url };
    }
    case 'invite': {
      return { ...base, title: L.invite(n.member), body: planLine(n.plan, n.time), url: link('raid-planner', { plan: n.plan.id }) };
    }
    case 'plan':
      return { ...base, title: L.plan(n.member), body: planLine(n.plan, n.plan.target_time), url: link('raid-planner', { plan: n.plan.id }) };
    case 'comment': {
      const th = n.thread;
      const on = 'player' in th ? th.name : 'plan' in th ? L.settlement(coords(th.g, th.s, th.p, th.type === 'moon')) : `${th.owner ? th.owner + ' ' : ''}${coords(th.g, th.s, th.p, th.type === 'moon')}`;
      const url =
        'player' in th ? link(`player/${th.player}`) : 'plan' in th ? link(`raid-planner/${th.plan}/loot`) : link('spy', { c: `${th.g}:${th.s}:${th.p}`, type: th.type });
      return { ...base, title: n.mention ? L.mention(n.member, on) : L.comment(n.member, on), body: n.count > 1 ? `${n.excerpt} ${L.more(n.count)}` : n.excerpt, url };
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
      const research = n.element >= 100;
      const title = (research ? L.research : L.building)(techName(n.element, lang), n.level);
      return { ...base, title, body: L.buildingBody(planet), url: link('build', { tab: research ? 'research' : 'buildings', c: `${p.g}:${p.s}:${p.p}`, type: p.type }) };
    }
    case 'buildorder': {
      const p = n.planet;
      const s = n.step;
      const planet = `${p.name ? p.name + ' ' : ''}${coords(p.g, p.s, p.p, p.type === 'moon')}`;
      const el = s.element != null ? techName(s.element, lang) : '';
      const title =
        s.kind === 'building' ? L.orderBuilding(el, s.target ?? 0)
        : s.kind === 'research' ? L.orderResearch(el, s.target ?? 0)
        : s.kind === 'ship' || s.kind === 'defense' ? L.orderUnits(s.count ?? 1, el)
        : s.kind === 'prod' ? L.orderProd
        : L.orderTransport;
      return { ...base, title, body: L.orderBody(planet), url: link('build', { tab: 'order', c: `${p.g}:${p.s}:${p.p}`, type: p.type }) };
    }
    case 'settlement': {
      const p = n.plan;
      const what = (r: { m: number; k: number; d: number }) =>
        ([[r.m, 901], [r.k, 902], [r.d, 903]] as const).filter(([v]) => v > 0).map(([v, id]) => `${short(v, lang)} ${techName(id, lang)}`).join(', ');
      const body = [...n.sends.map((x) => L.youSend(x.to, what(x.res))), ...n.gets.map((x) => L.youGet(x.from, what(x.res)))].join(' · ');
      return { ...base, title: L.finalized(coords(p.g, p.s, p.p, p.planet_type === 'moon')), body, url: link(`raid-planner/${p.id}/loot`) };
    }
    case 'storage': {
      const p = n.planet;
      const planet = `${p.name ? p.name + ' ' : ''}${coords(p.g, p.s, p.p, false)}`;
      const since = n.time > t - 86400 ? clock(n.time) : clock(n.time, { ...day, hour: '2-digit', minute: '2-digit' });
      return {
        ...base, title: L.storage(techName(STORAGE[n.resource], lang)), body: L.storageBody(planet, since),
        url: link('build', { tab: 'buildings', c: `${p.g}:${p.s}:${p.p}`, type: 'planet' }),
      };
    }
    case 'phalanx': {
      const m = n.moon;
      const who = n.player ? `${n.player.name}${n.player.ally ? ` [${n.player.ally}]` : ''}` : '?';
      const planets = n.planets.map((p) => `${p.name ? p.name + ' ' : ''}${coords(p.g, p.s, p.p, false)}`).join(', ');
      return { ...base, title: L.phalanx(who), body: L.phalanxBody(coords(m.g, m.s, m.p, false), n.level, planets), url: link('imperium') };
    }
    case 'fleet': {
      const f = n.fleet;
      const what = (f.mission != null && L.missions[f.mission]) || f.missionName;
      const min = Math.round((n.time - t) / 60);
      const title = min >= 1 ? L.fleetSoon(what, min) : (f.phase === 'return' ? L.fleetBack : L.fleetArrived)(what);
      const body = (b: FleetBody) => `${b.name ? b.name + ' ' : ''}${coords(b.coords.g, b.coords.s, b.coords.p, b.type === 'moon')}`;
      const ships = Object.entries(f.ships).map(([id, k]) => `${k.toLocaleString(lang)} ${techName(Number(id), lang)}`).join(', ');
      return { ...base, title, body: [`${body(f.from)}${f.to ? ' → ' + body(f.to) : ''}`, clock(n.time), ships].filter(Boolean).join(' · '), url: link('imperium') };
    }
  }
}
