<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';
import { ago } from '../format';
import { presence, type PresenceMember } from '../live';

/** Sidebar: alliance members with the hub open (where they are, linked) and when the others were last online. */
const props = defineProps<{ pageLabel: (page: string | null) => string }>();
const emit = defineEmits<{ navigate: [] }>();
const { t } = useI18n();
const { ctx, uni } = useUni();

const online = computed(() => {
  const byId = new Map(presence.value.map((p) => [p.userId, p]));
  return (ctx.value?.members ?? [])
    .filter((m) => m.id !== ctx.value?.me.id && byId.has(m.id))
    .map((m) => ({ ...m, at: byId.get(m.id)! }));
});
const offline = computed(() => {
  const ids = new Set(presence.value.map((p) => p.userId));
  return (ctx.value?.members ?? [])
    .filter((m) => m.id !== ctx.value?.me.id && !ids.has(m.id))
    .sort((a, b) => (b.last_seen_at ?? 0) - (a.last_seen_at ?? 0));
});

/** Where a member is, as text and link to the same place. */
function where(p: PresenceMember) {
  if (!p.page) return null;
  const query: Record<string, string> = {};
  if (p.g && p.s) Object.assign(query, { g: String(p.g), s: String(p.s) });
  let path = `/${uni.value}/${p.page}`;
  if (p.page === 'player' && p.player) path += `/${p.player}`;
  else if (p.player) query.player = String(p.player);
  const label = props.pageLabel(p.page) || p.page;
  return { text: p.g && p.s ? `${label} ${p.g}:${p.s}` : label, to: { path, query } };
}
</script>

<template>
  <div class="presence">
    <div class="section">{{ t('presence.online', { n: online.length }) }}</div>
    <div v-for="m in online" :key="m.id" class="member">
      <span class="dot" :class="{ away: !m.at.active }" :title="m.at.active ? t('presence.active') : t('presence.away')" />
      <span class="name">{{ m.name }}</span>
      <RouterLink v-if="where(m.at)" class="where" :to="where(m.at)!.to" @click="emit('navigate')">{{ where(m.at)!.text }}</RouterLink>
    </div>
    <details v-if="offline.length" class="offline">
      <summary class="muted small">{{ t('presence.offline', { n: offline.length }) }}</summary>
      <div v-for="m in offline" :key="m.id" class="member muted">
        <span class="dot off" />
        <span class="name">{{ m.name }}</span>
        <span class="where">{{ m.last_seen_at ? t('presence.lastSeen', { ago: ago(m.last_seen_at) }) : '' }}</span>
      </div>
    </details>
  </div>
</template>

<style scoped>
.presence { padding: 0 0 4px; }
.member { display: flex; align-items: center; gap: 6px; padding: 2px 10px; font-size: 12px; min-width: 0; }
.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.where { margin-left: auto; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
a.where:hover { color: var(--accent); }
.dot { flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%; background: var(--pos); }
.dot.away { background: var(--warn); }
.dot.off { background: var(--faint); }
.offline summary { cursor: pointer; padding: 2px 10px; }
</style>
