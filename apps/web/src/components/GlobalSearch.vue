<script setup lang="ts">
import Icon from './Icon.vue';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import { useFocusTrap, useScrollLock, useUni } from '../composables';
import { coords } from '../format';

/**
 * Global search (Ctrl+K, "/" or the search button): players (also former names), alliances, coordinates and the
 * hub's pages in one list; arrow keys and Enter pick an entry. Players open in the player dialog above the current
 * page, alliances as a filter of the overview, coordinates in the spy history or the galaxy.
 */
const props = defineProps<{ pages: { to: string; label: string; icon: string }[] }>();
const open = defineModel<boolean>({ required: true });
const { t } = useI18n();
const { uni } = useUni();
const route = useRoute();
const router = useRouter();

interface Result {
  players: { id: number; name: string; status: string[]; ally_tag: string | null; ally_name: string | null; alias: string | null }[];
  alliances: { id: number; name: string; tag: string | null; players: number }[];
  planet:
    | { g: number; s: number; p: number; name?: string | null; has_moon?: boolean; moon_name?: string | null; destroyed?: boolean; player_id?: number | null; player_name?: string | null; ally_tag?: string | null }
    | null;
}
interface Item {
  key: string;
  group: 'pages' | 'coords' | 'players' | 'alliances';
  icon: string;
  label: string;
  detail?: string;
  go: () => unknown;
}

const q = ref('');
const result = ref<Result | null>(null);
const loading = ref(false);
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);
const panel = ref<HTMLElement | null>(null);
useScrollLock(open);
useFocusTrap(panel, open);

watch(open, async (on) => {
  if (!on) return;
  q.value = '';
  result.value = null;
  active.value = 0;
  await nextTick();
  input.value?.focus();
});

/** Counts requests: an answer that arrives after newer input is dropped. */
let runs = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
watch(q, (term) => {
  clearTimeout(timer);
  active.value = 0;
  const current = ++runs;
  if (term.trim().length < 2 && !/^\[?\d/.test(term.trim())) {
    result.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  timer = setTimeout(async () => {
    try {
      const res = await uniApi<Result>(uni.value, `/search?q=${encodeURIComponent(term.trim())}`);
      if (current === runs) result.value = res;
    } catch {
      if (current === runs) result.value = null;
    } finally {
      if (current === runs) loading.value = false;
    }
  }, 180);
});

const go = (path: string, query: Record<string, string | number> = {}) => router.push({ path: `/${uni.value}/${path}`, query });
const openPlayer = (id: number) => router.push({ query: { ...route.query, player: String(id) } });

const items = computed<Item[]>(() => {
  const term = q.value.trim().toLowerCase();
  const out: Item[] = [];
  const r = result.value;
  if (r?.planet) {
    const p = r.planet;
    const pos = coords(p.g, p.s, p.p);
    const owner = p.player_name ? `${p.player_name}${p.ally_tag ? ` [${p.ally_tag}]` : ''}` : t('search.unknownPlanet');
    out.push({ key: 'spy', group: 'coords', icon: 'spy', label: t('search.spyHistory', { coords: pos }), detail: p.name ? `${p.name} · ${owner}` : owner, go: () => go('spy', { c: `${p.g}:${p.s}:${p.p}`, type: 'planet' }) });
    if (p.has_moon) {
      out.push({ key: 'spy-moon', group: 'coords', icon: 'moon', label: t('search.spyHistoryMoon', { coords: pos }), detail: p.moon_name ?? undefined, go: () => go('spy', { c: `${p.g}:${p.s}:${p.p}`, type: 'moon' }) });
    }
    out.push({ key: 'galaxy', group: 'coords', icon: 'galaxy', label: t('search.galaxy', { system: `${p.g}:${p.s}` }), go: () => go('browse', { g: p.g, s: p.s }) });
    if (p.player_id) out.push({ key: 'owner', group: 'coords', icon: 'user', label: p.player_name!, detail: t('search.owner'), go: () => openPlayer(p.player_id!) });
  }
  for (const pl of r?.players ?? []) {
    const detail = [pl.ally_tag ? `[${pl.ally_tag}]` : '', pl.alias ? t('search.formerName', { name: pl.alias }) : ''].filter(Boolean).join(' · ');
    out.push({ key: `p${pl.id}`, group: 'players', icon: 'user', label: pl.name, detail: detail || undefined, go: () => openPlayer(pl.id) });
  }
  for (const a of r?.alliances ?? []) {
    out.push({
      key: `a${a.id}`,
      group: 'alliances',
      icon: 'planets',
      label: a.tag ? `[${a.tag}] ${a.name}` : a.name,
      detail: t('search.alliancePlayers', { n: a.players }, a.players),
      go: () => go('overview', { ally: a.tag || a.name }),
    });
  }
  if (term) {
    for (const pg of props.pages) {
      if (t(`nav.${pg.label}`).toLowerCase().includes(term)) out.push({ key: `page-${pg.to}`, group: 'pages', icon: pg.icon, label: t(`nav.${pg.label}`), go: () => go(pg.to) });
    }
  }
  return out;
});
const GROUPS = ['coords', 'players', 'alliances', 'pages'] as const;
const groups = computed(() =>
  GROUPS.map((g) => ({ group: g, items: items.value.map((it, i) => ({ ...it, index: i })).filter((it) => it.group === g) })).filter((g) => g.items.length),
);

function pick(item: Item | undefined) {
  if (!item) return;
  open.value = false;
  item.go();
}
function onKey(e: KeyboardEvent) {
  const n = items.value.length;
  if (e.key === 'Escape') {
    e.preventDefault();
    open.value = false;
  } else if (e.key === 'ArrowDown' && n) {
    e.preventDefault();
    active.value = (active.value + 1) % n;
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault();
    active.value = (active.value - 1 + n) % n;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    pick(items.value[active.value]);
  }
}
watch(active, async (i) => {
  await nextTick();
  panel.value?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="search-backdrop" @click.self="open = false">
      <div ref="panel" class="search-panel" role="dialog" aria-modal="true" :aria-label="t('search.title')" tabindex="-1" @keydown="onKey">
        <div class="search-field">
          <Icon name="search" :size="18" />
          <input
            ref="input"
            v-model="q"
            type="text"
            enterkeyhint="go"
            :placeholder="t('search.placeholder')"
            :aria-label="t('search.placeholder')"
            role="combobox"
            aria-controls="global-search-list"
            :aria-expanded="items.length > 0"
            :aria-activedescendant="items.length ? `global-search-${active}` : undefined"
            autocomplete="off"
            spellcheck="false"
          />
          <button class="icon-btn small" :title="t('search.close')" :aria-label="t('search.close')" @click="open = false"><Icon name="close" /></button>
        </div>
        <div id="global-search-list" class="search-results" role="listbox">
          <template v-for="g in groups" :key="g.group">
            <div class="search-group">{{ t(`search.groups.${g.group}`) }}</div>
            <button
              v-for="it in g.items"
              :id="`global-search-${it.index}`"
              :key="it.key"
              type="button"
              role="option"
              class="search-item"
              :class="{ active: it.index === active }"
              :aria-selected="it.index === active"
              :data-index="it.index"
              @mousemove="active = it.index"
              @click="pick(it)"
            >
              <Icon :name="it.icon" :size="16" />
              <span class="search-label">{{ it.label }}</span>
              <span v-if="it.detail" class="search-detail">{{ it.detail }}</span>
            </button>
          </template>
          <p v-if="!items.length" class="muted small search-empty">
            {{ loading ? t('search.searching') : q.trim() ? t('search.nothing') : t('search.hint') }}
          </p>
        </div>
        <div class="search-foot small muted">{{ t('search.keys') }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.search-backdrop {
  position: fixed; inset: 0; z-index: 45; display: flex; justify-content: center; align-items: flex-start;
  padding: 12vh 16px 16px; background: rgba(0, 0, 0, 0.6);
}
.search-panel {
  width: 100%; max-width: 620px; display: flex; flex-direction: column; max-height: 70vh;
  background: var(--bg, var(--surface)); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.search-field { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.search-field input { flex: 1; min-width: 0; border: 0; background: transparent; font-size: 16px; padding: 4px 0; outline: none; box-shadow: none; }
.search-results { overflow-y: auto; padding: 6px; }
.search-group { padding: 8px 8px 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.search-item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; text-align: left;
  background: transparent; border: 0; border-radius: 6px; color: inherit; min-height: 0;
}
.search-item.active { background: var(--surface-2, rgba(255, 255, 255, 0.06)); color: var(--accent); }
.search-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search-detail { margin-left: auto; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search-empty { padding: 10px; margin: 0; }
.search-foot { padding: 6px 12px; border-top: 1px solid var(--border); }
@media (max-width: 800px) {
  .search-backdrop { padding: 0; }
  .search-panel { max-width: none; max-height: none; height: 100%; border-radius: 0; border: 0; padding-top: env(safe-area-inset-top); }
  .search-foot { display: none; }
}
</style>
