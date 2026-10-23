import { toUniverse, type Universe } from './context.js';
import type { DB } from './db.js';
import type { EventBus } from './events.js';

/**
 * What web push (push.ts) and Discord (discord.ts) share: delivery after data events of a group (bundled) and on a
 * ticker for the launch reminders.
 */

/** Sent notification ids are kept this long (longer than any notification lasts). */
export const SENT_KEEP = 7 * 86400;
/** Data events of a group are bundled this long (a paste of many pages, several members at once). */
const DEBOUNCE_MS = 2000;
/** Launch reminders are checked this often. */
export const TICK_MS = 30_000;
/** Ticks look at plans landing within this time. */
export const TICK_AHEAD = 48 * 3600;
/** Data events that may bring a notification. */
const TABLES = ['fleets', 'attack_plans', 'comments', 'group_members'];

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
