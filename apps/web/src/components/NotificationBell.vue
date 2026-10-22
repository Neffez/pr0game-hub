<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useUni } from '../composables';
import { attacks, markSeen, notifications, notifyClock, unseen } from '../notifications';
import { abbr, fmt, name } from '../format';
import NavIcon from './NavIcon.vue';

/** Bell with the number of unseen notifications; the list opens below it. */
const { t, locale } = useI18n();
const { uni } = useUni();
const router = useRouter();
const open = ref(false);

function toggle() {
  open.value = !open.value;
  if (open.value) markSeen();
}
function show() {
  open.value = false;
  router.push(`/${uni.value}/fleet`);
}

const at = (b: { coords: { g: number; s: number; p: number }; type: string | null; name: string | null }) =>
  `${b.name ? b.name + ' ' : ''}${b.type === 'moon' ? '☾ ' : ''}[${b.coords.g}:${b.coords.s}:${b.coords.p}]`;
const ships = (s: Record<string, number>) =>
  Object.entries(s)
    .map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`)
    .join(' · ');
const shipsTitle = (s: Record<string, number>) =>
  Object.entries(s)
    .map(([id, n]) => `${fmt(n)} ${name(id)}`)
    .join('\n');
const clock = (epoch: number) => new Date(epoch * 1000).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function left(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <span class="bell-wrap">
    <button
      class="bell"
      :class="{ alarm: attacks > 0, active: open }"
      :title="t('notify.title')"
      :aria-label="t('notify.title')"
      :aria-expanded="open"
      @click="toggle"
    >
      <NavIcon name="bell" />
      <span v-if="unseen || attacks" class="bell-count">{{ unseen || attacks }}</span>
    </button>
    <template v-if="open">
      <div class="bell-backdrop" @click="open = false" />
      <div class="bell-panel card" role="dialog" :aria-label="t('notify.title')">
        <div class="row" style="margin-bottom: 6px">
          <b>{{ t('notify.title') }}</b>
          <span class="grow" />
          <button class="bell-close" :aria-label="t('live.close')" @click="open = false">✕</button>
        </div>
        <p v-if="!notifications.length" class="muted small" style="margin: 0">{{ t('notify.none') }}</p>
        <button v-for="n in notifications" :key="n.id" class="bell-item" @click="show">
          <span class="neg"><b>⚔ {{ t('notify.attack', { member: n.member }) }}</b> · {{ n.fleet.missionName }}</span>
          <span class="small">
            {{ n.fleet.to ? at(n.fleet.to) : '' }} ·
            <span class="mono">{{ clock(n.time) }}</span>
            <span class="mono muted"> ({{ left(n.time - notifyClock) }})</span>
          </span>
          <span class="small muted">
            {{ t('notify.from') }} <template v-if="n.fleet.player">{{ n.fleet.player }} </template>{{ at(n.fleet.from) }}
          </span>
          <span v-if="Object.keys(n.fleet.ships).length" class="small muted" :title="shipsTitle(n.fleet.ships)">{{ ships(n.fleet.ships) }}</span>
        </button>
      </div>
    </template>
  </span>
</template>

<style scoped>
.bell-wrap { position: relative; display: inline-flex; }
.bell { position: relative; display: inline-flex; align-items: center; padding: 4px 6px; min-height: 0; background: none; border: 0; color: var(--muted); }
.bell:hover, .bell.active { color: var(--text); }
.bell.alarm { color: var(--neg); }
.bell-count {
  position: absolute; top: -2px; right: -4px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: var(--neg); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center;
}
.bell-backdrop { position: fixed; inset: 0; z-index: 40; }
.bell-panel {
  position: fixed; z-index: 41; top: 10px; left: 220px; width: min(380px, calc(100vw - 32px)); max-height: 70vh; overflow-y: auto;
  margin: 0; box-shadow: 0 8px 30px rgba(0, 0, 0, .5); text-align: left; font-weight: normal; font-size: 14px;
}
.bell-close { min-height: 0; padding: 2px 8px; }
.bell-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 8px; margin-top: 4px; text-align: left;
  background: color-mix(in srgb, var(--neg) 10%, var(--surface-2)); border: 0; border-left: 3px solid var(--neg); border-radius: 4px; color: var(--text);
}
.bell-item:hover { background: color-mix(in srgb, var(--neg) 18%, var(--surface-2)); }
@media (max-width: 800px) {
  .bell-panel { top: calc(var(--topbar-h) + env(safe-area-inset-top) + 6px); left: 16px; right: 16px; width: auto; }
}
</style>
