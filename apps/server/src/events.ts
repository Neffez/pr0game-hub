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

/** Where a member is in the hub (sent by their open tab). */
export interface Whereabouts {
  /** page below the universe, e.g. `browse`, `overview` */
  page: string | null;
  g?: number;
  s?: number;
  /** player shown in the player page or dialog */
  player?: number;
  /** false while the tab is in the background */
  active: boolean;
}

/** Members with an open hub tab: sent in full whenever someone comes, goes or moves. */
export interface PresenceEvent {
  type: 'presence';
  members: ({ userId: number } & Whereabouts)[];
}

export type LiveEvent = DataEvent | PresenceEvent;

export interface LiveClient {
  userId: number;
  send(event: LiveEvent): void;
}

/** Galaxy systems listed one by one up to this count; above it the event says "all". */
const MAX_SYSTEMS = 50;

export class EventBus {
  private groups = new Map<number, Set<LiveClient>>();
  /** last whereabouts per group and user; only users with a connection count as online */
  private whereabouts = new Map<number, Map<number, Whereabouts>>();

  /** `onLeave`: the user's last connection to the group ended (they went offline). */
  subscribe(groupId: number, client: LiveClient, onLeave?: () => void): () => void {
    let set = this.groups.get(groupId);
    if (!set) this.groups.set(groupId, (set = new Set()));
    const arrives = !this.connections(groupId, client.userId);
    set.add(client);
    if (arrives) this.publishPresence(groupId);
    return () => {
      if (!set.delete(client)) return;
      if (!set.size) this.groups.delete(groupId);
      if (this.connections(groupId, client.userId)) return;
      this.whereabouts.get(groupId)?.delete(client.userId);
      onLeave?.();
      this.publishPresence(groupId);
    };
  }

  /** A member's tab reports where it is. */
  setWhereabouts(groupId: number, userId: number, w: Whereabouts) {
    let map = this.whereabouts.get(groupId);
    if (!map) this.whereabouts.set(groupId, (map = new Map()));
    const before = JSON.stringify(map.get(userId) ?? null);
    map.set(userId, w);
    if (before !== JSON.stringify(w) && this.connections(groupId, userId)) this.publishPresence(groupId);
  }

  /** Online members of a group with their whereabouts (unknown until their tab reports). */
  presence(groupId: number): PresenceEvent['members'] {
    const users = new Set([...(this.groups.get(groupId) ?? [])].map((c) => c.userId));
    const map = this.whereabouts.get(groupId);
    return [...users].map((userId) => ({ userId, ...(map?.get(userId) ?? { page: null, active: true }) }));
  }

  private publishPresence(groupId: number) {
    this.publish(groupId, { type: 'presence', members: this.presence(groupId) });
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
