import { reactive } from 'vue';
import { setDateFormat } from './format';
import { i18n, setLocale, t } from './i18n';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api';

export interface Me {
  user: { id: number; username: string; isAdmin: boolean; lang: string; dateFormat: string; tours: { enabled: boolean; seen: string[] } } | null;
  groups: { id: number; name: string; tag: string | null; role: string; universe: string; universe_name: string; universe_starts_at: number | null; universe_ended_at: number | null }[];
  defaultUniverse?: string | null;
}

export const session = reactive<{ me: Me | null; loaded: boolean }>({ me: null, loaded: false });

const GROUP_KEY = 'hub.group.';

/**
 * Selected group per universe (per-viewer convenience). A stored group the user is no
 * longer a member of (removed, deleted, other account) falls back to the first one.
 */
export function selectedGroup(uni: string): number | null {
  const groups = session.me?.groups.filter((g) => g.universe === uni) ?? [];
  try {
    const v = Number(localStorage.getItem(GROUP_KEY + uni));
    if (groups.some((g) => g.id === v)) return v;
  } catch {
    /* storage unavailable */
  }
  return groups[0]?.id ?? null;
}

/** universe.json built from the galaxy data of the selected group; the server answers with an attachment, so the browser downloads it. */
export function downloadUniverseJson(uni: string) {
  const group = selectedGroup(uni);
  location.href = `${import.meta.env.BASE_URL}api/${uni}/universe-json${group ? `?group=${group}` : ''}`;
}

/** Download link of the group's data: all as JSON (`dataset` omitted) or one dataset as CSV (attachments). */
export function exportUrl(uni: string, dataset?: string, opts: { days?: number; sep?: 'comma' | 'semicolon' | 'tab'; filter?: Record<string, string | number | null | undefined> } = {}) {
  const q = new URLSearchParams();
  const group = selectedGroup(uni);
  if (group) q.set('group', String(group));
  if (opts.days) q.set('days', String(opts.days));
  if (dataset && opts.sep && opts.sep !== 'comma') q.set('sep', opts.sep);
  // filters of the view the button sits in (players and planets)
  for (const [k, v] of Object.entries(opts.filter ?? {})) if (v != null && v !== '') q.set(k, String(v));
  return `${import.meta.env.BASE_URL}api/${uni}/export${dataset ? `/${dataset}.csv` : ''}${q.size ? `?${q}` : ''}`;
}

export function selectGroup(uni: string, id: number) {
  try {
    localStorage.setItem(GROUP_KEY + uni, String(id));
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/**
 * In-app path for login `?next=`: a single path that stays on the hub. Arrays, protocol-relative URLs and
 * anything with a scheme go to the start page.
 */
export function safeNext(v: unknown): string {
  const s = typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '';
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('://')) return '/';
  return s;
}

/** Server errors carry a stable `code`; translated when known, otherwise the server's (English) message. */
function errorMessage(data: { error?: string; code?: string } | null, fallback: string) {
  const key = `errors.${data?.code}`;
  return data?.code && i18n.global.te(key) ? t(key) : (data?.error ?? fallback);
}

let sessionEnded = false;

/** Cookie gone: drop the local session, close live, send the tab to login once. */
function onUnauthorized(path: string) {
  session.me = { user: null, groups: [] };
  import('./live').then((m) => m.stopLive()).catch(() => {});
  if (path === '/auth/login' || path === '/auth/me') return;
  if (sessionEnded) return;
  sessionEnded = true;
  import('./router').then(({ router }) => {
    const to = router.currentRoute.value;
    if (to.meta.public) return;
    router.replace({ path: '/login', query: { next: to.fullPath } });
  }).catch(() => {});
}

/** `keepalive`: the request outlives the page (sent while the tab closes). */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; uni?: string; keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.uni) {
    const g = selectedGroup(opts.uni);
    if (g) headers['x-hub-group'] = String(g);
  }
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
    keepalive: opts.keepalive,
  });
  let data: { error?: string; code?: string } | null = null;
  if (res.headers.get('content-type')?.includes('json')) {
    try {
      data = await res.json();
    } catch {
      /* empty body or HTML from a proxy */
    }
  }
  if (res.status === 401) onUnauthorized(path);
  if (res.ok) sessionEnded = false;
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.statusText), data?.code);
  return data as T;
}

/** Shorthand for universe scoped endpoints: uniApi('u8', '/overview') -> /api/u8/overview */
export const uniApi = <T = any>(uni: string, path: string, opts: { method?: string; body?: unknown; keepalive?: boolean } = {}) =>
  api<T>(`/${uni}${path}`, { ...opts, uni });

export async function loadMe() {
  session.me = await api<Me>('/auth/me');
  session.loaded = true;
  if (session.me.user) {
    // the router waits for this: the page shows in the account's language right away
    await setLocale(session.me.user.lang).catch(() => {});
    setDateFormat(session.me.user.dateFormat);
    const id = session.me.user.id;
    import('./push').then((push) => push.checkPushOwner(id)).catch(() => {});
  }
  return session.me;
}
