import { computed, inject, nextTick, onBeforeUnmount, provide, ref, watch, type Directive, type InjectionKey, type Ref, type WatchSource } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { protectionStatus, type UniverseSettings } from './format';

export interface MarketRate {
  m: number;
  k: number;
  /** source: page source (exact), text: estimated from a text copy, manual: set by hand */
  source: 'source' | 'text' | 'manual';
  time: number;
  by: string | null;
}

export interface UniContext {
  universe: { id: number; slug: string; name: string; settings: UniverseSettings; deck: { type: string; size: string; count: number }[]; endedAt: number | null };
  group: { id: number; name: string; role: string };
  /** base URL of the pr0game tools (server setting `TOOLS_URL`) */
  toolsUrl?: string;
  /** the group's market rate (metal and crystal per 1 deuterium), newest synced or set by hand */
  marketRate?: MarketRate | null;
  /** name = in-game name, falls back to the hub username; global_admin = hub admin (1/0) */
  members: { id: number; username: string; name: string; role: string; global_admin: number; ingame_name: string | null; last_seen_at: number | null }[];
  me: { id: number; username: string; isAdmin: boolean };
  /** own player with the newest synced total points */
  player: { id: number; points: number | null } | null;
  /** own research and planets from the latest own empire page */
  own: {
    time: number;
    research: Record<string, number>;
    /** silo: missile silo level, ipm: interplanetary missiles (both 0 on moons) */
    planets: { name: string; coords: { g: number; s: number; p: number }; type: 'planet' | 'moon'; silo?: number; ipm?: number }[];
  } | null;
}

const KEY: InjectionKey<Ref<UniContext | null>> = Symbol('uni');

export function provideUni(ctx: Ref<UniContext | null>) {
  provide(KEY, ctx);
}

/** Universe/group context loaded by UniverseLayout. */
export function useUni() {
  const ctx = inject(KEY)!;
  return { ctx, uni: computed(() => ctx.value?.universe.slug ?? '') };
}

/**
 * Status of a player with weak/strong derived from the own total points where the universe's noob protection is set
 * (`protectionStatus`); outside of a universe or without the target's points the synced status stays.
 */
export function useProtection() {
  const ctx = inject(KEY, null);
  return (status: string[], points: number | null | undefined) =>
    ctx?.value ? protectionStatus(ctx.value.universe.settings, ctx.value.player?.points, points, status) : status;
}

/** Client-side table sorting. `get` maps a row and key to a sortable value. */
export function useSort<T>(rows: Ref<T[]>, get: (row: T, key: string) => unknown, initial: string, desc = true) {
  const key = ref(initial);
  const descending = ref(desc);
  const sorted = computed(() => {
    const k = key.value;
    const dir = descending.value ? -1 : 1;
    return [...rows.value].sort((a, b) => {
      const va = get(a, k);
      const vb = get(b, k);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  });
  const sortBy = (k: string) => {
    if (key.value === k) descending.value = !descending.value;
    else {
      key.value = k;
      descending.value = true;
    }
  };
  /** Direction of a column for its header (SortMark), null when not sorted by it. */
  const direction = (k: string) => (key.value === k ? (descending.value ? 'desc' : 'asc') : null);
  return { sorted, sortBy, direction, key, descending };
}

/**
 * Renders a long list in steps: the first `step` items, the next ones when the `sentinel` element (placed after the
 * list) comes near the visible area: the scroll box of a `.table-wrap` around it, otherwise the window. Starts over
 * when the list changes (sorting, filters), so these only cost the rendered rows. With `resetOn` only when that
 * changes: a list reloaded with live data keeps the rows shown and the scroll position.
 */
export function useProgressive<T>(list: Ref<T[]>, step = 150, resetOn?: WatchSource) {
  const count = ref(step);
  const shown = computed(() => list.value.slice(0, count.value));
  const more = computed(() => count.value < list.value.length);
  const sentinel = ref<HTMLElement | null>(null);
  let box: Element | null = null;
  watch(resetOn ?? list, () => {
    count.value = step;
    // a table scrolled down would load the next rows right away; the new order starts at the top anyway
    if (box) box.scrollTop = 0;
  });
  watch(sentinel, (el, _, onCleanup) => {
    if (!el) return;
    box = el.closest('.table-wrap');
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        count.value += step;
        // still in sight after rendering (tall screen, fast scrolling): observing again reports it once more
        nextTick(() => {
          observer.unobserve(el);
          observer.observe(el);
        });
      },
      { root: box, rootMargin: '600px' },
    );
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });
  return { shown, more, sentinel };
}

/**
 * Loads a view's data. Only the answer to the newest request is applied (with fast navigation an older answer
 * could arrive last and win), and a failure ends up in `error` instead of an unhandled rejection.
 * `load()` returns the data, or undefined if the request failed or a newer one was started.
 */
export function useLoader<T>(fetch: () => Promise<T>) {
  const data = ref<T | null>(null) as Ref<T | null>;
  const error = ref('');
  let latest = 0;
  async function load(): Promise<T | undefined> {
    const id = ++latest;
    try {
      const res = await fetch();
      if (id !== latest) return undefined;
      data.value = res;
      error.value = '';
      return res;
    } catch (e) {
      if (id === latest) error.value = (e as Error).message;
      return undefined;
    }
  }
  return { data, error, load };
}

/** Per-viewer remembered setting (localStorage, falls back to memory). */
export function useStored<T>(name: string, initial: T): Ref<T> {
  let start = initial;
  try {
    const raw = localStorage.getItem('hub.' + name);
    if (raw != null) start = JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  const r = ref(start) as Ref<T>;
  watch(
    r,
    (value) => {
      try {
        localStorage.setItem('hub.' + name, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    },
    { deep: true },
  );
  return r;
}

/**
 * Player dialog: the player id lives in the `player` query parameter, so the browser's back button
 * closes the dialog and a link to a page with the dialog open can be shared.
 */
export function usePlayerDialog() {
  const route = useRoute();
  const router = useRouter();
  const id = computed(() => (route.query.player ? Number(route.query.player) : null));
  const open = (playerId: number) => router.push({ query: { ...route.query, player: String(playerId) } });
  const close = () => {
    const { player: _, ...rest } = route.query;
    router.push({ query: rest });
  };
  return { id, open, close };
}

/** Open overlays (dialog, drawer, sheet) that block page scrolling; the body scrolls again once all are closed. */
let scrollLocks = 0;

/** No page scrolling behind an overlay while `active` is true. */
export function useScrollLock(active: Ref<boolean>) {
  let held = false;
  const set = (on: boolean) => {
    if (on === held) return;
    held = on;
    scrollLocks += on ? 1 : -1;
    document.body.style.overflow = scrollLocks > 0 ? 'hidden' : '';
  };
  watch(active, set, { immediate: true });
  onBeforeUnmount(() => set(false));
}

/** Reactive media query, e.g. the mobile layout breakpoint. */
export function useMediaQuery(query: string): Ref<boolean> {
  const mq = window.matchMedia(query);
  const matches = ref(mq.matches);
  const update = () => (matches.value = mq.matches);
  mq.addEventListener('change', update);
  onBeforeUnmount(() => mq.removeEventListener('change', update));
  return matches;
}

/** Same breakpoint as the mobile layout in style.css. */
export const useMobile = () => useMediaQuery('(max-width: 800px)');

/**
 * `v-stack` / `v-stack="n"` on a `table.data`: on mobile (style.css) every row becomes a card. The column
 * headers are copied into the cells as labels; the first n cells of a row (default 1) form its title line.
 * Cells with the class `m-hide` are left out on mobile, `m-wide` cells take a whole line (long values).
 */
function stackLabels(table: HTMLTableElement, heads = 1) {
  table.classList.add('stack');
  const rows = [...table.rows];
  const header = rows.find((r) => r.parentElement?.tagName !== 'TFOOT' && r.cells.length && [...r.cells].every((c) => c.tagName === 'TH'));
  const labels: string[] = [];
  for (const c of header?.cells ?? []) {
    labels.push((c.textContent ?? '').trim());
    for (let i = 1; i < c.colSpan; i++) labels.push('');
  }
  header?.classList.add('m-header');
  for (const row of rows) {
    if (row === header) continue;
    let col = 0;
    [...row.cells].forEach((cell, i) => {
      cell.dataset.label = labels[col] ?? '';
      // cells without a column header (actions, outcome, links) join the title line
      cell.classList.toggle('m-head', i < heads || !cell.dataset.label);
      col += cell.colSpan;
    });
  }
}
export const vStack: Directive<HTMLTableElement, number | undefined> = {
  mounted: (el, binding) => stackLabels(el, binding.value),
  updated: (el, binding) => stackLabels(el, binding.value),
};

/** The first `step` items of a long list; `showAll` lifts the limit (ShowMore renders the button). */
export function useLimit<T>(list: Ref<T[]>, step = 20) {
  const all = ref(false);
  const shown = computed(() => (all.value ? list.value : list.value.slice(0, step)));
  const hidden = computed(() => (all.value ? 0 : Math.max(0, list.value.length - step)));
  return { shown, hidden, total: computed(() => list.value.length), showAll: () => (all.value = true) };
}
