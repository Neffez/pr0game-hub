import { toUniverse, type Universe } from './context.js';
import type { DB } from './db.js';
import type { EventBus } from './events.js';
import { nextFleetAlert } from './repo/fleetAlerts.js';
import { nextBuildingAlert, nextStorageFull } from './repo/notifications.js';

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
/** Data events that may bring a notification. */
const TABLES = ['fleets', 'attack_plans', 'comments', 'group_members', 'empire', 'overview', 'buildings', 'research', 'building_alerts', 'fleet_alerts'];

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
 * When the ticks need to look at a group's building and fleet alerts and storages again: the earliest ready time of
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
    const alerts = buildings || !!this.db.prepare('SELECT 1 FROM fleet_alerts WHERE group_id = ?').get(groupId);
    const storage = nextStorageFull(this.db, universe, groupId, storageWatchers(this.db, groupId), t) ?? Infinity;
    if (!alerts) {
      this.next.set(groupId, storage);
      return;
    }
    const building = buildings ? nextBuildingAlert(this.db, universe, groupId, t) : null;
    this.next.set(groupId, Math.min(t + ALERT_RECHECK, building ?? Infinity, nextFleetAlert(this.db, groupId, t) ?? Infinity, storage));
  }
}

/** Runs a delivery for a group once its data events have settled. */
export class GroupDebounce {
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(private run: (groupId: number) => void) {}

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
        }, DEBOUNCE_MS),
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
    .prepare('SELECT u.id, u.slug, u.name, u.settings, u.deck_config FROM groups g JOIN universes u ON u.id = g.universe_id WHERE g.id = ?')
    .get(groupId) as Parameters<typeof toUniverse>[0] | undefined;
  return row ? toUniverse(row) : null;
}
