<script setup lang="ts">
import {
  baseFromHub, checkOptimizeInput, doneStateOf, freePlannedKey, levelsAfterQueue, OptimizeError, researchAfterQueue, startOptimizePool, targetsOf,
  type BuildOrder as Order, type HubState, type OptimizeInput, type OptimizeOptions, type OptimizePool, type OptimizePoolProgress,
  type OptimizeResult, type PlannedPlanet, type Step, type TargetEntry, type WorkerLike,
} from '@pr0hub/planner';
import { buildingsFor, RESEARCH } from '@pr0hub/core/buildings';
import { ASTROPHYSICS } from '@pr0hub/core/universe';
import { computed, onBeforeUnmount, ref, toRaw, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { readError } from '../api';
import type { BuildOrderAnswer, StoredBuildOrder } from '../apiTypes';
import { BuildOrderChanged, changeBuildOrder } from '../buildOrderApi';
import { useStored, useUni } from '../composables';
import { fmt, name } from '../format';
import { units } from '../units';
import Hint from './Hint.vue';
import Icon from './Icon.vue';
import Sheet from './Sheet.vue';

/**
 * Auto plan: the order that reaches target levels of one planet fastest, searched in the browser (several Web Workers
 * with other seeds, `startOptimizePool` of `@pr0hub/planner`), shown against the current list and taken over on
 * request. The planet is a synced one (its levels as synced, its list's open steps count as targets), a planned one of
 * the build order, or a new planet that starts at 0 and is created as a planned planet when the plan is taken over.
 * The search keeps running while the dialog is closed; the targets and settings stay for the next time.
 */
const props = defineProps<{
  hub: HubState;
  stored: StoredBuildOrder | null;
  /** planet shown in the build order (preselected) */
  planetKey: string | null;
  /** start of the plan (the timeline's minute) */
  now: number;
  /** the hub's state with the planned planets of an order */
  hubWith: (order: Order | undefined) => HubState;
  label: (key: string) => string;
}>();
const emit = defineEmits<{ applied: [answer: BuildOrderAnswer, key: string]; changed: [answer: BuildOrderAnswer] }>();
const open = defineModel<boolean>({ required: true });
const { t, locale } = useI18n();
const { ctx, uni } = useUni();

// ------------------------------------------------------------------ planet
const NEW = 'new';
const planet = ref<string>(props.planetKey ?? NEW);
const newName = ref('');
const newTemp = ref<number | ''>('');
const plannedOf = (o: Order | undefined) => Object.keys(o?.planets ?? {}).filter((k) => /^0:0:\d+:planet$/.test(k));
const planetOptions = computed(() => [
  ...props.hub.planets.map((p) => p.key),
  ...plannedOf(props.stored?.order).filter((k) => !props.hub.planets.some((p) => p.key === k)),
]);
watch(open, (v) => {
  if (v && !running.value && !result.value && props.planetKey) planet.value = props.planetKey;
});
const isNew = computed(() => planet.value === NEW || !planetOptions.value.includes(planet.value));
const planetType = computed(() => (isNew.value ? 'planet' : (props.hub.planets.find((p) => p.key === planet.value)?.type ?? 'planet')));
const tempValid = computed(() => newTemp.value === '' || (Number.isInteger(newTemp.value) && Math.abs(newTemp.value) <= 300));

/** the order the search runs on (a new planet added as a planned one, a synced one without a list with an empty list) and the key planned */
function orderFor(from: Order | undefined): { order: Order; key: string } | null {
  const order: Order = from ?? { base: baseFromHub(props.hub, []), planets: {} };
  if (isNew.value) {
    const key = freePlannedKey(order);
    if (!key) return null;
    return {
      key,
      order: { base: { ...order.base, planets: { ...order.base.planets, [key]: {} } }, planets: { ...order.planets, [key]: [] }, planned: { ...(order.planned ?? {}), [key]: newDetails() } },
    };
  }
  const key = planet.value;
  if (order.planets[key]) return { order, key };
  const base = baseFromHub(props.hub, [key]);
  return { key, order: { ...order, base: { ...order.base, planets: { ...order.base.planets, ...base.planets } }, planets: { ...order.planets, [key]: [] } } };
}
function newDetails(): PlannedPlanet {
  const d: PlannedPlanet = {};
  if (newName.value.trim()) d.name = newName.value.trim();
  if (newTemp.value !== '') d.temp = newTemp.value;
  return d;
}

// ------------------------------------------------------------------ targets
type Kind = 'building' | 'research' | 'ship' | 'defense';
const KINDS: Kind[] = ['building', 'research', 'ship', 'defense'];
interface TargetRow {
  kind: Kind;
  element: number;
  value: number;
  /** soft deadline as `datetime-local` ('' none) */
  by: string;
  weight: number;
}
const targets = useStored<TargetRow[]>('autoPlan.targets', []);
const elementsOf = (kind: Kind): number[] =>
  kind === 'building' ? buildingsFor(planetType.value) : kind === 'research' ? Object.keys(RESEARCH).map(Number) : [...(kind === 'ship' ? units.value.ships : units.value.defense)];
const isUnit = (kind: Kind) => kind === 'ship' || kind === 'defense';
function addTarget() {
  targets.value.push({ kind: 'building', element: elementsOf('building')[0], value: 1, by: '', weight: 1 });
}
function kindChanged(row: TargetRow) {
  if (!elementsOf(row.kind).includes(row.element)) row.element = elementsOf(row.kind)[0];
}
/** level or count now (queues included): the planet's, research of the account; 0 on a new planet */
function current(row: TargetRow): number {
  if (row.kind === 'research') return researchAfterQueue(props.hub)[row.element] ?? 0;
  const hp = isNew.value ? null : props.hub.planets.find((p) => p.key === planet.value);
  return hp ? (levelsAfterQueue(hp.planet)[row.element] ?? 0) : 0;
}
const rowValid = (r: TargetRow) =>
  elementsOf(r.kind).includes(r.element) && Number.isInteger(r.value) && r.value >= 1 && r.value <= (isUnit(r.kind) ? 1e7 : 255) && r.weight >= 0;
const epochOf = (local: string) => (local ? Math.floor(new Date(local).getTime() / 1000) : null);
const entries = computed<TargetEntry[]>(() =>
  targets.value.filter(rowValid).map((r) => {
    const e: TargetEntry = { element: r.element, [isUnit(r.kind) ? 'count' : 'level']: r.value };
    const by = epochOf(r.by);
    if (by) e.by = by;
    if (r.weight !== 1) e.weight = r.weight;
    return e;
  }),
);

// ------------------------------------------------------------------ settings
const BUDGETS = [15, 30, 60, 120, 300];
const advanced = useStored('autoPlan.advanced', false);
const ECONOMY = [1, 2, 3, 4, 12, 22, 23, 24];
const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
const settings = useStored('autoPlan.settings', {
  budget: 30,
  economy: true,
  throttle: true,
  includeExisting: true,
  noLater: true,
  forbid: [] as number[],
  mineRatio: false,
  crystalBelowMetal: 2,
  deutBelowCrystal: 2,
  quietHours: false,
  quietFrom: 0,
  quietTo: 7,
  workers: Math.min(4, Math.max(1, cores - 1)),
});
const options = computed<OptimizeOptions>(() => {
  const s = settings.value;
  return {
    economy: s.economy,
    throttle: s.throttle,
    includeExisting: s.includeExisting,
    noLater: s.noLater,
    forbid: s.forbid.length ? [...s.forbid] : undefined,
    mineRatio: s.mineRatio ? { crystalBelowMetal: s.crystalBelowMetal, deutBelowCrystal: s.deutBelowCrystal } : null,
    quietHours: s.quietHours ? { from: s.quietFrom, to: s.quietTo } : null,
  };
});

// ------------------------------------------------------------------ kept steps
/** the open tail of the planet's list (what the search may reorder), with the optimizer's default of kept steps */
const tail = computed<{ step: Step; level: number | undefined }[]>(() => {
  const order = props.stored?.order;
  const list = order?.planets[planet.value];
  if (!order || !list || isNew.value) return [];
  const hub = props.hubWith(order);
  const levels = targetsOf(order);
  const isOpen = (s: Step) => !s.deactivated && doneStateOf(s, levels.get(s.id), planet.value, hub) === 'open';
  const first = list.findIndex(isOpen);
  return first < 0 ? [] : list.slice(first).filter(isOpen).map((step) => ({ step, level: levels.get(step.id) }));
});
const colonizing = computed(() => Object.values(props.stored?.order.planets ?? {}).some((l) => l.some((s) => s.transport?.mission === 'colonize' && !s.done && !s.deactivated)));
const defaultKeep = (s: Step) => s.kind === 'transport' || s.kind === 'prod' || (colonizing.value && s.kind === 'research' && s.element === ASTROPHYSICS);
/** step id -> kept, once changed by hand (else the optimizer's default) */
const keepEdit = ref<Record<string, boolean> | null>(null);
watch(planet, () => (keepEdit.value = null));
const isKept = (s: Step) => keepEdit.value?.[s.id] ?? defaultKeep(s);
function toggleKeep(s: Step) {
  keepEdit.value = { ...Object.fromEntries(tail.value.map((r) => [r.step.id, isKept(r.step)])), [s.id]: !isKept(s) };
}

// ------------------------------------------------------------------ search
const running = ref(false);
const progress = ref<OptimizePoolProgress | null>(null);
const startedAt = ref(0);
const tick = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;
let pool: OptimizePool | null = null;
const result = ref<OptimizeResult | null>(null);
/** what the result was planned on: the key, the order, the planet's list as it was (to see a change before taking it over) */
const planned = ref<{ key: string; order: Order; list: string; isNew: boolean; details: PlannedPlanet; stopped: boolean } | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

const canRun = computed(() => !running.value && entries.value.length > 0 && tempValid.value && (planetType.value === 'planet' || !entries.value.some((e) => e.element >= 100 && e.element < 200)));
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(toRaw(v)));

function run() {
  error.value = null;
  result.value = null;
  const made = orderFor(props.stored?.order);
  if (!made) return void (error.value = t('autoPlan.noFreeKey'));
  const keep = keepEdit.value ? tail.value.filter((r) => isKept(r.step)).map((r) => r.step.id) : undefined;
  const universe = ctx.value?.universe.settings;
  const input: Omit<OptimizeInput, 'units'> = plain({
    order: made.order, hub: props.hubWith(made.order), planet: made.key, targets: entries.value, keep, now: props.now, universe, options: options.value,
  });
  try {
    checkOptimizeInput({ ...input, units: units.value });
  } catch (e) {
    error.value = e instanceof OptimizeError ? t('autoPlan.invalid', { reason: e.message }) : readError(e);
    return;
  }
  planned.value = {
    key: made.key, order: made.order, list: JSON.stringify(props.stored?.order.planets[made.key] ?? null), isNew: isNew.value, details: newDetails(), stopped: false,
  };
  running.value = true;
  startedAt.value = Date.now();
  tick.value = Date.now();
  timer = setInterval(() => (tick.value = Date.now()), 500);
  const budgetMs = settings.value.budget * 1000;
  pool = startOptimizePool({
    request: { input, units: JSON.parse(units.value.key), budgetMs },
    workers: Math.max(1, Math.min(cores, settings.value.workers)),
    // a DOM Worker is a WorkerLike (its handlers take a full MessageEvent)
    createWorker: () => new Worker(new URL('../autoPlan.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    onProgress: (p) => {
      progress.value = p;
      if (p.best) result.value = p.best;
    },
  });
  pool.done
    .then((best) => (result.value = best ?? result.value))
    .catch((e) => (error.value = e instanceof OptimizeError ? t('autoPlan.invalid', { reason: e.message }) : readError(e)))
    .finally(() => {
      running.value = false;
      pool = null;
      if (timer) clearInterval(timer);
    });
}
function stop() {
  if (planned.value) planned.value.stopped = true;
  pool?.stop();
}
function reset() {
  result.value = null;
  planned.value = null;
  progress.value = null;
  error.value = null;
}
onBeforeUnmount(() => pool?.stop());

const elapsed = computed(() => Math.min(settings.value.budget, Math.max(0, (tick.value - startedAt.value) / 1000)));
const share = computed(() => Math.round((elapsed.value / settings.value.budget) * 100));

// ------------------------------------------------------------------ result
const resultOrder = computed<Order | null>(() => {
  const r = result.value;
  const p = planned.value;
  return r && p ? { ...p.order, base: r.base, planets: { ...p.order.planets, [p.key]: r.steps } } : null;
});
const resultLevels = computed(() => (resultOrder.value ? targetsOf(resultOrder.value) : new Map<string, number>()));
const keptIds = computed(() => new Set(planned.value ? (JSON.parse(planned.value.list) as Step[] | null ?? []).map((s) => s.id) : []));
const rows = computed(() => {
  const r = result.value;
  if (!r) return [];
  const byId = new Map(r.steps.map((s) => [s.id, s]));
  return r.timeline.map((tl) => ({ step: byId.get(tl.id)!, start: tl.start, end: tl.end, kept: keptIds.value.has(tl.id) })).filter((x) => x.step);
});
/** the list had open steps: compared with it, else (a new or empty list) with the required steps alone, without economy */
const hadList = computed(() => tail.value.length > 0 && !planned.value?.isNew);
/** the comparison: the current list (with the targets), else the build order as it is now, else the plain order */
const compare = computed<{ at: number; key: string } | null>(() => {
  const r = result.value;
  if (!r) return null;
  if (!hadList.value) return r.baselineFinishAt > r.finishAt ? { at: r.baselineFinishAt, key: 'autoPlan.plainAt' } : null;
  if (r.currentFinishAt != null) return { at: r.currentFinishAt, key: 'autoPlan.currentAt' };
  return r.asIsFinishAt != null ? { at: r.asIsFinishAt, key: 'autoPlan.asIsAt' } : null;
});
const saved = computed(() => (result.value && compare.value ? compare.value.at - result.value.finishAt : null));
const anyDeadline = computed(() => goalRows.value.some((g) => g.by != null));
const goalRows = computed(() => (result.value?.goals ?? []).filter((g) => g.planet === planned.value?.key && g.level != null));
const changed = computed(() => {
  const p = planned.value;
  if (!p || p.isNew) return false;
  return JSON.stringify(props.stored?.order.planets[p.key] ?? null) !== p.list;
});

function stepTitle(s: Step): string {
  switch (s.kind) {
    case 'building':
    case 'research':
      return `${name(s.element!)} ${resultLevels.value.get(s.id) ?? ''}`;
    case 'ship':
    case 'defense':
      return `${fmt(s.count ?? 1)}× ${name(s.element!)}`;
    case 'prod':
      return t('autoPlan.prodStep');
    case 'transport':
      return t(`buildOrder.missionTitle.${s.transport!.mission ?? 'transport'}`, { to: s.transport!.target ? props.label(s.transport!.target) : '–' });
  }
}
const tailTitle = (r: { step: Step; level: number | undefined }) =>
  r.step.kind === 'building' || r.step.kind === 'research' ? `${name(r.step.element!)} ${r.level ?? ''}` : r.step.kind === 'transport' || r.step.kind === 'prod' ? stepTitle(r.step) : `${fmt(r.step.count ?? 1)}× ${name(r.step.element!)}`;
const clock = (epoch: number | null) =>
  epoch == null
    ? '–'
    : new Date(epoch * 1000).toLocaleString(locale.value, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function span(sec: number): string {
  const s = Math.abs(Math.round(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}

/** writes the plan: the planet's list and base (a new planet as a planned one); refused when the list changed meanwhile */
async function apply() {
  const r = result.value;
  const p = planned.value;
  if (!r || !p) return;
  if (!p.isNew && props.stored?.order.planets[p.key]?.some((s) => !s.done) && !confirm(t('autoPlan.replaceConfirm', { planet: props.label(p.key) }))) return;
  busy.value = true;
  error.value = null;
  try {
    const answer = await changeBuildOrder(uni.value, props.stored, (from) => {
      const cur = from?.order;
      if (p.isNew ? cur?.planets[p.key] : JSON.stringify(cur?.planets[p.key] ?? null) !== p.list) return null;
      const research = { ...(cur?.base.research ?? {}) };
      for (const [id, v] of Object.entries(r.base.research)) research[id] = Math.max(research[id] ?? 0, v);
      const base = { planets: { ...(cur?.base.planets ?? {}), [p.key]: r.base.planets[p.key] ?? {} }, research };
      const planets = { ...(cur?.planets ?? {}), [p.key]: r.steps };
      const plannedPlanets = p.isNew ? { ...(cur?.planned ?? {}), [p.key]: p.details } : (cur?.planned ?? {});
      return cur
        ? { method: 'PATCH', body: { planets, base, planned: plannedPlanets } }
        : { method: 'PUT', body: { order: { base, planets, ...(p.isNew ? { planned: plannedPlanets } : {}) }, meta: { source: 'hub' } } };
    });
    emit('applied', answer, p.key);
    reset();
    open.value = false;
  } catch (e) {
    if (e instanceof BuildOrderChanged) {
      emit('changed', e.current);
      error.value = t('autoPlan.changedMeanwhile');
    } else error.value = readError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Sheet v-model="open" :title="t('autoPlan.title')" wide>
    <p class="muted small" style="margin-top: 0">{{ t('autoPlan.intro') }}</p>

    <template v-if="!result && !running">
      <div class="card ap-section">
        <b>{{ t('autoPlan.planet') }}</b>
        <div class="row small ap-row">
          <select v-model="planet" :aria-label="t('autoPlan.planet')">
            <option v-for="k in planetOptions" :key="k" :value="k">{{ label(k) }}</option>
            <option :value="NEW">{{ t('autoPlan.newPlanet') }}</option>
          </select>
          <template v-if="isNew">
            <label>{{ t('buildOrder.planetName') }} <input v-model="newName" type="text" maxlength="40" class="ap-name" /></label>
            <label>{{ t('buildOrder.planetTemp') }} <input v-model.number="newTemp" type="number" step="1" class="ap-num" /></label>
          </template>
          <Hint>{{ isNew ? t('autoPlan.newPlanetHint') : t('autoPlan.planetHint') }}</Hint>
        </div>
      </div>

      <div class="card ap-section">
        <div class="row">
          <b>{{ t('autoPlan.targets') }}</b>
          <Hint>{{ t('autoPlan.targetsHint') }}</Hint>
          <span class="grow" />
          <button type="button" class="small" @click="addTarget"><Icon name="plus" :size="14" /> {{ t('autoPlan.addTarget') }}</button>
        </div>
        <p v-if="!targets.length" class="muted small">{{ t('autoPlan.noTargets') }}</p>
        <div v-for="(r, i) in targets" :key="i" class="row small ap-row ap-target" :class="{ invalid: !rowValid(r) }">
          <select v-model="r.kind" :aria-label="t('buildOrder.addKind')" @change="kindChanged(r)">
            <option v-for="k in KINDS" :key="k" :value="k">{{ t(`buildOrder.kind.${k}`) }}</option>
          </select>
          <select v-model="r.element" :aria-label="t('buildOrder.addElement')">
            <option v-for="id in elementsOf(r.kind)" :key="id" :value="id">{{ name(id) }}</option>
          </select>
          <label>{{ isUnit(r.kind) ? t('autoPlan.count') : t('autoPlan.level') }}
            <input v-model.number="r.value" type="number" min="1" :max="isUnit(r.kind) ? 10000000 : 255" step="1" class="ap-num" />
          </label>
          <span class="faint">{{ t('autoPlan.now', { n: fmt(current(r)) }) }}</span>
          <template v-if="advanced">
            <label :title="t('autoPlan.byTitle')">{{ t('autoPlan.by') }} <input v-model="r.by" type="datetime-local" /></label>
            <label :title="t('autoPlan.weightTitle')">{{ t('autoPlan.weight') }} <input v-model.number="r.weight" type="number" min="0" step="0.5" class="ap-num" /></label>
          </template>
          <button type="button" class="small icon-btn" :title="t('buildOrder.remove')" :aria-label="t('buildOrder.remove')" @click="targets.splice(i, 1)"><Icon name="close" :size="14" /></button>
        </div>
      </div>

      <div class="card ap-section">
        <b>{{ t('autoPlan.settings') }}</b>
        <div class="row small ap-row">
          <label>{{ t('autoPlan.budget') }}
            <select v-model.number="settings.budget">
              <option v-for="b in BUDGETS" :key="b" :value="b">{{ b < 60 ? t('autoPlan.seconds', { n: b }) : t('autoPlan.minutes', { n: b / 60 }) }}</option>
            </select>
          </label>
          <label :title="t('autoPlan.economyTitle')"><input v-model="settings.economy" type="checkbox" /> {{ t('autoPlan.economy') }}</label>
          <span class="grow" />
          <button type="button" class="small" :class="{ active: advanced }" @click="advanced = !advanced">{{ t('autoPlan.advanced') }}</button>
        </div>
        <template v-if="advanced">
          <div class="row small ap-row">
            <label :title="t('autoPlan.throttleTitle')"><input v-model="settings.throttle" type="checkbox" /> {{ t('autoPlan.throttle') }}</label>
            <label :title="t('autoPlan.includeExistingTitle')"><input v-model="settings.includeExisting" type="checkbox" /> {{ t('autoPlan.includeExisting') }}</label>
            <label :title="t('autoPlan.noLaterTitle')"><input v-model="settings.noLater" type="checkbox" /> {{ t('autoPlan.noLater') }}</label>
            <label :title="t('autoPlan.workersTitle')">{{ t('autoPlan.workers') }}
              <input v-model.number="settings.workers" type="number" min="1" :max="cores" step="1" class="ap-num" />
            </label>
          </div>
          <div class="row small ap-row">
            <span>{{ t('autoPlan.forbid') }}</span>
            <label v-for="id in ECONOMY" :key="id"><input v-model="settings.forbid" type="checkbox" :value="id" /> {{ name(id) }}</label>
          </div>
          <div class="row small ap-row">
            <label :title="t('autoPlan.mineRatioTitle')"><input v-model="settings.mineRatio" type="checkbox" /> {{ t('autoPlan.mineRatio') }}</label>
            <template v-if="settings.mineRatio">
              <label>{{ t('autoPlan.crystalBelowMetal') }} <input v-model.number="settings.crystalBelowMetal" type="number" min="0" max="50" step="1" class="ap-num" /></label>
              <label>{{ t('autoPlan.deutBelowCrystal') }} <input v-model.number="settings.deutBelowCrystal" type="number" min="0" max="50" step="1" class="ap-num" /></label>
            </template>
          </div>
          <div class="row small ap-row">
            <label :title="t('autoPlan.quietHoursTitle')"><input v-model="settings.quietHours" type="checkbox" /> {{ t('autoPlan.quietHours') }}</label>
            <template v-if="settings.quietHours">
              <label>{{ t('autoPlan.from') }} <input v-model.number="settings.quietFrom" type="number" min="0" max="24" step="0.5" class="ap-num" /></label>
              <label>{{ t('autoPlan.to') }} <input v-model.number="settings.quietTo" type="number" min="0" max="24" step="0.5" class="ap-num" /></label>
            </template>
          </div>
          <details v-if="tail.length" class="small">
            <summary>{{ t('autoPlan.keep', { n: tail.filter((r) => isKept(r.step)).length, total: tail.length }) }} <Hint>{{ t('autoPlan.keepHint') }}</Hint></summary>
            <div class="ap-keep">
              <label v-for="r in tail" :key="r.step.id" class="ap-keep-step"><input type="checkbox" :checked="isKept(r.step)" @change="toggleKeep(r.step)" /> {{ tailTitle(r) }}</label>
            </div>
          </details>
        </template>
      </div>
    </template>

    <div v-if="running || progress" class="card ap-section">
      <div class="row small">
        <b>{{ running ? t('autoPlan.running') : t('autoPlan.finished') }}</b>
        <span class="muted">{{ t(`autoPlan.phase.${progress?.phase ?? 'greedy'}`) }}</span>
        <span class="muted">{{ t('autoPlan.stats', { evals: fmt(progress?.evaluations ?? 0), workers: progress?.running ?? 0, total: progress?.workers ?? 0 }) }}</span>
      </div>
      <div v-if="running" class="ap-bar" role="progressbar" :aria-valuenow="share" aria-valuemin="0" aria-valuemax="100"><div :style="{ width: share + '%' }" /></div>
    </div>

    <div v-if="result" class="card ap-section">
      <div class="row ap-summary">
        <span>{{ t('autoPlan.doneAt') }} <b>{{ clock(result.finishAt) }}</b></span>
        <span v-if="compare" class="muted">{{ t(compare.key, { time: clock(compare.at) }) }}</span>
        <span v-if="saved != null && saved > 0" class="pos">{{ t('autoPlan.faster', { span: span(saved) }) }}</span>
        <span v-else-if="saved != null && saved < 0" class="warn">{{ t('autoPlan.slower', { span: span(saved) }) }}</span>
        <span v-if="planned?.stopped" class="faint">{{ t('autoPlan.stopped') }}</span>
      </div>
      <p v-if="result.currentError && hadList" class="faint small" style="margin: 4px 0 0">{{ t('autoPlan.currentError', { reason: result.currentError }) }}</p>
      <p v-if="changed" class="warn small" style="margin: 4px 0 0">{{ t('autoPlan.listChanged') }}</p>
      <table v-if="goalRows.length" class="small ap-goals">
        <thead><tr><th>{{ t('autoPlan.goal') }}</th><th>{{ t('autoPlan.goalNow') }}</th><th>{{ t('autoPlan.goalNew') }}</th><th v-if="anyDeadline">{{ t('autoPlan.by') }}</th></tr></thead>
        <tbody>
          <tr v-for="(g, i) in goalRows" :key="i">
            <td>{{ g.element >= 200 ? `${fmt(g.level!)}× ${name(g.element)}` : `${name(g.element)} ${g.level}` }} <span v-if="g.source !== 'target'" class="faint">({{ t('autoPlan.fromList') }})</span></td>
            <td class="mono">{{ clock(g.currentEnd) }}</td>
            <td class="mono" :class="{ pos: g.currentEnd != null && g.end < g.currentEnd, warn: g.currentEnd != null && g.end > g.currentEnd }">{{ clock(g.end) }}</td>
            <td v-if="anyDeadline" class="mono" :class="{ neg: g.by != null && g.end > g.by }">{{ g.by ? clock(g.by) : '–' }}</td>
          </tr>
        </tbody>
      </table>
      <details class="ap-steps">
        <summary class="small">{{ t('autoPlan.steps', { n: rows.length }) }}</summary>
        <ol class="small">
          <li v-for="r in rows" :key="r.step.id">
            <b>{{ stepTitle(r.step) }}</b>
            <span v-if="r.kept" class="faint ap-gap">· {{ t('autoPlan.keptStep') }}</span>
            <span class="muted mono ap-gap">{{ clock(r.start) }} → {{ clock(r.end) }}</span>
          </li>
        </ol>
      </details>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <template #footer>
      <button type="button" @click="open = false">{{ t('common.close') }}</button>
      <button v-if="running" type="button" @click="stop">{{ t('autoPlan.stop') }}</button>
      <template v-else-if="result">
        <button type="button" @click="reset">{{ t('autoPlan.again') }}</button>
        <button type="button" class="primary" :disabled="busy || changed" @click="apply">{{ t('autoPlan.apply') }}</button>
      </template>
      <button v-else type="button" class="primary" :disabled="!canRun" @click="run"><Icon name="bolt" :size="14" /> {{ t('autoPlan.run') }}</button>
    </template>
  </Sheet>
</template>

<style scoped>
.ap-section { display: flex; flex-direction: column; gap: 6px; }
.ap-row { gap: 6px 10px; flex-wrap: wrap; }
.ap-target.invalid select, .ap-target.invalid input { border-color: var(--neg, #c33); }
.ap-num { width: 5.5em; margin-left: 4px; }
.ap-name { width: 11em; margin-left: 4px; }
.ap-keep { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; }
.ap-keep-step { white-space: nowrap; }
.ap-bar { height: 6px; border-radius: 3px; background: var(--border, #444); overflow: hidden; }
.ap-bar > div { height: 100%; background: var(--accent); transition: width 0.4s linear; }
.ap-summary { gap: 6px 14px; flex-wrap: wrap; }
.ap-goals { width: 100%; border-collapse: collapse; margin-top: 6px; }
.ap-goals th, .ap-goals td { text-align: left; padding: 2px 8px 2px 0; }
.ap-gap { margin-left: 8px; }
.ap-steps ol { margin: 6px 0 0; padding-left: 2.2em; max-height: 40vh; overflow: auto; }
button.active { border-color: var(--accent); color: var(--accent); }
@media (max-width: 800px) {
  .ap-goals th:nth-child(4), .ap-goals td:nth-child(4) { display: none; }
}
</style>
