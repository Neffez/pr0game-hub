<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';
import { ago } from '../format';
import { presence, type PresenceMember } from '../live';

/** Sidebar: alliance members with the hub open (where they are, linked) and when the others were last online. */
const props = defineProps<{ pageLabel: (page: string | null) => string }>();
const emit = defineEmits<{ navigate: [] }>();
const { t } = useI18n();
const { ctx, uni } = useUni();

/** Online members, the viewer first (always online here, even before their own connection is reported). */
const online = computed(() => {
  const byId = new Map(presence.value.map((p) => [p.userId, p]));
  const me = ctx.value?.me.id;
  return (ctx.value?.members ?? [])
    .filter((m) => m.id === me || byId.has(m.id))
    .map((m) => ({ ...m, me: m.id === me, at: byId.get(m.id) ?? { userId: m.id, page: null, active: true } }))
    .sort((a, b) => Number(b.me) - Number(a.me));
});
/** Heading with the alliance's full name; the tag (if set) replaces it only where the name does not fit on the line. */
const onlineTitle = computed(() => t('presence.online', { n: online.value.length, group: ctx.value?.group.name ?? '' }));
const onlineTag = computed(() => {
  const tag = ctx.value?.group.tag;
  return tag ? t('presence.online', { n: online.value.length, group: tag }) : null;
});
const head = ref<HTMLElement | null>(null);
const probe = ref<HTMLElement | null>(null);
const fits = ref(true);
const onlineHeading = computed(() => (fits.value || !onlineTag.value ? onlineTitle.value : onlineTag.value));
/** Measures the full heading (hidden probe with the same text style) against the room the line has. */
function measure() {
  const el = head.value;
  const pr = probe.value;
  if (!el || !pr) return;
  const css = getComputedStyle(el);
  fits.value = pr.offsetWidth <= el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  measure();
  if (head.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    observer.observe(head.value);
  }
  document.fonts?.ready.then(measure);
});
onBeforeUnmount(() => observer?.disconnect());
watch(onlineTitle, () => nextTick(measure));
const offline = computed(() => {
  const ids = new Set(presence.value.map((p) => p.userId));
  return (ctx.value?.members ?? [])
    .filter((m) => m.id !== ctx.value?.me.id && !ids.has(m.id))
    .sort((a, b) => (b.last_seen_at ?? 0) - (a.last_seen_at ?? 0));
});

/** Name colour by role: global admin light blue, alliance admin green, members plain. */
const roleClass = (m: { role: string; global_admin: number }) => (m.global_admin ? 'global-admin' : m.role === 'admin' ? 'group-admin' : '');
const roleTitle = (m: { role: string; global_admin: number }) =>
  m.global_admin ? t('presence.globalAdmin') : m.role === 'admin' ? t('admin.roles.admin') : undefined;
/** Role stays in the title; the in-game name is added when it differs from the display name. */
const nameTitle = (m: { role: string; global_admin: number; name: string; ingame_name: string | null }) => {
  const role = roleTitle(m);
  const ingame = m.ingame_name && m.ingame_name !== m.name ? m.ingame_name : null;
  return [role, ingame].filter(Boolean).join(' · ') || undefined;
};

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
    <div ref="head" class="section one-line" :title="onlineTitle"><span ref="probe" class="probe" aria-hidden="true">{{ onlineTitle }}</span>{{ onlineHeading }}</div>
    <div v-for="m in online" :key="m.id" class="member">
      <span class="dot" :class="{ away: !m.at.active }" :title="m.at.active ? t('presence.active') : t('presence.away')" />
      <span class="name" :class="roleClass(m)" :title="nameTitle(m)">{{ m.name }}<span v-if="m.me" class="muted"> ({{ t('presence.you') }})</span></span>
      <RouterLink v-if="!m.me && where(m.at)" class="where" :to="where(m.at)!.to" @click="emit('navigate')">{{ where(m.at)!.text }}</RouterLink>
    </div>
    <details v-if="offline.length" class="offline">
      <summary class="muted small">{{ t('presence.offline', { n: offline.length }) }}</summary>
      <div v-for="m in offline" :key="m.id" class="member muted">
        <span class="dot off" />
        <span class="name" :class="roleClass(m)" :title="nameTitle(m)">{{ m.name }}</span>
        <span class="where">{{ m.last_seen_at ? t('presence.lastSeen', { ago: ago(m.last_seen_at) }) : '' }}</span>
      </div>
    </details>
  </div>
</template>

<style scoped>
.presence { padding: 0 0 4px; }
.presence .one-line { position: relative; }
.presence .probe { position: absolute; visibility: hidden; white-space: nowrap; pointer-events: none; }
.member { display: flex; align-items: center; gap: 6px; padding: 2px 10px; font-size: 12px; min-width: 0; }
.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.name.group-admin { color: var(--pos); }
.name.global-admin { color: var(--info); }
.where { margin-left: auto; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
a.where:hover { color: var(--accent); }
.dot { flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%; background: var(--pos); }
.dot.away { background: var(--warn); }
.dot.off { background: var(--faint); }
.offline summary { cursor: pointer; padding: 2px 10px; }
</style>
