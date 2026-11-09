import { toUniverse, type Universe } from './context.js';
import type { DB } from './db.js';
import type { EventBus } from './events.js';
import { nextFleetAlert } from './repo/fleetAlerts.js';
import { nextBuildingAlert, nextBuildOrderStep, nextStorageFull, type ChannelNotification, type Notification } from './repo/notifications.js';

/**
 * What web push (push.ts) and Discord (discord.ts) share: delivery after data events of a group (bundled) and on a
 * ticker for the launch reminders, the building and fleet alerts and full storages.
 */

/** Sent notification ids are kept this long (longer than any notification lasts). */
export const SENT_KEEP = 7 * 86400;
/** Data events of a group are bundled this long (a paste of many pages, several members at once). */
const DEBOUNCE_MS = 2000;
/** Launch reminders, building and fleet alerts and storages are checked this often. */
export const TICK_MS = 30_000;
/** Ticks look at plans landing within this time. */
export const TICK_AHEAD = 48 * 3600;
/** Data events that may bring a notification (spy reports: a hostile phalanx in reach). */
const TABLES = ['spy_reports', 'fleets', 'attack_plans', 'comments', 'group_members', 'empire', 'overview', 'buildings', 'research', 'building_alerts', 'fleet_alerts', 'build_orders'];

/** Building and fleet alerts of a group are looked at again at least this often by the ticks (data events deliver anyway). */
export const ALERT_RECHECK = 15 * 60;

/**
 * Members of a group who get notifications outside the hub (push subscription or Discord webhook) and have planets
 * synced: their storages may run full.
 */
export function storageWatchers(db: DB, groupId: number): number[] {
  return db
    .prepare(
      `SELECT m.user_id FROM group_members m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ? AND (u.discord_webhook IS NOT NULL OR EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id))
         AND (EXISTS (SELECT 1 FROM empire_snapshots e WHERE e.group_id = m.group_id AND e.user_id = m.user_id)
           OR EXISTS (SELECT 1 FROM building_snapshots b WHERE b.group_id = m.group_id AND b.user_id = m.user_id)
           OR EXISTS (SELECT 1 FROM research_snapshots r WHERE r.group_id = m.group_id AND r.user_id = m.user_id))`,
    )
    .pluck()
    .all(groupId) as number[];
}

/**
 * When the ticks need to look at a group's building and fleet alerts, build orders and storages again: the earliest ready time of
 * its open building alerts, reminder time of its fleet alerts or time a storage of a member gets full, at the latest
 * after `ALERT_RECHECK` while there are alerts. Every delivery of the group (data events, ticks) plans it anew, so the
 * ticks do not recompute every member's notifications every 30 seconds for a group that only waits; a group with
 * nothing to wait for is not due until its next data event.
 */
export class AlertSchedule {
  private next = new Map<number, number>();

  constructor(private db: DB) {}

  due(groupId: number, t: number): boolean {
    return (this.next.get(groupId) ?? 0) <= t;
  }

  plan(groupId: number, universe: Universe, t: number) {
    const buildings = !!this.db.prepare('SELECT 1 FROM building_alerts WHERE group_id = ?').get(groupId);
    const orders = !!this.db.prepare('SELECT 1 FROM build_orders WHERE group_id = ?').get(groupId);
    const alerts = buildings || orders || !!this.db.prepare('SELECT 1 FROM fleet_alerts WHERE group_id = ?').get(groupId);
    const storage = nextStorageFull(this.db, universe, groupId, storageWatchers(this.db, groupId), t) ?? Infinity;
    if (!alerts) {
      this.next.set(groupId, storage);
      return;
    }
    const building = buildings ? nextBuildingAlert(this.db, universe, groupId, t) : null;
    const order = orders ? nextBuildOrderStep(this.db, universe, groupId, t) : null;
    this.next.set(groupId, Math.min(t + ALERT_RECHECK, building ?? Infinity, order ?? Infinity, nextFleetAlert(this.db, groupId, t) ?? Infinity, storage));
  }
}

/** Runs a delivery for a group once its data events have settled. */
export class GroupDebounce {
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private run: (groupId: number) => void,
    private delayMs = DEBOUNCE_MS,
  ) {}

  /** Starts listening; returns the unsubscribe. */
  listen(bus: EventBus): () => void {
    return bus.onPublish((groupId, e) => {
      if (e.type !== 'data' || !e.tables.some((t) => TABLES.includes(t))) return;
      clearTimeout(this.timers.get(groupId));
      this.timers.set(
        groupId,
        setTimeout(() => {
          this.timers.delete(groupId);
          this.run(groupId);
        }, this.delayMs),
      );
    });
  }

  /** Stops pending deliveries (app close). */
  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

/** The universe a group belongs to. */
export function groupUniverse(db: DB, groupId: number): Universe | null {
  const row = db
    .prepare('SELECT u.id, u.slug, u.name, u.settings, u.deck_config, u.units, u.starts_at, u.ended_at FROM groups g JOIN universes u ON u.id = g.universe_id WHERE g.id = ?')
    .get(groupId) as Parameters<typeof toUniverse>[0] | undefined;
  return row ? toUniverse(row) : null;
}

/**
 * Quiet hours of a push device or a Discord webhook: between `from` and `to` (time of day `HH:MM` in the time zone
 * `tz`, over midnight when `from` is later) nothing is sent; it is held back and sent when the quiet hours end, as
 * long as it still matters. The kinds in `except` come through at once.
 */
export interface QuietHours {
  from: string;
  to: string;
  /** IANA time zone of the device (the browser tells it) */
  tz: string;
  except: QuietBreak[];
}

/** What may break the quiet hours: attacks on the user, their launch reminders and the alerts they set on own fleets. */
export const QUIET_BREAKS = ['attackSelf', 'launch', 'fleets'] as const;
export type QuietBreak = (typeof QUIET_BREAKS)[number];
export const QUIET_DEFAULT_EXCEPT: QuietBreak[] = ['attackSelf', 'launch', 'fleets'];
/** A device or webhook gets at most this many held notifications when its quiet hours end (the newest). */
export const HELD_MAX = 20;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const clocks = new Map<string, Intl.DateTimeFormat>();
function clockOf(tz: string): Intl.DateTimeFormat {
  let f = clocks.get(tz);
  if (!f) clocks.set(tz, (f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })));
  return f;
}

/** Quiet hours from a request body: null switches them off, undefined when invalid. */
export function parseQuiet(v: unknown): QuietHours | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'object') return undefined;
  const q = v as Record<string, unknown>;
  if (typeof q.from !== 'string' || typeof q.to !== 'string' || !CLOCK.test(q.from) || !CLOCK.test(q.to) || q.from === q.to) return undefined;
  if (typeof q.tz !== 'string' || q.tz.length > 64) return undefined;
  try {
    clockOf(q.tz);
  } catch {
    return undefined;
  }
  const except = q.except === undefined ? QUIET_DEFAULT_EXCEPT : q.except;
  if (!Array.isArray(except) || except.some((k) => !QUIET_BREAKS.includes(k))) return undefined;
  return { from: q.from, to: q.to, tz: q.tz, except: QUIET_BREAKS.filter((k) => except.includes(k)) };
}

/** Stored quiet hours (JSON); null for none or a value no longer valid. */
export function storedQuiet(raw: string | null | undefined): QuietHours | null {
  if (!raw) return null;
  try {
    return parseQuiet(JSON.parse(raw)) ?? null;
  } catch {
    return null;
  }
}

/** Whether `t` lies in the quiet hours. */
export function inQuiet(q: QuietHours | null, t: number): boolean {
  if (!q) return false;
  const parts = clockOf(q.tz).formatToParts(new Date(t * 1000));
  const clock = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`;
  return q.from < q.to ? clock >= q.from && clock < q.to : clock >= q.from || clock < q.to;
}

/** Which exception of the quiet hours a notification falls under for the user, null for none. */
export function quietBreakOf(n: Notification | ChannelNotification, userId: number): QuietBreak | null {
  if (n.kind === 'attack') return n.userId === userId ? 'attackSelf' : null;
  if (n.kind === 'launch') return 'launch';
  if (n.kind === 'fleet') return 'fleets';
  return null;
}

/** Whether the quiet hours hold a notification back at `t`. */
export const heldBy = (q: QuietHours | null, kind: QuietBreak | null, t: number) => inQuiet(q, t) && !(kind && q!.except.includes(kind));

export interface HeldRow {
  id: number;
  kind: string;
  payload: string;
  expires_at: number;
}

/** Keeps a notification for the end of the quiet hours of `target`; one with the same tag is replaced. */
export function hold(db: DB, target: string, kind: string, payload: { tag: string }, expiresAt: number, t: number) {
  db.prepare(
    `INSERT INTO notify_held (target, tag, kind, payload, expires_at, held_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (target, tag) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, expires_at = excluded.expires_at, held_at = excluded.held_at`,
  ).run(target, payload.tag, kind, JSON.stringify(payload), expiresAt, t);
}

/** Targets (`p:…` push devices or `u:…` Discord webhooks) with held notifications. */
export const heldTargets = (db: DB, prefix: 'p' | 'u') =>
  db.prepare("SELECT DISTINCT target FROM notify_held WHERE target LIKE ? || ':%'").pluck().all(prefix) as string[];

/** Takes the held notifications of a target out: the newest `HELD_MAX` that have not expired, oldest first. */
export function takeHeld(db: DB, target: string, t: number): HeldRow[] {
  const rows = db.prepare('SELECT id, kind, payload, expires_at FROM notify_held WHERE target = ? ORDER BY held_at, id').all(target) as HeldRow[];
  db.prepare('DELETE FROM notify_held WHERE target = ?').run(target);
  return rows.filter((r) => r.expires_at > t).slice(-HELD_MAX);
}

/** Planets ("g:s:p") whose full storages the member muted for push and Discord. */
export function storageMuted(db: DB, groupId: number, userId: number): Set<string> {
  const rows = db.prepare('SELECT g, s, p FROM storage_muted WHERE group_id = ? AND user_id = ?').all(groupId, userId) as { g: number; s: number; p: number }[];
  return new Set(rows.map((r) => `${r.g}:${r.s}:${r.p}`));
}
