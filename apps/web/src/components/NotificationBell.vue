<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useUni } from '../composables';
import { attacks, markSeen, notifications, unseen, type CommentNotification, type Notification } from '../notifications';
import { abbr, fmt, name } from '../format';
import NavIcon from './NavIcon.vue';
import Ticker from './Ticker.vue';

/** Bell with the number of unseen notifications; the list opens below it. */
const { t, locale } = useI18n();
const { uni } = useUni();
const router = useRouter();
const open = ref(false);

function toggle() {
  open.value = !open.value;
  if (open.value) markSeen();
}
function show(n: Notification) {
  open.value = false;
  router.push(target(n));
}
function target(n: Notification) {
  switch (n.kind) {
    case 'invite':
    case 'launch':
      return { path: `/${uni.value}/raid-planner`, query: { plan: n.plan.id } };
    case 'fleet':
      return `/${uni.value}/imperium`;
    case 'storage':
      return { path: `/${uni.value}/build`, query: { tab: 'buildings', c: `${n.planet.g}:${n.planet.s}:${n.planet.p}`, type: 'planet' } };
    case 'building':
      return {
        path: `/${uni.value}/build`,
        query: { tab: n.element >= 100 ? 'research' : 'buildings', c: `${n.planet.g}:${n.planet.s}:${n.planet.p}`, type: n.planet.type },
      };
    case 'comment':
      if ('plan' in n.thread) return `/${uni.value}/raid-planner/${n.thread.plan}/loot`;
      return 'player' in n.thread
        ? `/${uni.value}/player/${n.thread.player}`
        : { path: `/${uni.value}/spy`, query: { c: `${n.thread.g}:${n.thread.s}:${n.thread.p}`, type: n.thread.type } };
    default:
      return `/${uni.value}/fleet`;
  }
}
const threadOf = (n: CommentNotification) =>
  'player' in n.thread
    ? n.thread.name
    : 'plan' in n.thread
    ? t('notify.settlement', { at: `${n.thread.type === 'moon' ? '☾ ' : ''}[${n.thread.g}:${n.thread.s}:${n.thread.p}]` })
    : `${n.thread.owner ? n.thread.owner + ' ' : ''}${n.thread.type === 'moon' ? '☾ ' : ''}[${n.thread.g}:${n.thread.s}:${n.thread.p}]`;
/** Storage building of a resource (901-903 → 22-24). */
const storageOf = (res: number) => res - 879;
const coords = (b: { g: number; s: number; p: number }, moon: boolean) => `${moon ? '☾ ' : ''}[${b.g}:${b.s}:${b.p}]`;

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
const clock = (epoch: number) => new Date(epoch * 1000).toLocaleTimeString(locale.value, { hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit' });
/** Target time of a plan as precise as it is known. */
function planTime(epoch: number, precision: 'day' | 'hour' | 'exact') {
  const day = { weekday: 'short', day: '2-digit', month: '2-digit' } as const;
  const d = new Date(epoch * 1000);
  if (precision === 'day') return d.toLocaleDateString(locale.value, day);
  const time = d.toLocaleString(locale.value, { ...day, hour: '2-digit', hourCycle: 'h23', minute: '2-digit', ...(precision === 'exact' ? { second: '2-digit' } : {}) });
  return precision === 'hour' ? t('plans.around', { t: time }) : time;
}
/** Clock time today, else with the day. */
const since = (epoch: number) => (new Date(epoch * 1000).toDateString() === new Date().toDateString() ? clock(epoch) : planTime(epoch, 'exact'));
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
      <span v-if="unseen || attacks" class="bell-count" :class="{ calm: !attacks }">{{ unseen || attacks }}</span>
    </button>
    <!-- in the body: above everything of the page (the sidebar's stacking context would keep it below the content) -->
    <Teleport v-if="open" to="body">
      <div class="bell-backdrop" @click="open = false" />
      <div class="bell-panel card" role="dialog" :aria-label="t('notify.title')">
        <div class="row" style="margin-bottom: 6px">
          <b>{{ t('notify.title') }}</b>
          <span class="grow" />
          <button class="bell-close" :aria-label="t('live.close')" @click="open = false">✕</button>
        </div>
        <p v-if="!notifications.length" class="muted small" style="margin: 0">{{ t('notify.none') }}</p>
        <template v-for="n in notifications" :key="n.id">
          <button v-if="n.kind === 'invite'" class="bell-item invite" @click="show(n)">
            <span><b>✉ {{ t('notify.invite', { member: n.member }) }}</b> · {{ n.plan.mission === 'hold' ? t('hold.badge') : t('notify.raid') }}</span>
            <span class="small">
              <template v-if="n.plan.g != null">{{ n.plan.planet_type === 'moon' ? '☾ ' : '' }}[{{ n.plan.g }}:{{ n.plan.s }}:{{ n.plan.p }}]</template>
              <span v-else class="warn">{{ t('plans.coordsMissing') }}</span> ·
              <span class="mono">{{ planTime(n.time, n.plan.time_precision) }}</span>
              <Ticker v-if="n.plan.time_precision === 'exact'" v-slot="{ now }"><span class="mono muted"> ({{ left(Math.max(0, n.time - now)) }})</span></Ticker>
            </span>
          </button>
          <button v-else-if="n.kind === 'launch'" class="bell-item launch" @click="show(n)">
            <span><b>🚀 {{ t('notify.launch') }}</b> · {{ n.plan.mission === 'hold' ? t('hold.badge') : t('notify.raid') }}</span>
            <span class="small">
              {{ coords(n.from, n.from.type === 'moon') }} → {{ coords(n.plan, n.plan.planet_type === 'moon') }} ·
              <span class="mono">{{ clock(n.time) }}</span>
              <Ticker v-slot="{ now }"><span class="mono muted"> ({{ left(Math.max(0, n.time - now)) }})</span></Ticker>
            </span>
          </button>
          <button v-else-if="n.kind === 'building'" class="bell-item building" @click="show(n)">
            <span><b>{{ n.element >= 100 ? '🔬' : '🏗' }} {{ t(n.element >= 100 ? 'notify.research' : 'notify.building', { name: name(n.element), level: n.level }) }}</b></span>
            <span class="small">{{ n.planet.name ? n.planet.name + ' ' : '' }}{{ coords(n.planet, n.planet.type === 'moon') }}</span>
          </button>
          <button v-else-if="n.kind === 'storage'" class="bell-item storage" @click="show(n)">
            <span><b>📦 {{ t('notify.storage', { name: name(storageOf(n.resource)) }) }}</b></span>
            <span class="small">{{ n.planet.name ? n.planet.name + ' ' : '' }}{{ coords(n.planet, false) }} · {{ t('notify.storageSince', { t: since(n.time) }) }}</span>
          </button>
          <button v-else-if="n.kind === 'fleet'" class="bell-item fleet" @click="show(n)">
            <span><b>{{ n.fleet.phase === 'return' ? '↩' : '✈' }} {{ t(n.fleet.phase === 'return' ? 'notify.fleetBack' : 'notify.fleet', { mission: n.fleet.missionName }) }}</b></span>
            <span class="small">
              {{ at(n.fleet.from) }}<template v-if="n.fleet.to"> → {{ at(n.fleet.to) }}</template> ·
              <span class="mono">{{ clock(n.time) }}</span>
              <Ticker v-slot="{ now }"><span class="mono muted"> ({{ left(Math.max(0, n.time - now)) }})</span></Ticker>
            </span>
            <span v-if="Object.keys(n.fleet.ships).length" class="small muted" :title="shipsTitle(n.fleet.ships)">{{ ships(n.fleet.ships) }}</span>
          </button>
          <button v-else-if="n.kind === 'comment'" class="bell-item comment" @click="show(n)">
            <span><b>💬 {{ t('notify.comment', { member: n.member, on: threadOf(n) }) }}</b><template v-if="n.count > 1"> · {{ t('notify.comments', { n: n.count }) }}</template></span>
            <span class="small muted">{{ n.excerpt }}</span>
          </button>
          <button v-else class="bell-item" @click="show(n)">
            <span class="neg"><b>⚔ {{ t('notify.attack', { member: n.member }) }}</b> · {{ n.fleets > 1 ? t('notify.acs', { n: n.fleets }) : n.fleet.missionName }}</span>
            <span class="small">
              {{ n.fleet.to ? at(n.fleet.to) : '' }} ·
              <span class="mono">{{ clock(n.time) }}</span>
              <Ticker v-slot="{ now }"><span class="mono muted"> ({{ left(Math.max(0, n.time - now)) }})</span></Ticker>
            </span>
            <span class="small muted">
              {{ t('notify.from') }} <template v-if="n.fleet.player ?? n.fleet.fromPlayer">{{ n.fleet.player ?? n.fleet.fromPlayer!.name }} </template>{{ at(n.fleet.from) }}
            </span>
            <span v-if="Object.keys(n.fleet.ships).length" class="small muted" :title="shipsTitle(n.fleet.ships)">{{ ships(n.fleet.ships) }}</span>
          </button>
        </template>
      </div>
    </Teleport>
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
.bell-count.calm { background: var(--info); }
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
.bell-item.invite { background: var(--surface-2); border-left-color: var(--info); }
.bell-item.invite:hover { background: color-mix(in srgb, var(--info) 12%, var(--surface-2)); }
.bell-item.comment { background: var(--surface-2); border-left-color: var(--muted); }
.bell-item.comment:hover { background: color-mix(in srgb, var(--muted) 12%, var(--surface-2)); }
.bell-item.building { background: var(--surface-2); border-left-color: var(--pos); }
.bell-item.building:hover { background: color-mix(in srgb, var(--pos) 12%, var(--surface-2)); }
.bell-item.storage { background: var(--surface-2); border-left-color: var(--warn); }
.bell-item.storage:hover { background: color-mix(in srgb, var(--warn) 12%, var(--surface-2)); }
.bell-item.fleet { background: var(--surface-2); border-left-color: var(--accent); }
.bell-item.fleet:hover { background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)); }
.bell-item.launch { background: var(--surface-2); border-left-color: var(--warn); }
.bell-item.launch:hover { background: color-mix(in srgb, var(--warn) 12%, var(--surface-2)); }
@media (max-width: 800px) {
  .bell-panel { top: calc(var(--topbar-h) + env(safe-area-inset-top) + 6px); left: 16px; right: 16px; width: auto; }
}
</style>
