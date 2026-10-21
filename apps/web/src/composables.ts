import { computed, inject, provide, ref, watch, type InjectionKey, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { UniverseSettings } from './format';

export interface UniContext {
  universe: { id: number; slug: string; name: string; settings: UniverseSettings; deck: { type: string; size: string; count: number }[] };
  group: { id: number; name: string; role: string };
  /** name = in-game name, falls back to the hub username */
  members: { id: number; username: string; name: string; role: string; ingame_name: string | null }[];
  me: { id: number; username: string; isAdmin: boolean };
  /** own research and planets from the latest own empire page */
  own: {
    time: number;
    research: Record<string, number>;
    planets: { name: string; coords: { g: number; s: number; p: number }; type: 'planet' | 'moon' }[];
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
  const indicator = (k: string) => (key.value === k ? (descending.value ? ' ▾' : ' ▴') : '');
  return { sorted, sortBy, indicator, key, descending };
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
