import { reactive } from 'vue';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api';

export interface Me {
  user: { id: number; username: string; isAdmin: boolean } | null;
  groups: { id: number; name: string; role: string; universe: string; universe_name: string }[];
}

export const session = reactive<{ me: Me | null; loaded: boolean }>({ me: null, loaded: false });

const GROUP_KEY = 'hub.group.';

/** Selected group per universe (per-viewer convenience). */
export function selectedGroup(uni: string): number | null {
  try {
    const v = localStorage.getItem(GROUP_KEY + uni);
    if (v) return Number(v);
  } catch {
    /* storage unavailable */
  }
  return session.me?.groups.find((g) => g.universe === uni)?.id ?? null;
}

export function selectGroup(uni: string, id: number) {
  try {
    localStorage.setItem(GROUP_KEY + uni, String(id));
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; uni?: string } = {}): Promise<T> {
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
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

/** Shorthand for universe scoped endpoints: uniApi('u8', '/overview') -> /api/u8/overview */
export const uniApi = <T = any>(uni: string, path: string, opts: { method?: string; body?: unknown } = {}) =>
  api<T>(`/${uni}${path}`, { ...opts, uni });

export async function loadMe() {
  session.me = await api<Me>('/auth/me');
  session.loaded = true;
  return session.me;
}
