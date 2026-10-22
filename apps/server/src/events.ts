/**
 * Live events of a group, pushed to the open hub tabs of its members (Server-Sent Events, routes/events.ts).
 * In memory: the hub runs as one process, a restart only drops the open connections (the clients reconnect and
 * reload). Events only say *what* changed; the clients load the data again through the normal endpoints, so an
 * event never carries game data past `groupContext`.
 */

/** Stored game data changed. */
export interface DataEvent {
  type: 'data';
  /** tables with new rows (the ingest count keys, e.g. `spy_reports`, `galaxy_systems`) */
  tables: string[];
  /** member whose paste it was; missing for background work (crawler, admin tools) */
  userId?: number;
  /** new rows per table, for the hints */
  counts?: Record<string, number>;
  /** synced galaxy systems "g:s"; missing when unknown or too many (universe.json) */
  systems?: string[];
}

export type LiveEvent = DataEvent;

export interface LiveClient {
  userId: number;
  send(event: LiveEvent): void;
}

/** Galaxy systems listed one by one up to this count; above it the event says "all". */
const MAX_SYSTEMS = 50;

export class EventBus {
  private groups = new Map<number, Set<LiveClient>>();

  subscribe(groupId: number, client: LiveClient): () => void {
    let set = this.groups.get(groupId);
    if (!set) this.groups.set(groupId, (set = new Set()));
    set.add(client);
    return () => {
      set.delete(client);
      if (!set.size) this.groups.delete(groupId);
    };
  }

  publish(groupId: number, event: LiveEvent) {
    for (const client of this.groups.get(groupId) ?? []) client.send(event);
  }

  /** Open connections of a user in a group. */
  connections(groupId: number, userId: number): number {
    let n = 0;
    for (const c of this.groups.get(groupId) ?? []) if (c.userId === userId) n++;
    return n;
  }

  /** New rows of an ingest (count keys of `IngestSummary.counts`); nothing new, no event. */
  publishIngest(groupId: number, userId: number | undefined, counts: Record<string, { new: number }>, systems: string[] | null) {
    const added = Object.fromEntries(Object.entries(counts).filter(([, c]) => c.new > 0).map(([k, c]) => [k, c.new]));
    const tables = Object.keys(added);
    if (!tables.length) return;
    this.publish(groupId, {
      type: 'data',
      tables,
      userId,
      counts: added,
      systems: added.galaxy_systems && systems && systems.length <= MAX_SYSTEMS ? systems : undefined,
    });
  }
}

export const events = new EventBus();
