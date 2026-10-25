<script setup lang="ts">
import Icon from './Icon.vue';
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';
import { liveHints, useLive, type DataEvent } from '../live';

/** Hints when other members sync: who pasted what, linked to the page showing it. */
const { t } = useI18n();
const { ctx, uni } = useUni();

interface Toast {
  id: number;
  text: string;
  to: object | null;
}
const toasts = ref<Toast[]>([]);
let nextId = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();

/** Order of the parts of a hint, with the page each one links to. */
const PAGES: [string, string][] = [
  ['galaxy_systems', 'browse'],
  ['spy_reports', 'spy'],
  ['battle_reports', 'raids'],
  ['recycle_reports', 'raids'],
  ['fleet_returns', 'raids'],
  ['hostile_spying', 'hostile'],
  ['expeditions', 'expeditions'],
  ['battle_hall', 'battle-hall'],
  ['combat_reports', 'battle-hall'],
  ['player_scores', 'stats'],
  ['alliance_scores', 'stats'],
  ['empire', 'imperium'],
  ['overview', 'imperium'],
  ['fleets', 'imperium'],
];

function describe(e: DataEvent): Toast | null {
  const parts: string[] = [];
  let to: object | null = null;
  const seen = new Set<string>();
  for (const [table, page] of PAGES) {
    const n = e.counts?.[table];
    if (!n) continue;
    let text = t(`live.tables.${table}`, { n }, n);
    if (table === 'galaxy_systems' && e.systems?.length && e.systems.length <= 3) text = t('live.systems', { systems: e.systems.join(', ') });
    // statistics: one hint for the page, not one per type
    if (seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
    if (!to) {
      const [g, s] = table === 'galaxy_systems' && e.systems?.length ? e.systems[0].split(':') : [];
      to = { path: `/${uni.value}/${page}`, query: g ? { g, s } : {} };
    }
  }
  if (!parts.length) return null;
  const name = ctx.value?.members.find((m) => m.id === e.userId)?.name ?? '?';
  return { id: ++nextId, text: t('live.synced', { name, what: parts.join(', ') }), to };
}

function describeComment(e: DataEvent): Toast | null {
  const c = e.comment;
  if (!c) return null;
  const name = ctx.value?.members.find((m) => m.id === e.userId)?.name ?? '?';
  if (c.player) {
    return { id: ++nextId, text: t('live.commentPlayer', { name, player: c.playerName ?? '?' }), to: { query: { player: String(c.player) } } };
  }
  if (c.plan) {
    return { id: ++nextId, text: t('live.commentSettlement', { name }), to: { path: `/${uni.value}/raid-planner/${c.plan}/loot` } };
  }
  const [g, s, p] = (c.coords ?? '').split(':');
  return {
    id: ++nextId,
    text: t('live.commentPlanet', { name, coords: `${c.coords}${c.moon ? ` (${t('common.moon')})` : ''}` }),
    to: { path: `/${uni.value}/spy`, query: { c: `${g}:${s}:${p}`, type: c.moon ? 'moon' : 'planet' } },
  };
}

function dismiss(id: number) {
  toasts.value = toasts.value.filter((x) => x.id !== id);
}

useLive((e) => {
  // own pastes are shown by the sync page itself
  if (!liveHints.value || e.type !== 'data' || !e.userId || e.userId === ctx.value?.me.id) return;
  const toast = e.comment ? describeComment(e) : describe(e);
  if (!toast) return;
  toasts.value = [...toasts.value.slice(-2), toast];
  const timer = setTimeout(() => {
    timers.delete(timer);
    dismiss(toast.id);
  }, 8000);
  timers.add(timer);
});
onBeforeUnmount(() => timers.forEach(clearTimeout));
</script>

<template>
  <div class="live-toasts" aria-live="polite">
    <div v-for="toast in toasts" :key="toast.id" class="live-toast">
      <RouterLink v-if="toast.to" :to="toast.to" @click="dismiss(toast.id)">{{ toast.text }}</RouterLink>
      <span v-else>{{ toast.text }}</span>
      <button class="close" :title="t('live.close')" :aria-label="t('live.close')" @click="dismiss(toast.id)"><Icon name="close" :size="14" /></button>
    </div>
  </div>
</template>

<style scoped>
.live-toasts {
  position: fixed; right: 16px; bottom: 16px; z-index: 60; display: flex; flex-direction: column; gap: 8px;
  max-width: min(380px, calc(100vw - 32px)); pointer-events: none;
}
.live-toast {
  display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; pointer-events: auto;
  background: var(--surface-2); border: 1px solid var(--border); border-left: 3px solid var(--accent);
  border-radius: var(--radius); box-shadow: 0 6px 20px rgba(0, 0, 0, .35); font-size: 13px;
}
.live-toast a, .live-toast span { flex: 1; color: var(--text); }
.close { padding: 0 4px; border: 0; background: none; color: var(--muted); line-height: 1.2; }
@media (max-width: 800px) {
  /* above the bottom tab bar */
  .live-toasts { left: 12px; right: 12px; bottom: calc(var(--tabbar-h) + 12px + env(safe-area-inset-bottom)); max-width: none; }
}
</style>
