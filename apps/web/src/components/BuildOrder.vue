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
import {
  allOf, baseFromHub, compareSettings, freePlannedKey, insertSteps, isPlannedKey, plannedNumber, simulate, targetsOf, withPlanned, type HubState, type NewStep,
  type PlannedPlanet, type Pr0planImport, type Step, type StepResult, type TransportSettings,
} from '@pr0hub/planner';
import { buildingsFor, RESEARCH } from '@pr0hub/core/buildings';
import { RESOURCES } from '@pr0hub/core/tech';
import { planetStartResources } from '@pr0hub/core/universe';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { readError, uniApi } from '../api';
import { useClock } from '../clock';
import { useLoader, useStored, useUni } from '../composables';
import { dateTime, fmt, name, short } from '../format';
import { tables, useLiveReload } from '../live';
import { draftOf, draftValid, transportOf, type TransportDraft } from '../buildOrderTransport';
import BuildOrderImport from './BuildOrderImport.vue';
import BuildOrderTransportFields from './BuildOrderTransportFields.vue';
import Hint from './Hint.vue';
import Icon from './Icon.vue';
import Ticker from './Ticker.vue';
import { units } from '../units';

/**
 * Build order tab of build & research: the steps of the chosen planet in order with their timeline from the hub's
 * state (start, end, what they wait for), the next one highlighted; reorder by dragging (desktop) or the arrows,
 * check off, deactivate, remove, add buildings, research, ships and defense by hand (also without an import: that
 * starts a build order from the hub's levels). Import from pr0plan in a dialog; the file's settings are compared with
 * the hub's.
 * Planned planets (no coordinates yet: before the start, or a colony to come) are simulated as new planets from the
 * universe's start and are assigned to a synced planet later. `planetKey` null: no synced planet (yet).
 * Planned planets can also be added by hand (name, the coordinates they will have, temperature); one that a
 * colonization of the build order flies to starts when that arrives. Transports (transport, deployment, colonization)
 * are steps with ships: flight time, fuel and cargo space come from the flight formula.
 */
const props = defineProps<{ hub: HubState; planetKey: string | null; mobile: boolean }>();
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
/** the timeline is planned anew every minute (and on every change); before the start it begins at the start */
const minute = computed(() => Math.max(Math.floor(now.value / 60) * 60, ctx.value?.universe.startsAt ?? 0));

/** planets of the build order without coordinates yet, by their pr0plan number */
const plannedKeys = computed(() =>
  Object.keys(stored.value?.order.planets ?? {}).filter(isPlannedKey).sort((a, b) => plannedNumber(a)! - plannedNumber(b)!),
);
const plannedName = (key: string) => {
  const n = plannedNumber(key);
  return stored.value?.order.planned?.[key]?.name || stored.value?.meta.names?.[String(n)] || t('buildOrder.plannedPlanet', { n });
};
/** synced homeworld (pr0plan planet 1 mapping, else first planet with coordinates) */
const homePlanet = computed(() => {
  const mapping = stored.value?.meta.mapping as Record<string, string | null> | undefined;
  const homeKey = mapping?.['1'];
  if (homeKey) return props.hub.planets.find((p) => p.key === homeKey);
  return props.hub.planets.find((p) => p.type === 'planet' && p.coords.g > 0);
});
/** resources of a new planet: universe config (`metalStart` …) or the homeworld when it shows a custom start */
const startResources = computed(() => planetStartResources(ctx.value?.universe.settings, homePlanet.value?.planet));
/** the hub's planets plus the planned ones as new planets (start resources, the file's temperature) */
const hubAll = computed<HubState>(() => {
  const s = stored.value;
  if (!s || !plannedKeys.value.length) return props.hub;
  const settings = s.meta.settings as Pr0planImport['settings'] | undefined;
  const u = ctx.value?.universe.settings;
  return withPlanned(s.order, props.hub, minute.value, {
    resources: startResources.value,
    universe: u,
    home: homePlanet.value?.planet,
    name: plannedName,
    temp: (k) => settings?.planets[String(plannedNumber(k))]?.temp,
  });
});
/** a planned planet picked to look at; a planet chosen on the page shows that one again */
const picked = ref<string | null>(null);
watch(() => props.planetKey, () => (picked.value = null));
const planetKey = computed(() => (picked.value && plannedKeys.value.includes(picked.value) ? picked.value : (props.planetKey ?? plannedKeys.value[0] ?? '')));

const sim = computed(() => (stored.value ? simulate(stored.value.order, hubAll.value, { now: minute.value, universe: ctx.value?.universe.settings }) : null));
const resultOf = computed(() => new Map((sim.value?.steps ?? []).map((r) => [r.id, r])));
const steps = computed<Step[]>(() => stored.value?.order.planets[planetKey.value] ?? []);
const nextId = computed(() => sim.value?.next[planetKey.value] ?? null);
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

/** planets of the build order the hub has no synced data for (planned planets are simulated instead) */
const missingPlanets = computed(() => Object.keys(stored.value?.order.planets ?? {}).filter((k) => !isPlannedKey(k) && !props.hub.planets.some((p) => p.key === k)));
const openOf = (list: Step[]) => list.filter((s) => { const r = resultOf.value.get(s.id); return r && r.state !== 'done' && r.state !== 'queued'; }).length;
const otherPlanets = computed(() =>
  Object.entries(stored.value?.order.planets ?? {})
    .filter(([k, list]) => k !== planetKey.value && list.length && props.hub.planets.some((p) => p.key === k))
    .map(([k, list]) => ({ key: k, open: openOf(list) })),
);
const planetLabel = (key: string) => {
  if (isPlannedKey(key)) {
    const c = stored.value?.order.planned?.[key]?.coords;
    return c ? `${plannedName(key)} [${c.g}:${c.s}:${c.p}]` : plannedName(key);
  }
  const p = props.hub.planets.find((x) => x.key === key);
  return p ? `${p.name ? p.name + ' ' : ''}[${p.coords.g}:${p.coords.s}:${p.coords.p}]` : key;
};

/** synced planets a planned planet can be assigned to: planets without steps of their own */
const assignable = computed(() => props.hub.planets.filter((p) => p.type === 'planet' && !stored.value?.order.planets[p.key]?.length));
const assignTo = ref<Record<string, string | null>>({});
watch([plannedKeys, assignable], () => {
  // suggested by the planned coordinates, else by order: pr0plan's planet 1 is the home planet, the first one of the empire
  const free = assignable.value.map((p) => p.key);
  const at = (k: string) => {
    const c = stored.value?.order.planned?.[k]?.coords;
    const key = c ? `${c.g}:${c.s}:${c.p}:planet` : '';
    return free.includes(key) ? key : null;
  };
  assignTo.value = Object.fromEntries(plannedKeys.value.map((k) => [k, free.includes(assignTo.value[k] ?? '') ? assignTo.value[k] : (at(k) ?? free[plannedNumber(k)! - 1] ?? null)]));
}, { immediate: true });
async function assign(from: string) {
  const to = assignTo.value[from];
  if (!to) return;
  saving.value = true;
  try {
    data.value = await uniApi<{ buildOrder: StoredBuildOrder | null }>(uni.value, '/build-order/assign', { method: 'POST', body: { from, to } });
    picked.value = null;
  } catch (e) {
    error.value = readError(e);
  } finally {
    saving.value = false;
  }
}
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
      return t(`buildOrder.missionTitle.${s.transport!.mission ?? 'transport'}`, { to: s.transport!.target ? planetLabel(s.transport!.target) : '–' });
  }
}
/** what a transport flies with and when: "3× Kleiner Transporter · 70 % · alles · Ankunft Mo 12:00" */
function transportInfo(tr: TransportSettings): string {
  const parts = Object.entries(tr.ships ?? {}).map(([id, n]) => `${fmt(n)}× ${name(Number(id))}`);
  if (tr.speed && tr.speed !== 100) parts.push(`${tr.speed} %`);
  const all = allOf(tr);
  if (all.length) parts.push(t('buildOrder.trAllShort', { res: all.map((r) => name(r)).join(', ') }));
  if (tr.notBefore) parts.push(t('buildOrder.trNotBefore', { time: clock(tr.notBefore) }));
  if (tr.arriveAt) parts.push(t('buildOrder.trArriveAt', { time: clock(tr.arriveAt) }));
  return parts.join(' · ');
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
  const planets = { ...s.order.planets, [planetKey.value]: list };
  // right away on the page, then on the server
  data.value = { buildOrder: { ...s, order: { ...s.order, planets } } };
  saving.value = true;
  try {
    data.value = await uniApi<{ buildOrder: StoredBuildOrder | null }>(uni.value, '/build-order', { method: 'PATCH', body: { planets } });
  } catch (e) {
    error.value = readError(e);
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
    error.value = readError(e);
  }
}

// ------------------------------------------------------------------ adding steps
type AddKind = NewStep['kind'] | 'transport';
const ADD_KINDS: AddKind[] = ['building', 'research', 'ship', 'defense', 'transport'];
const addOpen = ref(false);
const addKind = ref<AddKind>('building');
const addElement = ref<number | null>(null);
/** levels (building, research) or units (ship, defense) */
const addCount = ref(1);
/** 1-based position the first new step gets; past the end appends */
const addAt = ref(1);
const planetType = computed(() => props.hub.planets.find((p) => p.key === planetKey.value)?.type ?? 'planet');
const elementsOf = (kind: AddKind): number[] =>
  kind === 'transport' ? [] : kind === 'building' ? buildingsFor(planetType.value) : kind === 'research' ? Object.keys(RESEARCH).map(Number) : [...(kind === 'ship' ? units.value.ships : units.value.defense)];
const isTransport = computed(() => addKind.value === 'transport');
const addElements = computed(() => elementsOf(addKind.value));
const isUnit = computed(() => addKind.value === 'ship' || addKind.value === 'defense');
watch([addKind, addElements], () => {
  if (!addElements.value.includes(addElement.value ?? -1)) addElement.value = addElements.value[0] ?? null;
}, { immediate: true });
watch(isUnit, () => (addCount.value = 1));
/** appends by default; the position follows the list while the form is open */
watch([() => steps.value.length, planetKey, addOpen], () => (addAt.value = steps.value.length + 1), { immediate: true });
const countMax = computed(() => (isUnit.value ? 1e7 : 50));
const addValid = computed(() =>
  isTransport.value
    ? !!planetKey.value && trValid.value
    : !!planetKey.value && addElement.value != null && Number.isInteger(addCount.value) && addCount.value >= 1 && addCount.value <= countMax.value,
);

// transport steps
const trDraft = ref<TransportDraft>(draftOf());
/** planets a transport can fly to: the other ones of the build order and the hub, planned ones included */
const trTargets = computed(() => hubAll.value.planets.map((p) => p.key).filter((k) => k !== planetKey.value));
watch([trTargets, addKind], () => {
  if (!trTargets.value.includes(trDraft.value.target ?? '')) trDraft.value.target = trTargets.value[0] ?? null;
}, { immediate: true });
const trValid = computed(() => draftValid(trDraft.value));
const transportStep = (id: string): Step => ({ id, kind: 'transport', transport: transportOf(trDraft.value) });

// ------------------------------------------------------------------ editing a step
/** id of the step being edited: ships and defense (type, amount), transports (everything) */
const editId = ref<string | null>(null);
const editElement = ref<number | null>(null);
const editCount = ref(1);
const editDraft = ref<TransportDraft>(draftOf());
/** what the edited transport was: one without ships or target may stay so */
const editOriginal = ref<TransportSettings | null>(null);
const editable = (s: Step) => s.kind === 'ship' || s.kind === 'defense' || s.kind === 'transport';
function openEdit(s: Step) {
  if (editId.value === s.id) return void (editId.value = null);
  editId.value = s.id;
  if (s.kind === 'transport') {
    editOriginal.value = s.transport!;
    editDraft.value = draftOf(s.transport!);
  } else {
    editElement.value = s.element ?? null;
    editCount.value = s.count ?? 1;
  }
}
// the step vanished (removed, other planet, reloaded without it): close the form
watch(steps, (list) => {
  if (editId.value && !list.some((s) => s.id === editId.value)) editId.value = null;
});
function editValid(s: Step): boolean {
  if (s.kind === 'transport') return draftValid(editDraft.value, editOriginal.value?.target == null);
  return editElement.value != null && Number.isInteger(editCount.value) && editCount.value >= 1 && editCount.value <= 1e7;
}
function saveEdit(i: number) {
  const s = steps.value[i];
  if (!s || !editValid(s)) return;
  update(i, s.kind === 'transport' ? { transport: transportOf(editDraft.value) } : { element: editElement.value!, count: editCount.value });
  editId.value = null;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const emptyOrder = (): Order => ({ base: baseFromHub(hubAll.value, []), planets: {} });
/** the build order with the new steps (ids prefixed `new-` for the preview) */
function withAdded(id: () => string): Order | null {
  if (!addValid.value) return null;
  const kind = addKind.value;
  if (kind === 'transport') {
    const order = stored.value?.order ?? emptyOrder();
    const list = [...(order.planets[planetKey.value] ?? [])];
    list.splice(Math.max(0, Math.min(addAt.value - 1, list.length)), 0, transportStep(id()));
    return { ...order, planets: { ...order.planets, [planetKey.value]: list } };
  }
  const el = addElement.value!;
  const add: NewStep[] = isUnit.value ? [{ kind, element: el, count: addCount.value }] : Array.from({ length: addCount.value }, () => ({ kind, element: el }));
  return insertSteps(stored.value?.order ?? emptyOrder(), planetKey.value, add, addAt.value - 1, hubAll.value, id);
}
/** what the new steps reach: "Metallmine 12–14", "5× Leichter Jäger (8)" */
const addPreview = computed(() => {
  if (isTransport.value) return null;
  let n = 0;
  const order = withAdded(() => `new-${n++}`);
  if (!order) return null;
  const targets = targetsOf(order);
  const levels = order.planets[planetKey.value].filter((s) => s.id.startsWith('new-')).map((s) => targets.get(s.id) ?? 0);
  const first = levels[0];
  const last = levels[levels.length - 1];
  return { from: first, to: last };
});
/** stores the whole build order: changes the stored one, or starts one by hand */
async function write(order: Order): Promise<boolean> {
  saving.value = true;
  try {
    data.value = stored.value
      ? await uniApi<{ buildOrder: StoredBuildOrder | null }>(uni.value, '/build-order', { method: 'PATCH', body: { planets: order.planets, base: order.base, planned: order.planned ?? {} } })
      : await uniApi<{ buildOrder: StoredBuildOrder | null }>(uni.value, '/build-order', { method: 'PUT', body: { order, meta: { source: 'hub' } } });
    return true;
  } catch (e) {
    error.value = readError(e);
    return false;
  } finally {
    saving.value = false;
  }
}
async function addSteps() {
  const order = withAdded(newId);
  if (order) await write(order);
}

// ------------------------------------------------------------------ planned planets by hand
const planetOpen = ref(false);
/** key of the planned planet being edited, null: a new one */
const planetEdit = ref<string | null>(null);
const pName = ref('');
const pCoords = ref<{ g: number | ''; s: number | ''; p: number | '' }>({ g: '', s: '', p: '' });
const pTemp = ref<number | ''>('');
function openPlanet(key: string | null) {
  if (planetOpen.value && planetEdit.value === key) return void (planetOpen.value = false);
  const d = key ? stored.value?.order.planned?.[key] : undefined;
  planetEdit.value = key;
  pName.value = d?.name ?? (key ? (stored.value?.meta.names?.[String(plannedNumber(key))] ?? '') : '');
  pCoords.value = { g: d?.coords?.g ?? '', s: d?.coords?.s ?? '', p: d?.coords?.p ?? '' };
  pTemp.value = d?.temp ?? '';
  planetOpen.value = true;
}
const pCoordsSet = computed(() => Object.values(pCoords.value).some((v) => v !== ''));
const planetValid = computed(() => {
  const c = pCoords.value;
  const u = ctx.value?.universe.settings;
  const within = (v: number | '', max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max;
  const coordsOk = !pCoordsSet.value || (within(c.g, u?.galaxies ?? 99) && within(c.s, u?.systems ?? 9999) && within(c.p, u?.positions ?? 99));
  return coordsOk && (pTemp.value === '' || (Number.isInteger(pTemp.value) && Math.abs(pTemp.value) <= 300));
});
async function savePlanet() {
  if (!planetValid.value) return;
  const order = stored.value?.order ?? emptyOrder();
  const key = planetEdit.value ?? freePlannedKey(order);
  if (!key) return;
  const details: PlannedPlanet = {};
  if (pName.value.trim()) details.name = pName.value.trim();
  if (pCoordsSet.value) details.coords = { g: Number(pCoords.value.g), s: Number(pCoords.value.s), p: Number(pCoords.value.p) };
  if (pTemp.value !== '') details.temp = pTemp.value;
  const ok = await write({ ...order, planets: { ...order.planets, [key]: order.planets[key] ?? [] }, planned: { ...(order.planned ?? {}), [key]: details } });
  if (!ok) return;
  picked.value = key;
  planetOpen.value = false;
}
/** removes a planned planet with its steps; transports to it lose their target */
async function removePlanet(key: string) {
  const order = stored.value?.order;
  if (!order || !confirm(t('buildOrder.removePlanetConfirm', { planet: plannedName(key), n: order.planets[key]?.length ?? 0 }))) return;
  const planets = Object.fromEntries(
    Object.entries(order.planets)
      .filter(([k]) => k !== key)
      .map(([k, list]) => [k, list.map((s) => (s.transport?.target === key ? { ...s, transport: { ...s.transport, target: null } } : s))]),
  );
  const planned = Object.fromEntries(Object.entries(order.planned ?? {}).filter(([k]) => k !== key));
  const basePlanets = Object.fromEntries(Object.entries(order.base.planets).filter(([k]) => k !== key));
  if (await write({ base: { ...order.base, planets: basePlanets }, planets, planned })) {
    picked.value = null;
    planetOpen.value = false;
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
  <div class="card" data-tour="build-order-head">
    <div class="row small">
      <template v-if="stored">
        <span class="muted">{{ t(stored.meta.source === 'pr0plan' ? 'buildOrder.imported' : 'buildOrder.created', { time: dateTime(stored.createdAt) }) }}</span>
        <span v-if="end" class="muted">{{ t('buildOrder.doneAt', { time: clock(end) }) }}</span>
        <span v-if="saving" class="faint">{{ t('buildOrder.saving') }}</span>
      </template>
      <span v-else class="muted">{{ t('buildOrder.none') }}</span>
      <span class="grow" />
      <a v-if="pr0planUrl" :href="pr0planUrl" target="_blank" rel="noopener" class="small" :title="t('buildOrder.pr0planTitle')">
        {{ t('buildOrder.pr0plan') }} <Icon name="external" :size="12" />
      </a>
      <button class="small" :class="{ active: planetOpen && !planetEdit }" :title="t('buildOrder.addPlanetTitle')" @click="openPlanet(null)"><Icon name="planets" :size="14" /> {{ t('buildOrder.addPlanet') }}</button>
      <button v-if="planetKey" class="small" :class="{ active: addOpen }" data-tour="build-order-add" @click="addOpen = !addOpen"><Icon name="plus" :size="14" /> {{ t('buildOrder.add') }}</button>
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
    <div v-if="plannedKeys.length" class="small bo-planned" data-tour="build-order-planned">
      <div class="row bo-planned-row">
        <button v-if="props.planetKey" class="small" :class="{ primary: planetKey === props.planetKey }" @click="picked = null">{{ planetLabel(props.planetKey) }}</button>
        <button v-for="k in plannedKeys" :key="k" class="small" :class="{ primary: k === planetKey }" @click="picked = k">
          {{ planetLabel(k) }} ({{ t('buildOrder.open', { n: openOf(stored!.order.planets[k]) }) }})
        </button>
        <Hint>{{ assignable.length ? t('buildOrder.plannedAssignHint') : t('buildOrder.plannedHint', { m: fmt(startResources[901]), k: fmt(startResources[902]), d: fmt(startResources[903]) }) }}</Hint>
        <template v-if="isPlannedKey(planetKey)">
          <button class="small icon-btn" :class="{ active: planetOpen && planetEdit === planetKey }" :title="t('buildOrder.editPlanet')" :aria-label="t('buildOrder.editPlanet')" @click="openPlanet(planetKey)">
            <Icon name="edit" :size="14" />
          </button>
          <button class="small icon-btn" :title="t('buildOrder.removePlanet')" :aria-label="t('buildOrder.removePlanet')" :disabled="saving" @click="removePlanet(planetKey)"><Icon name="trash" :size="14" /></button>
        </template>
      </div>
      <div v-for="k in assignable.length ? plannedKeys : []" :key="`a-${k}`" class="row bo-planned-row">
        <span>{{ plannedName(k) }}</span>
        <span class="muted">→</span>
        <select v-model="assignTo[k]" :aria-label="t('buildOrder.mapTo')">
          <option :value="null">{{ t('buildOrder.assignPick') }}</option>
          <option v-for="p in assignable" :key="p.key" :value="p.key">{{ planetLabel(p.key) }}</option>
        </select>
        <button class="small" :disabled="!assignTo[k] || saving" @click="assign(k)">{{ t('buildOrder.assign') }}</button>
      </div>
    </div>
    <form v-if="planetOpen" class="bo-add small" @submit.prevent="savePlanet">
      <div class="row bo-add-row">
        <label>{{ t('buildOrder.planetName') }} <input v-model="pName" type="text" maxlength="40" class="bo-name-input" /></label>
        <label class="bo-coords">{{ t('buildOrder.planetCoords') }}
          <input v-model.number="pCoords.g" type="number" min="1" step="1" class="bo-coord-input" :aria-label="t('buildOrder.planetGalaxy')" />:<input
            v-model.number="pCoords.s" type="number" min="1" step="1" class="bo-coord-input" :aria-label="t('buildOrder.planetSystem')" />:<input
            v-model.number="pCoords.p" type="number" min="1" step="1" class="bo-coord-input" :aria-label="t('buildOrder.planetPosition')" />
        </label>
        <label>{{ t('buildOrder.planetTemp') }} <input v-model.number="pTemp" type="number" step="1" class="bo-num-input" /></label>
        <button type="submit" class="primary small" :disabled="!planetValid || saving">{{ t(planetEdit ? 'buildOrder.planetSave' : 'buildOrder.planetCreate') }}</button>
        <Hint>{{ t('buildOrder.planetHint', { m: fmt(startResources[901]), k: fmt(startResources[902]), d: fmt(startResources[903]) }) }}</Hint>
      </div>
    </form>
    <form v-if="addOpen && planetKey" class="bo-add small" @submit.prevent="addSteps">
      <p class="muted" style="margin: 0">{{ t('buildOrder.addTitle', { planet: planetLabel(planetKey) }) }} <Hint>{{ t('buildOrder.addHint') }}</Hint></p>
      <div class="row bo-add-row">
        <select v-model="addKind" :aria-label="t('buildOrder.addKind')">
          <option v-for="k in ADD_KINDS" :key="k" :value="k">{{ t(`buildOrder.kind.${k}`) }}</option>
        </select>
        <template v-if="!isTransport">
          <select v-model="addElement" :aria-label="t('buildOrder.addElement')">
            <option v-for="id in addElements" :key="id" :value="id">{{ name(id) }}</option>
          </select>
          <label>{{ isUnit ? t('buildOrder.addUnits') : t('buildOrder.addLevels') }}
            <input v-model.number="addCount" type="number" min="1" :max="countMax" step="1" class="bo-num-input" />
          </label>
        </template>
        <label>{{ t('buildOrder.addAt') }}
          <input v-model.number="addAt" type="number" min="1" :max="steps.length + 1" step="1" class="bo-num-input" />
        </label>
        <span v-if="addPreview" class="muted">→ {{ isUnit ? t('buildOrder.addPreviewUnits', { n: fmt(addCount), total: fmt(addPreview.to) }) : addPreview.from === addPreview.to ? t('buildOrder.addPreviewLevel', { level: addPreview.to }) : t('buildOrder.addPreviewLevels', { from: addPreview.from, to: addPreview.to }) }}</span>
        <button type="submit" class="primary small" :disabled="!addValid || saving">{{ t('buildOrder.addButton') }}</button>
      </div>
      <BuildOrderTransportFields v-if="isTransport" v-model="trDraft" :targets="trTargets" :label="planetLabel" />
      <p v-if="!stored" class="faint" style="margin: 0">{{ t('buildOrder.addStarts') }}</p>
    </form>
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
      <div class="bo-list" data-tour="build-order-list">
        <div
          v-for="r in shownRows"
          :key="r.step.id"
          class="card bo-step"
          :class="{ next: r.step.id === nextId, faded: r.result?.state === 'deactivated' || isDone(r), over: dragOver === r.index && dragFrom !== r.index }"
          :draggable="!mobile && editId !== r.step.id"
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
            <button
              v-if="editable(r.step)" class="small icon-btn" :class="{ active: editId === r.step.id }" :title="t('buildOrder.edit')" :aria-label="t('buildOrder.edit')"
              @click="openEdit(r.step)"
            ><Icon name="edit" :size="14" /></button>
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
            <span v-if="r.result.end! > r.result.start!" class="muted">{{ t(r.step.kind === 'transport' ? 'buildOrder.arrival' : 'buildOrder.until', { time: clock(r.result.end!) }) }}</span>
            <span v-if="r.result.speed" class="warn" :title="t('buildOrder.astroSpeedTitle')">{{ t('buildOrder.astroSpeed', { speed: r.result.speed }) }}</span>
            <span v-else-if="r.result.wait && !r.result.transport" class="faint">{{ t(`buildOrder.wait.${r.result.wait}`) }}</span>
            <span v-if="r.result.transport" class="warn" :title="t('buildOrder.overflowTitle')">
              {{ t('buildOrder.overflow') }}
              <template v-for="id in RESOURCES" :key="id"><span v-if="r.result.transport[id]" class="bo-cost">{{ short(r.result.transport[id]) }} {{ name(id) }}</span></template>
            </span>
            <span class="grow" />
            <span v-if="r.result.cost" class="muted">
              <template v-for="id in RESOURCES" :key="id"><span v-if="r.result.cost[id]" class="bo-cost">{{ short(r.result.cost[id]) }} {{ name(id) }}</span></template>
              <span v-if="r.result.fuel" class="bo-cost faint">{{ t('buildOrder.fuel', { n: fmt(r.result.fuel) }) }}</span>
            </span>
            <span v-if="r.result.full" class="warn bo-full" :title="t('buildOrder.fullTitle')">
              <Icon name="warning" :size="13" />
              <template v-for="id in RESOURCES" :key="id"><span v-if="r.result.full[id]" class="bo-cost">{{ t('buildOrder.full', { res: name(id), since: clock(r.result.full[id].since), lost: short(r.result.full[id].lost) }) }}</span></template>
            </span>
            <span v-if="r.result.before && r.result.after" class="faint bo-full" :title="t('buildOrder.balanceTitle')">
              {{ t('buildOrder.balance') }}
              <template v-for="id in RESOURCES" :key="id"><span class="bo-cost"><span class="mono">{{ short(r.result.before[id] ?? 0) }} → {{ short(r.result.after[id] ?? 0) }}</span> {{ name(id) }}</span></template>
            </span>
          </div>
          <div v-else-if="r.result?.state === 'invalid'" class="small neg">{{ t(`buildOrder.never.${r.result.wait ?? 'requirements'}`) }}</div>
          <div v-if="r.step.kind === 'transport' && transportInfo(r.step.transport!)" class="small faint bo-times">{{ transportInfo(r.step.transport!) }}</div>
          <form v-if="editId === r.step.id" class="bo-add small" @submit.prevent="saveEdit(r.index)">
            <BuildOrderTransportFields
              v-if="r.step.kind === 'transport'" v-model="editDraft" :targets="trTargets" :label="planetLabel"
              :no-ships="!editOriginal?.ships" :no-target="editOriginal?.target == null"
            />
            <div v-else class="row bo-add-row">
              <select v-model="editElement" :aria-label="t('buildOrder.addElement')">
                <option v-for="id in elementsOf(r.step.kind as AddKind)" :key="id" :value="id">{{ name(id) }}</option>
              </select>
              <label>{{ t('buildOrder.addUnits') }}
                <input v-model.number="editCount" type="number" min="1" max="10000000" step="1" class="bo-num-input" />
              </label>
            </div>
            <div class="row bo-add-row">
              <button type="submit" class="primary small" :disabled="!editValid(r.step) || saving">{{ t('buildOrder.editSave') }}</button>
              <button type="button" class="small" @click="editId = null">{{ t('buildOrder.editCancel') }}</button>
            </div>
          </form>
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
.bo-planned { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.bo-planned-row { gap: 6px; flex-wrap: wrap; }
.bo-filters { margin: 0 0 8px; }
.bo-add { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--border, #444); border-radius: 8px; }
.bo-add-row { gap: 6px 10px; flex-wrap: wrap; }
.bo-num-input { width: 6em; margin-left: 4px; }
.bo-res-input { width: 8em; margin-left: 4px; }
.bo-name-input { width: 12em; margin-left: 4px; }
.bo-coord-input { width: 4.5em; margin: 0 2px; }
button.active { border-color: var(--accent); color: var(--accent); }
.bo-step { margin-bottom: 6px; padding: 8px 12px; }
.bo-step.next { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.bo-step.over { border-top: 2px solid var(--accent); }
.bo-step .row { gap: 8px; flex-wrap: wrap; }
.bo-grip { cursor: grab; }
.bo-num { min-width: 2.2em; text-align: right; }
.bo-times { margin-top: 4px; flex-wrap: wrap; }
.bo-full { flex-basis: 100%; }
.bo-cost + .bo-cost { margin-left: 8px; }
.faded { opacity: 0.55; }
.icon-btn.active { color: var(--accent); }
.bo-actions { display: flex; gap: 4px; margin-left: auto; }
@media (max-width: 800px) {
  .bo-step { padding: 8px 10px; }
  .bo-actions { flex: 1 0 100%; justify-content: flex-end; }
}
</style>
