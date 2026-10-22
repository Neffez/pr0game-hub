import { onBeforeUnmount, ref } from 'vue';
import { uniApi } from './api';
import { useStored } from './composables';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api';

/** Stored game data of the group changed (server: events.ts). */
export interface DataEvent {
  type: 'data';
  tables: string[];
  userId?: number;
  counts?: Record<string, number>;
  systems?: string[];
}

/** Where a member is in the hub (server: `Whereabouts`). */
export interface Whereabouts {
  page: string | null;
  g?: number;
  s?: number;
  player?: number;
  active: boolean;
}
export type PresenceMember = { userId: number } & Whereabouts;

/** `resync`: the connection was interrupted, events may have been missed (views reload). */
export type LiveEvent = DataEvent | { type: 'presence'; members: PresenceMember[] } | { type: 'resync' };

type Handler = (e: LiveEvent) => void;

/** Hints when other members sync (per viewer; shared by the hints and the account page). */
export const liveHints = useStored('live.hints', true);

const handlers = new Set<Handler>();
let stopCurrent: (() => void) | null = null;
let currentUni = '';

/** Members of the group with the hub open, and where they are. */
export const presence = ref<PresenceMember[]>([]);

export function dispatch(e: LiveEvent) {
  if (e.type === 'presence') presence.value = e.members;
  // the server forgot this browser while it was disconnected
  if (e.type === 'resync' && currentUni) loadPresence(currentUni);
  for (const h of [...handlers]) h(e);
}

/** Current presence list; afterwards the events keep it up to date. */
async function loadPresence(uni: string) {
  try {
    presence.value = await uniApi<PresenceMember[]>(uni, '/presence');
  } catch {
    /* shown again with the next presence event */
  }
}

/**
 * Live events of a universe and group. All tabs of the browser share one connection: the tab holding the
 * lock (Web Locks) connects and passes the events on to the others (BroadcastChannel); when it closes, the
 * next tab takes over. Without these APIs every tab connects on its own.
 */
export function startLive(uni: string, group: number | null) {
  stopLive();
  presence.value = [];
  currentUni = uni;
  loadPresence(uni);
  const key = `hub.live.${uni}.${group ?? ''}`;
  const url = `${BASE}/${uni}/events${group ? `?group=${group}` : ''}`;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(key) : null;
  if (channel) channel.onmessage = (m) => dispatch(m.data);
  const abort = new AbortController();
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let opened = false;

  const emit = (e: LiveEvent, self = true) => {
    if (self) dispatch(e);
    channel?.postMessage(e);
  };
  function connect() {
    if (abort.signal.aborted) return;
    source = new EventSource(url, { withCredentials: true });
    source.onopen = () => {
      // the other tabs lost their connection's events while no tab was connected; this tab only after a reconnect
      emit({ type: 'resync' }, opened);
      opened = true;
    };
    source.onmessage = (m) => emit(JSON.parse(m.data));
    source.onerror = () => {
      // network errors reconnect by themselves; a refused stream (HTTP error) closes and is retried here
      if (source?.readyState !== EventSource.CLOSED) return;
      retry = setTimeout(connect, 30_000);
    };
  }

  if (channel && typeof navigator !== 'undefined' && navigator.locks) {
    navigator.locks
      .request(key, { signal: abort.signal }, () => {
        connect();
        return new Promise<void>((release) => abort.signal.addEventListener('abort', () => release()));
      })
      .catch(() => {
        /* aborted while waiting for the lock */
      });
  } else connect();

  stopCurrent = () => {
    abort.abort();
    clearTimeout(retry);
    source?.close();
    channel?.close();
  };
}

export function stopLive() {
  stopCurrent?.();
  stopCurrent = null;
  currentUni = '';
}

/**
 * Reports where this tab is (page, shown system or player) while the layout is mounted: on navigation, when the
 * tab goes to the background or comes back, and after a reconnect. A tab in the background only reports that.
 */
export function useWhereabouts(uni: () => string, where: () => Omit<Whereabouts, 'active'>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = '';
  const report = (force = false) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const body: Whereabouts = { ...where(), active: !document.hidden };
      const key = JSON.stringify(body);
      if (!force && key === last) return;
      last = key;
      uniApi(uni(), '/presence', { body }).catch(() => (last = ''));
    }, 500);
  };
  const onVisibility = () => report();
  document.addEventListener('visibilitychange', onVisibility);
  useLive((e) => {
    if (e.type === 'resync' && !document.hidden) report(true);
  });
  onBeforeUnmount(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  });
  return report;
}

/** Live events while the calling component is mounted. */
export function useLive(handler: Handler) {
  handlers.add(handler);
  onBeforeUnmount(() => handlers.delete(handler));
}

/** Matches data events that touch one of the given tables (ingest count keys). */
export const tables =
  (...names: string[]) =>
  (e: DataEvent) =>
    e.tables.some((t) => names.includes(t));

/**
 * Reloads a view when matching data arrives: debounced (a paste of many messages, several members syncing at
 * once), and in a hidden tab only once it is shown again. Reloads after a reconnect too.
 */
export function useLiveReload(load: () => unknown, match: (e: DataEvent) => boolean, delay = 1000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const run = () => {
    timer = undefined;
    if (document.hidden) dirty = true;
    else load();
  };
  const onVisible = () => {
    if (document.hidden || !dirty) return;
    dirty = false;
    load();
  };
  useLive((e) => {
    if (!(e.type === 'resync' || (e.type === 'data' && match(e)))) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  });
  document.addEventListener('visibilitychange', onVisible);
  onBeforeUnmount(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });
}
