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
  /** a new comment: on which player or planet (for the hint) */
  comment?: { player?: number; playerName?: string; coords?: string; moon?: boolean };
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
  isAdmin: boolean;
  send(event: LiveEvent): void;
}

/** Galaxy systems listed one by one up to this count; above it the event says "all". */
const MAX_SYSTEMS = 50;

export type PresenceFilter = (viewer: Pick<LiveClient, 'userId' | 'isAdmin'>, members: PresenceEvent['members']) => PresenceEvent['members'];

export class EventBus {
  private groups = new Map<number, Set<LiveClient>>();
  /** last whereabouts per group and user; only users with a connection count as online */
  private whereabouts = new Map<number, Map<number, Whereabouts>>();
  private presenceFilter: PresenceFilter | null = null;
  private listeners = new Set<(groupId: number, event: LiveEvent) => void>();

  /** Per-viewer filtering for presence events (e.g. hidden online status). */
  setPresenceFilter(filter: PresenceFilter | null) {
    this.presenceFilter = filter;
  }

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

  /** Push an updated presence list to all open connections of a group. */
  refreshPresence(groupId: number) {
    this.publishPresence(groupId);
  }

  /** Online members of a group with their whereabouts (unknown until their tab reports). */
  presence(groupId: number): PresenceEvent['members'] {
    const users = new Set([...(this.groups.get(groupId) ?? [])].map((c) => c.userId));
    const map = this.whereabouts.get(groupId);
    return [...users].map((userId) => ({ userId, ...(map?.get(userId) ?? { page: null, active: true }) }));
  }

  private publishPresence(groupId: number) {
    const members = this.presence(groupId);
    if (!this.presenceFilter) {
      this.publish(groupId, { type: 'presence', members });
      return;
    }
    for (const client of this.groups.get(groupId) ?? []) {
      client.send({ type: 'presence', members: this.presenceFilter(client, members) });
    }
  }

  publish(groupId: number, event: LiveEvent) {
    for (const client of this.groups.get(groupId) ?? []) client.send(event);
    for (const listener of this.listeners) listener(groupId, event);
  }

  /** Every published event of every group, also without open connections (push notifications); returns the unsubscribe. */
  onPublish(listener: (groupId: number, event: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
