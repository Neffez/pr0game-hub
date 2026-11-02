<script lang="ts">
import type { BuildOrder as Order } from '@pr0hub/planner';

/** The viewer's stored build order (`GET /api/{uni}/build-order`). */
export interface StoredBuildOrder {
  order: Order;
  meta: { source?: string; basis?: string; settings?: unknown; mapping?: Record<string, string | null>; skipped?: string[]; names?: Record<string, string | null> };
  createdAt: number;
  updatedAt: number;
}
</script>

<script setup lang="ts">
import { compareSettings, simulate, type HubState, type Pr0planImport, type Step, type StepResult } from '@pr0hub/planner';
import { RESOURCES } from '@pr0hub/core/tech';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useClock } from '../clock';
import { useLoader, useStored, useUni } from '../composables';
import { dateTime, fmt, name, short } from '../format';
import { tables, useLiveReload } from '../live';
import BuildOrderImport from './BuildOrderImport.vue';
import Icon from './Icon.vue';
import Ticker from './Ticker.vue';

/**
 * Build order tab of build & research: the steps of the chosen planet in order with their timeline from the hub's
 * state (start, end, what they wait for), the next one highlighted; reorder by dragging (desktop) or the arrows,
 * check off, deactivate, remove. Import from pr0plan in a dialog; the file's settings are compared with the hub's.
 */
const props = defineProps<{ hub: HubState; planetKey: string; mobile: boolean }>();
const { t, locale } = useI18n();
const { ctx, uni } = useUni();
/** pr0plan as the universe settings link it (empty: none) */
const pr0planUrl = computed(() => ctx.value?.universe.settings.pr0planUrl || '');
const { data, error, load } = useLoader(() => uniApi<{ buildOrder: StoredBuildOrder | null }>(uni.value, '/build-order'));
onMounted(load);
useLiveReload(load, tables('build_orders'));

const stored = computed(() => data.value?.buildOrder ?? null);
const importOpen = ref(false);
const showDone = useStored('buildOrder.showDone', false);

const now = useClock();
/** the timeline is planned anew every minute (and on every change) */
const minute = computed(() => Math.floor(now.value / 60) * 60);
const sim = computed(() => (stored.value ? simulate(stored.value.order, props.hub, { now: minute.value }) : null));
const resultOf = computed(() => new Map((sim.value?.steps ?? []).map((r) => [r.id, r])));
const steps = computed<Step[]>(() => stored.value?.order.planets[props.planetKey] ?? []);
const nextId = computed(() => sim.value?.next[props.planetKey] ?? null);
interface Row {
  step: Step;
  result: StepResult | undefined;
  index: number;
}
const rows = computed<Row[]>(() => steps.value.map((step, index) => ({ step, result: resultOf.value.get(step.id), index })));
const isDone = (r: Row) => r.result?.state === 'done' || r.result?.state === 'queued';
const doneCount = computed(() => rows.value.filter(isDone).length);
const shownRows = computed(() => (showDone.value ? rows.value : rows.value.filter((r) => !isDone(r))));
const end = computed(() => Math.max(0, ...rows.value.map((r) => r.result?.end ?? 0)) || null);
const invalidCount = computed(() => rows.value.filter((r) => r.result?.state === 'invalid').length);

/** planets of the build order the hub has no synced data for */
const missingPlanets = computed(() => Object.keys(stored.value?.order.planets ?? {}).filter((k) => !props.hub.planets.some((p) => p.key === k)));
const otherPlanets = computed(() =>
  Object.entries(stored.value?.order.planets ?? {})
    .filter(([k, list]) => k !== props.planetKey && list.length && props.hub.planets.some((p) => p.key === k))
    .map(([k, list]) => ({ key: k, open: list.filter((s) => { const r = resultOf.value.get(s.id); return r && r.state !== 'done' && r.state !== 'queued'; }).length })),
);
const planetLabel = (key: string) => {
  const p = props.hub.planets.find((x) => x.key === key);
  return p ? `${p.name ? p.name + ' ' : ''}[${p.coords.g}:${p.coords.s}:${p.coords.p}]` : key;
};
const diffs = computed(() => {
  const s = stored.value;
  if (!s?.meta.settings || !s.meta.mapping) return [];
  return compareSettings({ planets: [], settings: s.meta.settings as Pr0planImport['settings'], skipped: [] }, props.hub, s.meta.mapping);
});

// ------------------------------------------------------------------ texts
function stepTitle(s: Step, r: StepResult | undefined): string {
  switch (s.kind) {
    case 'building':
    case 'research':
      return `${name(s.element!)} ${r?.target ?? ''}`;
    case 'ship':
    case 'defense':
      return `${fmt(s.count ?? 1)}× ${name(s.element!)}`;
    case 'prod': {
      const f = s.prod!.factors;
      return t('buildOrder.prodTitle', { m: Math.round((f[1] ?? 1) * 100), c: Math.round((f[2] ?? 1) * 100), d: Math.round((f[3] ?? 1) * 100) });
    }
    case 'transport':
      return t('buildOrder.transportTitle', { to: s.transport!.target ? planetLabel(s.transport!.target) : '–' });
  }
}
const kindIcon = (s: Step) => ({ building: 'buildings', research: 'research', ship: 'fleet', defense: 'target', prod: 'bolt', transport: 'cargo' })[s.kind];
const clock = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString(locale.value, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function countdown(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return d ? `${d}d ${hms}` : hms;
}
const stateClass = (r: Row) =>
  r.result?.state === 'invalid' ? 'neg' : r.result?.state === 'done' || r.result?.state === 'queued' ? 'pos' : r.result?.state === 'deactivated' ? 'faint' : '';

// ------------------------------------------------------------------ changes
const saving = ref(false);
async function save(list: Step[]) {
  const s = stored.value;
  if (!s) return;
  const planets = { ...s.order.planets, [props.planetKey]: list };
  // right away on the page, then on the server
  data.value = { buildOrder: { ...s, order: { ...s.order, planets } } };
  saving.value = true;
  try {
    data.value = await uniApi<{ buildOrder: StoredBuildOrder | null }>(uni.value, '/build-order', { method: 'PATCH', body: { planets } });
  } catch (e) {
    error.value = (e as Error).message;
    load();
  } finally {
    saving.value = false;
  }
}
function move(from: number, to: number) {
  if (to < 0 || to >= steps.value.length || from === to) return;
  const list = [...steps.value];
  const [s] = list.splice(from, 1);
  list.splice(to, 0, s);
  save(list);
}
const update = (i: number, change: Partial<Step>) => save(steps.value.map((s, n) => (n === i ? clean({ ...s, ...change }) : s)));
const remove = (i: number) => save(steps.value.filter((_, n) => n !== i));
/** flags that are off are left out */
function clean(s: Step): Step {
  const out = { ...s };
  if (!out.done) delete out.done;
  if (!out.deactivated) delete out.deactivated;
  return out;
}
async function removeAll() {
  if (!confirm(t('buildOrder.deleteConfirm'))) return;
  try {
    data.value = await uniApi<{ buildOrder: null }>(uni.value, '/build-order', { method: 'DELETE' });
  } catch (e) {
    error.value = (e as Error).message;
  }
}

// drag and drop (desktop)
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function onDrop(i: number) {
  if (dragFrom.value != null) move(dragFrom.value, i);
  dragFrom.value = null;
  dragOver.value = null;
}
</script>

<template>
  <div v-if="error" class="error">{{ error }}</div>
  <div class="card">
    <div class="row small">
      <template v-if="stored">
        <span class="muted">{{ t('buildOrder.imported', { time: dateTime(stored.createdAt) }) }}</span>
        <span v-if="end" class="muted">{{ t('buildOrder.doneAt', { time: clock(end) }) }}</span>
        <span v-if="saving" class="faint">{{ t('buildOrder.saving') }}</span>
      </template>
      <span v-else class="muted">{{ t('buildOrder.none') }}</span>
      <span class="grow" />
      <a v-if="pr0planUrl" :href="pr0planUrl" target="_blank" rel="noopener" class="small" :title="t('buildOrder.pr0planTitle')">
        {{ t('buildOrder.pr0plan') }} <Icon name="external" :size="12" />
      </a>
      <button class="primary small" @click="importOpen = true"><Icon name="plus" :size="14" /> {{ t('buildOrder.import') }}</button>
      <button v-if="stored" class="small" @click="removeAll">{{ t('buildOrder.delete') }}</button>
    </div>
    <div v-if="diffs.length" class="bo-warn small">
      <b class="warn">{{ t('buildOrder.settingsDiffer') }}</b>
      <span v-for="(d, i) in diffs" :key="i" class="bo-diff">
        {{ d.key === 'temp' ? t('buildOrder.diff.temp', { planet: planetLabel(d.planet!), file: d.file, hub: d.hub }) : t(`buildOrder.diff.${d.key}`, { file: d.file, hub: d.hub }) }}
      </span>
      <span class="muted">{{ t('buildOrder.hubWins') }}</span>
    </div>
    <p v-if="missingPlanets.length" class="warn small" style="margin: 8px 0 0">{{ t('buildOrder.missingPlanets', { list: missingPlanets.join(', ') }) }}</p>
    <p v-if="otherPlanets.length" class="small muted" style="margin: 8px 0 0">
      {{ t('buildOrder.otherPlanets') }}
      <span v-for="o in otherPlanets" :key="o.key" class="bo-other">{{ planetLabel(o.key) }} ({{ t('buildOrder.open', { n: o.open }) }})</span>
    </p>
  </div>

  <template v-if="stored">
    <p v-if="!steps.length" class="card muted">{{ t('buildOrder.emptyPlanet') }}</p>
    <template v-else>
      <div class="row small bo-filters">
        <label v-if="doneCount"><input v-model="showDone" type="checkbox" /> {{ t('buildOrder.showDone', { n: doneCount }) }}</label>
        <span v-if="invalidCount" class="neg">{{ t('buildOrder.invalidCount', { n: invalidCount }) }}</span>
      </div>
      <div class="bo-list">
        <div
          v-for="r in shownRows"
          :key="r.step.id"
          class="card bo-step"
          :class="{ next: r.step.id === nextId, faded: r.result?.state === 'deactivated' || isDone(r), over: dragOver === r.index && dragFrom !== r.index }"
          :draggable="!mobile"
          @dragstart="dragFrom = r.index"
          @dragend="dragFrom = null; dragOver = null"
          @dragover.prevent="dragOver = r.index"
          @drop.prevent="onDrop(r.index)"
        >
          <div class="row">
            <span v-if="!mobile" class="bo-grip faint" :title="t('buildOrder.drag')"><Icon name="menu" :size="14" /></span>
            <span class="faint mono bo-num">{{ r.index + 1 }}</span>
            <Icon :name="kindIcon(r.step)" :size="14" class="muted" />
            <b>{{ stepTitle(r.step, r.result) }}</b>
            <span v-if="r.step.id === nextId" class="badge">{{ t('buildOrder.next') }}</span>
            <span class="small" :class="stateClass(r)">{{ t(`buildOrder.state.${r.result?.state ?? 'invalid'}`) }}</span>
            <span class="bo-actions">
            <button class="small icon-btn" :disabled="r.index === 0" :title="t('buildOrder.up')" :aria-label="t('buildOrder.up')" @click="move(r.index, r.index - 1)">
              <Icon name="arrowUp" :size="14" />
            </button>
            <button class="small icon-btn" :disabled="r.index === steps.length - 1" :title="t('buildOrder.down')" :aria-label="t('buildOrder.down')" @click="move(r.index, r.index + 1)">
              <Icon name="arrowDown" :size="14" />
            </button>
            <button
              class="small icon-btn" :class="{ active: r.step.done }" :title="r.step.done ? t('buildOrder.undone') : t('buildOrder.markDone')"
              :aria-label="r.step.done ? t('buildOrder.undone') : t('buildOrder.markDone')" @click="update(r.index, { done: !r.step.done })"
            ><Icon name="check" :size="14" /></button>
            <button
              class="small icon-btn" :class="{ active: r.step.deactivated }" :title="r.step.deactivated ? t('buildOrder.activate') : t('buildOrder.deactivate')"
              :aria-label="r.step.deactivated ? t('buildOrder.activate') : t('buildOrder.deactivate')" @click="update(r.index, { deactivated: !r.step.deactivated })"
            ><Icon name="pause" :size="14" /></button>
            <button class="small icon-btn" :title="t('buildOrder.remove')" :aria-label="t('buildOrder.remove')" @click="remove(r.index)"><Icon name="close" :size="14" /></button>
            </span>
          </div>
          <div v-if="r.result?.state === 'planned'" class="row small bo-times">
            <Ticker v-slot="{ now: n }">
              <span v-if="r.result.start! <= n" class="pos">{{ r.step.id === nextId ? t('buildOrder.startNow') : t('buildOrder.started') }}</span>
              <span v-else>{{ t('buildOrder.startIn') }} <span class="mono">{{ countdown(r.result.start! - n) }}</span> <span class="faint">({{ clock(r.result.start!) }})</span></span>
            </Ticker>
            <span v-if="r.result.end! > r.result.start!" class="muted">{{ t('buildOrder.until', { time: clock(r.result.end!) }) }}</span>
            <span v-if="r.result.wait && !r.result.transport" class="faint">{{ t(`buildOrder.wait.${r.result.wait}`) }}</span>
            <span v-if="r.result.transport" class="warn" :title="t('buildOrder.overflowTitle')">
              {{ t('buildOrder.overflow') }}
              <template v-for="id in RESOURCES" :key="id"><span v-if="r.result.transport[id]" class="bo-cost">{{ short(r.result.transport[id]) }} {{ name(id) }}</span></template>
            </span>
            <span class="grow" />
            <span v-if="r.result.cost" class="muted">
              <template v-for="id in RESOURCES" :key="id"><span v-if="r.result.cost[id]" class="bo-cost">{{ short(r.result.cost[id]) }} {{ name(id) }}</span></template>
            </span>
          </div>
          <div v-else-if="r.result?.state === 'invalid'" class="small neg">{{ t(`buildOrder.never.${r.result.wait ?? 'requirements'}`) }}</div>
        </div>
      </div>
    </template>
  </template>

  <BuildOrderImport v-model="importOpen" :hub="hub" :replaces="!!stored" @imported="(b) => (data = { buildOrder: b })" />
</template>

<style scoped>
.bo-warn { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; padding: 8px 10px; border: 1px solid var(--warn, #c90); border-radius: 8px; }
.bo-diff { white-space: nowrap; }
.bo-other { margin-left: 8px; white-space: nowrap; }
.bo-filters { margin: 0 0 8px; }
.bo-step { margin-bottom: 6px; padding: 8px 12px; }
.bo-step.next { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.bo-step.over { border-top: 2px solid var(--accent); }
.bo-step .row { gap: 8px; flex-wrap: wrap; }
.bo-grip { cursor: grab; }
.bo-num { min-width: 2.2em; text-align: right; }
.bo-times { margin-top: 4px; }
.bo-cost + .bo-cost { margin-left: 8px; }
.faded { opacity: 0.55; }
.icon-btn.active { color: var(--accent); }
.bo-actions { display: flex; gap: 4px; margin-left: auto; }
@media (max-width: 800px) {
  .bo-step { padding: 8px 10px; }
  .bo-actions { flex: 1 0 100%; justify-content: flex-end; }
}
</style>
