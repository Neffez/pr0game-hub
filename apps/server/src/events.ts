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
  /** false while the tab is in the background or its user idle */
  active: boolean;
}

/** One tab of a member as reported: `focused` while its window has the focus, `seq` orders the reports. */
interface TabState {
  w: Whereabouts;
  focused: boolean;
  seq: number;
  at: number;
}

/** A tab that has not reported for this long is gone (closed without saying so); open tabs report every 5 minutes. */
export const TAB_TTL_MS = 15 * 60_000;

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
  /** last report per group, user and tab; only users with a connection count as online */
  private tabs = new Map<number, Map<number, Map<string, TabState>>>();
  private seq = 0;
  private presenceFilter: PresenceFilter | null = null;
  private listeners = new Set<(groupId: number, event: LiveEvent) => void>();

  constructor(private clock: () => number = Date.now) {}

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
      this.tabs.get(groupId)?.delete(client.userId);
      onLeave?.();
      this.publishPresence(groupId);
    };
  }

  /**
   * A member's tab reports where it is. Each tab of the member (several tabs, devices) is kept on its own, the
   * presence shows the one in use (see `current`), so a tab in the background can't hide where the member really is.
   */
  setWhereabouts(groupId: number, userId: number, w: Whereabouts, tab: { id?: string; focused?: boolean } = {}) {
    this.changeTabs(groupId, userId, (tabs) => tabs.set(tab.id ?? '', { w, focused: !!tab.focused, seq: ++this.seq, at: this.clock() }));
  }

  /** A member's tab was closed. */
  closeTab(groupId: number, userId: number, tabId: string) {
    this.changeTabs(groupId, userId, (tabs) => tabs.delete(tabId));
  }

  private changeTabs(groupId: number, userId: number, change: (tabs: Map<string, TabState>) => void) {
    let users = this.tabs.get(groupId);
    if (!users) this.tabs.set(groupId, (users = new Map()));
    let tabs = users.get(userId);
    if (!tabs) users.set(userId, (tabs = new Map()));
    const before = JSON.stringify(this.current(tabs));
    change(tabs);
    if (before !== JSON.stringify(this.current(tabs)) && this.connections(groupId, userId)) this.publishPresence(groupId);
  }

  /**
   * Whereabouts of the tab in use: an active one before the others (visible, its user not idle), the focused one
   * before one only visible, then the latest report. Tabs gone silent drop out.
   */
  private current(tabs: Map<string, TabState> | undefined): Whereabouts | null {
    if (!tabs) return null;
    const rank = (t: TabState) => (t.w.active ? (t.focused ? 2 : 1) : 0);
    const expired = this.clock() - TAB_TTL_MS;
    let best: TabState | null = null;
    for (const [id, t] of tabs) {
      if (t.at < expired) tabs.delete(id);
      else if (!best || rank(t) > rank(best) || (rank(t) === rank(best) && t.seq > best.seq)) best = t;
    }
    return best?.w ?? null;
  }

  /** Push an updated presence list to all open connections of a group. */
  refreshPresence(groupId: number) {
    this.publishPresence(groupId);
  }

  /** Online members of a group with their whereabouts (unknown until their tab reports). */
  presence(groupId: number): PresenceEvent['members'] {
    const users = new Set([...(this.groups.get(groupId) ?? [])].map((c) => c.userId));
    const map = this.tabs.get(groupId);
    return [...users].map((userId) => ({ userId, ...(this.current(map?.get(userId)) ?? { page: null, active: true }) }));
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
