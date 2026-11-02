<script setup lang="ts">
import Icon from '../components/Icon.vue';
import {
  buildingsOf, capacityOf, RESEARCH_GROUPS, RESEARCH_LAB, RESEARCH_NETWORK, researchOf, resourceAt, shipsOf, SHIPYARD, type Arrival, type BuildingGroup,
  type BuildingInfo, type BuildPlanet, type ShipInfo,
} from '@pr0hub/core/buildings';
import { RESOURCES } from '@pr0hub/core/tech';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import { useClock } from '../clock';
import Hint from '../components/Hint.vue';
import PageHeader from '../components/PageHeader.vue';
import Ticker from '../components/Ticker.vue';
import BuildOrder from '../components/BuildOrder.vue';
import { useLoader, useMobile, useStored, useUni } from '../composables';
import { ago, dateTime, fmt, name, short } from '../format';
import { tables, useLiveReload } from '../live';

/**
 * Build & research: the viewer's buildings per planet/moon like the game's buildings page, and in a second tab the
 * research when started on a planet like the research page: level, requirements, cost of the next level, missing
 * resources and when they are there (production per hour up to the storage, plus fleets landing on the planet), build
 * or research time. An alert per element notifies (bell, push, Discord) once the next level is affordable. A third tab
 * lists ships, defense and missiles like the shipyard: count, cost and time per unit, how many fit now.
 */
interface C3 {
  g: number;
  s: number;
  p: number;
}
interface Planet {
  key: string;
  name: string;
  coords: C3;
  type: 'planet' | 'moon';
  source: 'empire' | 'buildings' | 'research';
  planet: BuildPlanet;
  shown: Record<string, { next: number; cost: Record<number, number>; time: number | null }> | null;
  shownResearch: Record<string, { next: number; cost: Record<number, number>; time: number | null }> | null;
  arrivals: (Arrival & { missionName: string; from: C3 })[];
  temp: number | null;
}
interface Alert {
  id: number;
  g: number;
  s: number;
  p: number;
  planet_type: 'planet' | 'moon';
  element_id: number;
  level: number;
}
interface Data {
  planets: Planet[];
  research: Record<string, number>;
  researchQueue: { id: number; level: number; end: number | null }[];
  researchSpeed: number | null;
  universityFactor: number;
  catchUp: number | null;
  catchUpFrom: { source: 'page' | 'research' | 'overview' | 'stats'; time: number } | null;
  buildingSpeed: number | null;
  shipyardSpeed: number | null;
  resourceSpeed: number | null;
  storageFactor: number;
  empireTime: number | null;
  fleetsTime: number | null;
  alerts: Alert[];
  /** buildings the viewer hid (account, all planets) */
  hidden: number[];
}

const { t, locale } = useI18n();
const { uni } = useUni();
const route = useRoute();
const router = useRouter();
const mobile = useMobile();
const { data, error, load } = useLoader(() => uniApi<Data>(uni.value, '/buildings'));
onMounted(load);
useLiveReload(load, tables('empire', 'overview', 'buildings', 'research', 'fleets', 'building_alerts'));

type Tab = 'buildings' | 'research' | 'ships' | 'order';
const TABS: Tab[] = ['buildings', 'research', 'ships', 'order'];
const storedTab = useStored<Tab>('build.tab', 'buildings');
/** the tab from the link (push notification, bell), else the last one */
const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : storedTab.value),
  set: (v) => {
    storedTab.value = v;
    router.replace({ query: { ...route.query, tab: v } });
  },
});
const stored = useStored<string | null>('buildings.planet', null);
const buildingFilter = useStored<BuildingGroup | 'all'>('buildings.filter', 'all');
const researchFilter = useStored<string>('research.filter', 'all');
const shipFilter = useStored<string>('ships.filter', 'all');
const filter = computed({
  get: () => (tab.value === 'research' ? researchFilter.value : tab.value === 'ships' ? shipFilter.value : buildingFilter.value),
  set: (v: string) => {
    if (tab.value === 'research') researchFilter.value = v;
    else if (tab.value === 'ships') shipFilter.value = v;
    else buildingFilter.value = v as BuildingGroup | 'all';
  },
});
/** a link (push notification) names the planet */
// separate sources: the planet is only taken over when the link changes, not on every route change (tab switch)
watch(
  [() => route.query.c, () => route.query.type],
  ([c, type]) => {
    if (typeof c === 'string' && /^\d+:\d+:\d+$/.test(c)) stored.value = `${c}:${type === 'moon' ? 'moon' : 'planet'}`;
  },
  { immediate: true },
);
const allPlanets = computed(() => data.value?.planets ?? []);
/** research is started on planets (moons have no lab); build orders are for planets */
const planets = computed(() => (tab.value === 'research' || tab.value === 'order' ? allPlanets.value.filter((p) => p.type === 'planet') : allPlanets.value));
const current = computed(() => planets.value.find((p) => p.key === stored.value) ?? planets.value[0] ?? null);

const now = useClock();
/** the list is calculated every 10 seconds; countdowns tick in `<Ticker>`s */
const slow = computed(() => Math.floor(now.value / 10) * 10);
const list = computed<BuildingInfo[]>(() => {
  const p = current.value;
  const d = data.value;
  if (!p || !d || tab.value === 'ships') return [];
  if (tab.value === 'research') {
    return researchOf(p.planet, {
      research: d.research, queue: d.researchQueue, otherLabs: otherLabs.value, catchUp: d.catchUp, researchSpeed: d.researchSpeed,
      universityFactor: d.universityFactor, storageFactor: d.storageFactor, arrivals: p.arrivals, now: slow.value, shown: p.shownResearch ?? undefined,
    });
  }
  return buildingsOf(p.planet, {
    research: d.research, catchUp: d.catchUp, buildingSpeed: d.buildingSpeed, storageFactor: d.storageFactor,
    arrivals: p.arrivals, now: slow.value, shown: p.shown ?? undefined,
  });
});
/** ships, defense and missiles of the planet (shipyard tab) */
const shipList = computed<ShipInfo[]>(() => {
  const p = current.value;
  const d = data.value;
  if (!p || !d || tab.value !== 'ships') return [];
  return shipsOf(p.planet, { research: d.research, shipyardSpeed: d.shipyardSpeed, storageFactor: d.storageFactor, arrivals: p.arrivals, now: slow.value });
});
/** units to build per element (shipyard tab), for the total cost and time */
const amounts = ref<Record<number, number>>({});
const amountOf = (s: ShipInfo) => Math.max(1, Math.floor(amounts.value[s.id] || 1));
/** lab levels of the other planets (intergalactic research network) */
const otherLabs = computed(() => allPlanets.value.filter((p) => p.type === 'planet' && p !== current.value).map((p) => p.planet.values[RESEARCH_LAB] ?? 0));
const network = computed(() => data.value?.research[RESEARCH_NETWORK] ?? 0);
/** buildings the viewer hid (kept in the account, for all planets) and the name filter */
const hidden = computed(() => data.value?.hidden ?? []);
const showHidden = ref(false);
const search = ref('');
const isHidden = (b: { id: number }) => hidden.value.includes(b.id);
async function saveHidden(ids: number[]) {
  try {
    data.value!.hidden = (await uniApi<{ hidden: number[] }>(uni.value, '/buildings/hidden', { method: 'PUT', body: { ids } })).hidden;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const toggleHidden = (b: { id: number }) => saveHidden(isHidden(b) ? hidden.value.filter((id) => id !== b.id) : [...hidden.value, b.id]);
/** buildings hidden in this browser before they were kept in the account: moved over once */
const localHidden = useStored<number[]>('buildings.hidden', []);
watch(data, (d) => {
  if (!d || !localHidden.value.length) return;
  const ids = [...new Set([...d.hidden, ...localHidden.value])];
  localHidden.value = [];
  if (ids.length !== d.hidden.length) saveHidden(ids);
});
const items = computed<(BuildingInfo | ShipInfo)[]>(() => (tab.value === 'ships' ? shipList.value : list.value));
const inGroup = computed(() => items.value.filter((b) => filter.value === 'all' || b.groups.includes(filter.value)));
const hiddenCount = computed(() => inGroup.value.filter(isHidden).length);
const shownList = computed(() => {
  const q = search.value.trim().toLowerCase();
  return inGroup.value.filter((b) => (showHidden.value || !isHidden(b)) && (!q || name(b.id).toLowerCase().includes(q)));
});

/** live resources of the planet: production since the page time up to the storage, fleets landed until now */
function resources(p: Planet, n: number) {
  return RESOURCES.map((id) => {
    const cap = capacityOf(p.planet, id, data.value!.storageFactor);
    const arrivals = p.arrivals.map((a) => ({ at: a.at, amount: a.resources[id] ?? 0 }));
    return { id, value: Math.floor(resourceAt(p.planet.resources[id] ?? 0, p.planet.perHour[id] ?? 0, cap, p.planet.time, n, arrivals)), cap, perHour: p.planet.perHour[id] ?? 0 };
  });
}
const missingPerHour = computed(() => !!current.value && current.value.type === 'planet' && !Object.keys(current.value.planet.perHour).length);
const upcomingArrivals = (p: Planet, n: number) => p.arrivals.filter((a) => a.at > n);

/** "1d 02:03:04" / "02:03:04" */
function countdown(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return d ? `${d}d ${hms}` : hms;
}
const clock = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString(locale.value, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const planetLabel = (p: Planet) => `${p.name ? p.name + ' ' : ''}[${p.coords.g}:${p.coords.s}:${p.coords.p}]${p.type === 'moon' ? ` (${t('common.moon')})` : ''}`;

// ---------------------------------------------------------------- alerts
const alertOf = (b: BuildingInfo) => {
  const p = current.value!;
  return data.value?.alerts.find((a) => a.element_id === b.id && a.planet_type === p.type && a.g === p.coords.g && a.s === p.coords.s && a.p === p.coords.p) ?? null;
};
/** an alert makes sense while the next level waits for resources */
const alertable = (b: BuildingInfo) => b.state === 'resources' || b.state === 'never' || b.state === 'storage' || b.state === 'busy';
const busy = ref<number | null>(null);
async function toggleAlert(b: BuildingInfo) {
  const p = current.value!;
  const a = alertOf(b);
  busy.value = b.id;
  try {
    const res = a
      ? await uniApi<{ alerts: Alert[] }>(uni.value, `/buildings/alerts/${a.id}`, { method: 'DELETE' })
      : await uniApi<{ alerts: Alert[] }>(uni.value, '/buildings/alerts', { method: 'PUT', body: { ...p.coords, type: p.type, id: b.id, level: b.next } });
    data.value!.alerts = res.alerts;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}

/** "Lab busy until Sat 14:00" / "Shipyard busy" */
const busyText = (b: BuildingInfo) =>
  b.busy!.until != null ? t(`buildings.busyUntil.${b.busy!.by}`, { time: clock(b.busy!.until) }) : t(`buildings.busyBy.${b.busy!.by}`);

const FILTERS = computed<string[]>(() =>
  tab.value === 'research' ? [...Object.keys(RESEARCH_GROUPS), 'all'] : tab.value === 'ships' ? ['ships', 'defense', 'all'] : ['prod', 'storage', 'other', 'all'],
);
const shipBusyText = (s: ShipInfo) =>
  s.busy!.until != null ? t('buildings.busyUntil.building', { time: clock(s.busy!.until) }) : t('buildings.busyBy.building');
/** state text of a unit: "max" means one per planet or a full silo */
const shipStateText = (s: ShipInfo) =>
  t(s.state === 'max' ? (s.id >= 500 ? 'buildings.state.siloFull' : 'buildings.state.onePerPlanet') : `buildings.state.${s.state}`);
const buildingRows = computed(() => shownList.value as BuildingInfo[]);
const shipRows = computed(() => shownList.value as ShipInfo[]);
/** state text; research is "researchable" instead of "buildable" */
const stateText = (state: string) => t(`buildings.state.${tab.value === 'research' && state === 'buildable' ? 'researchable' : state}`);
const sourceLabel = (p: Planet) => t(p.source === 'buildings' ? 'buildings.fromPage' : p.source === 'research' ? 'buildings.fromResearch' : 'buildings.fromEmpire');
const costClass = (b: { missing: Record<number, number> }, res: number) => (b.missing[res] ? 'neg' : 'pos');
</script>

<template>
  <PageHeader :title="t('buildings.title')">
    <template #hint>
      <Hint>
        <p>{{ t('buildings.hint1') }}</p>
        <p>{{ t('buildings.hintResearch') }}</p>
        <p>{{ t('buildings.hintShips') }}</p>
        <p>{{ t('buildings.hintOrder') }}</p>
        <p>{{ t('buildings.hint2') }}</p>
        <p>{{ t('buildings.hint3') }}</p>
      </Hint>
    </template>
    <div class="seg">
      <button :class="{ active: tab === 'buildings' }" @click="tab = 'buildings'">{{ t('buildings.tabBuildings') }}</button>
      <button :class="{ active: tab === 'research' }" @click="tab = 'research'">{{ t('buildings.tabResearch') }}</button>
      <button :class="{ active: tab === 'ships' }" @click="tab = 'ships'">{{ t('buildings.tabShips') }}</button>
      <button :class="{ active: tab === 'order' }" @click="tab = 'order'">{{ t('buildings.tabOrder') }}</button>
    </div>
  </PageHeader>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !planets.length" class="card muted">{{ t('buildings.empty') }}</div>

  <template v-if="data && current">
    <div class="card">
      <div class="row small">
        <label>
          {{ t('buildings.planet') }}
          <select :value="current.key" @change="stored = ($event.target as HTMLSelectElement).value">
            <option v-for="p in planets" :key="p.key" :value="p.key">{{ planetLabel(p) }}</option>
          </select>
        </label>
        <span class="muted">
          {{ sourceLabel(current) }}: {{ dateTime(current.planet.time) }} ({{ ago(current.planet.time) }})
        </span>
        <span class="muted">
          {{ t('imperium.fleets') }}: <template v-if="data.fleetsTime">{{ dateTime(data.fleetsTime) }} ({{ ago(data.fleetsTime) }})</template><span v-else class="warn">{{ t('imperium.fleetsMissing') }}</span>
        </span>
        <span v-if="data.catchUp" class="muted" :title="t('buildings.catchUpTitle')">
          {{ t('buildings.catchUp', { n: fmt(data.catchUp, 2) }) }}
          <span v-if="data.catchUpFrom" class="faint">({{ t(`buildings.catchUpFrom.${data.catchUpFrom.source}`, { time: dateTime(data.catchUpFrom.time) }) }})</span>
        </span>
        <template v-if="tab === 'research'">
          <span v-if="!data.researchSpeed" class="faint" :title="t('buildings.researchSpeedUnknownTitle')">{{ t('buildings.researchSpeedUnknown') }}</span>
          <span class="muted">{{ t('buildings.lab', { level: current.planet.values[RESEARCH_LAB] ?? 0 }) }}<template v-if="network"> · {{ t('buildings.network', { n: network }) }}</template></span>
        </template>
        <template v-else-if="tab === 'ships'">
          <span v-if="!data.shipyardSpeed" class="faint" :title="t('buildings.shipyardSpeedUnknownTitle')">{{ t('buildings.shipyardSpeedUnknown') }}</span>
          <span class="muted">{{ t('buildings.shipyardLevel', { level: current.planet.values[SHIPYARD] ?? 0 }) }}</span>
        </template>
        <span v-else-if="!data.buildingSpeed" class="faint" :title="t('buildings.speedUnknownTitle')">{{ t('buildings.speedUnknown') }}</span>
        <span v-if="tab === 'buildings' && current.planet.fields" class="muted">{{ t('buildings.fields', { used: current.planet.fields.used, max: current.planet.fields.max }) }}</span>
      </div>
      <p v-if="missingPerHour" class="warn small" style="margin: 8px 0 0">{{ t('imperium.perHourMissing') }}</p>
      <p v-if="tab === 'research' && !(current.planet.values[RESEARCH_LAB] ?? 0)" class="warn small" style="margin: 8px 0 0">{{ t('buildings.noLab') }}</p>
      <Ticker v-if="tab === 'research' && data.researchQueue.length" v-slot="{ now: n }">
        <div class="small" style="margin-top: 6px">
          <span class="muted">{{ t('buildings.researchQueue') }}:</span>
          <span v-for="(q, i) in data.researchQueue" :key="i" class="bld-arrival">
            {{ name(q.id) }} {{ q.level }}<template v-if="q.end != null"> · <span class="mono">{{ q.end > n ? countdown(q.end - n) : t('imperium.done') }}</span></template>
          </span>
        </div>
      </Ticker>

      <Ticker v-slot="{ now: n }">
        <div class="bld-res">
          <div v-for="r in resources(current, n)" :key="r.id">
            <span class="muted small">{{ name(r.id) }}</span>
            <b class="num" :class="{ neg: r.value >= r.cap }">{{ fmt(r.value) }}</b>
            <span class="faint small">/ {{ short(r.cap) }} · {{ r.perHour >= 0 ? '+' : '' }}{{ short(r.perHour) }}/h</span>
          </div>
        </div>
        <div v-if="upcomingArrivals(current, n).length" class="small" style="margin-top: 6px">
          <span class="muted">{{ t('buildings.arrivals') }}:</span>
          <span v-for="(a, i) in upcomingArrivals(current, n)" :key="i" class="bld-arrival">
            {{ clock(a.at) }} · {{ a.missionName || t(`game.missions.${a.mission}`) }}<Icon v-if="a.back" name="return" :size="12" :label="t('imperium.phase.return')" />:
            <template v-for="id in RESOURCES" :key="id"><span v-if="a.resources[id]"> +{{ short(a.resources[id]) }} {{ name(id) }}</span></template>
          </span>
        </div>
      </Ticker>
    </div>

    <BuildOrder v-if="tab === 'order'" :hub="data" :planet-key="current.key" :mobile="mobile" />
    <template v-else>
    <div class="row bld-filters">
      <select v-if="mobile" v-model="filter" :aria-label="t('buildings.filterLabel')">
        <option v-for="f in FILTERS" :key="f" :value="f">{{ t(`buildings.filter.${f}`) }}</option>
      </select>
      <div v-else class="seg">
        <button v-for="f in FILTERS" :key="f" :class="{ active: filter === f }" @click="filter = f">{{ t(`buildings.filter.${f}`) }}</button>
      </div>
      <input v-model="search" type="search" :placeholder="t('buildings.search')" class="bld-search" />
      <label v-if="hiddenCount || showHidden" class="small">
        <input v-model="showHidden" type="checkbox" /> {{ t('buildings.showHidden', { n: hiddenCount }) }}
      </label>
    </div>
    <p v-if="!shownList.length" class="card muted">{{ t('buildings.noMatch') }}</p>

    <template v-if="tab === 'ships'">
      <!-- desktop: one table row per ship, defense or missile -->
      <div v-if="!mobile" class="card scroll-x">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('buildings.unit') }}</th>
              <th class="num">{{ t('buildings.count') }}</th>
              <th v-for="id in RESOURCES" :key="id" class="num">{{ name(id) }}</th>
              <th>{{ t('buildings.status') }}</th>
              <th class="num">{{ t('buildings.unitTime') }}</th>
              <th class="num">{{ t('buildings.amount') }} · {{ t('buildings.total') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in shipRows" :key="s.id" :class="{ faded: s.state === 'requirements' || s.state === 'max', 'bld-hidden': isHidden(s) }">
              <td style="white-space: normal">
                {{ name(s.id) }}
                <div v-if="s.state === 'requirements'" class="small bld-reqs">
                  <span v-for="r in s.requirements" :key="r.id" :class="r.own < r.need ? 'warn' : 'pos'" class="bld-req">{{ name(r.id) }} {{ r.own }}/{{ r.need }}</span>
                </div>
              </td>
              <td class="num">
                {{ fmt(s.count) }}<div v-if="s.queued" class="small faint">{{ t('buildings.queued', { n: fmt(s.queued) }) }}</div>
              </td>
              <td v-for="id in RESOURCES" :key="id" class="num">
                <template v-if="s.cost[id]">
                  <span :class="costClass(s, id)">{{ fmt(s.cost[id]) }}</span>
                  <div v-if="s.missing[id]" class="small neg">−{{ fmt(Math.round(s.missing[id])) }}</div>
                </template>
                <span v-else class="faint">–</span>
              </td>
              <td>
                <Ticker v-if="s.state === 'resources' || (s.state === 'busy' && s.readyAt != null && s.busy?.until != null)" v-slot="{ now: n }">
                  <span v-if="s.readyAt! > n" class="mono">{{ countdown(s.readyAt! - n) }}</span>
                  <span v-else class="pos">{{ stateText('buildable') }}</span>
                  <div class="small faint">{{ clock(s.readyAt!) }}</div>
                </Ticker>
                <span v-else :class="s.state === 'buildable' ? 'pos' : 'warn'">{{ shipStateText(s) }}</span>
                <div v-if="s.state === 'buildable'" class="small faint">{{ t('buildings.maxNow', { n: fmt(s.max) }) }}</div>
                <div v-if="s.busy" class="small warn">{{ shipBusyText(s) }}</div>
              </td>
              <td class="num mono">{{ s.time != null ? countdown(s.time) : '–' }}</td>
              <td class="num small">
                <input v-model.number="amounts[s.id]" type="number" min="1" class="bld-amount" :aria-label="t('buildings.amount')" placeholder="1" />
                <div v-if="amountOf(s) > 1" class="faint">
                  <template v-for="id in RESOURCES" :key="id"><span v-if="s.cost[id]" class="bld-total">{{ short(s.cost[id] * amountOf(s)) }}</span></template>
                  <div v-if="s.time != null" class="mono">{{ countdown(s.time * amountOf(s)) }}</div>
                </div>
              </td>
              <td>
                <button class="small bld-bell alert-btn" :title="isHidden(s) ? t('buildings.unhide') : t('buildings.hide')" :aria-label="isHidden(s) ? t('buildings.unhide') : t('buildings.hide')" @click="toggleHidden(s)">
                  <Icon :name="isHidden(s) ? 'spy' : 'eyeOff'" :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- mobile: one card per unit -->
      <template v-else>
        <div v-for="s in shipRows" :key="s.id" class="card bld-card" :class="{ faded: s.state === 'requirements' || s.state === 'max', 'bld-hidden': isHidden(s) }">
          <div class="row">
            <b>{{ name(s.id) }}</b>
            <span class="muted small">{{ fmt(s.count) }}<template v-if="s.queued"> · {{ t('buildings.queued', { n: fmt(s.queued) }) }}</template></span>
            <span class="grow" />
            <button class="small bld-bell alert-btn" :title="isHidden(s) ? t('buildings.unhide') : t('buildings.hide')" :aria-label="isHidden(s) ? t('buildings.unhide') : t('buildings.hide')" @click="toggleHidden(s)">
              <Icon :name="isHidden(s) ? 'spy' : 'eyeOff'" :size="14" />
            </button>
          </div>
          <div v-if="s.state === 'requirements'" class="small bld-reqs">
            <span v-for="r in s.requirements" :key="r.id" :class="r.own < r.need ? 'warn' : 'pos'" class="bld-req">{{ name(r.id) }} {{ r.own }}/{{ r.need }}</span>
          </div>
          <div class="small bld-costs">
            <template v-for="id in RESOURCES" :key="id">
              <span v-if="s.cost[id]">{{ name(id) }} <span :class="costClass(s, id)">{{ short(s.cost[id]) }}</span></span>
            </template>
          </div>
          <div class="row small">
            <Ticker v-if="s.state === 'resources' || (s.state === 'busy' && s.readyAt != null && s.busy?.until != null)" v-slot="{ now: n }">
              <span v-if="s.readyAt! > n">{{ t('buildings.readyIn') }} <span class="mono">{{ countdown(s.readyAt! - n) }}</span> <span class="faint">({{ clock(s.readyAt!) }})</span></span>
              <span v-else class="pos">{{ stateText('buildable') }}</span>
            </Ticker>
            <span v-else :class="s.state === 'buildable' ? 'pos' : 'warn'">{{ shipStateText(s) }}<template v-if="s.state === 'buildable'"> · {{ t('buildings.maxNow', { n: fmt(s.max) }) }}</template></span>
            <span v-if="s.busy" class="warn">{{ shipBusyText(s) }}</span>
            <span class="grow" />
            <span v-if="s.time != null" class="muted"><Icon name="timer" :size="13" :label="t('common.time')" /> <span class="mono">{{ countdown(s.time) }}</span></span>
          </div>
          <div class="row small">
            <label>{{ t('buildings.amount') }} <input v-model.number="amounts[s.id]" type="number" min="1" class="bld-amount" placeholder="1" /></label>
            <span class="muted">
              <template v-for="id in RESOURCES" :key="id"><template v-if="s.cost[id]">{{ short(s.cost[id] * amountOf(s)) }} {{ name(id) }} · </template></template>
              <span v-if="s.time != null" class="mono">{{ countdown(s.time * amountOf(s)) }}</span>
            </span>
          </div>
        </div>
      </template>
    </template>

    <!-- desktop: one table row per building -->
    <div v-else-if="!mobile" class="card scroll-x">
      <table class="data">
        <thead>
          <tr>
            <th>{{ tab === 'research' ? t('buildings.researchCol') : t('buildings.building') }}</th>
            <th class="num">{{ t('buildings.level') }}</th>
            <th v-for="id in RESOURCES" :key="id" class="num">{{ name(id) }}</th>
            <th>{{ t('buildings.status') }}</th>
            <th class="num">{{ tab === 'research' ? t('buildings.researchTime') : t('buildings.buildTime') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in buildingRows" :key="b.id" :class="{ faded: b.state === 'requirements' || b.state === 'max', 'bld-hidden': isHidden(b) }">
            <td style="white-space: normal">
              {{ name(b.id) }}
              <div v-if="b.state === 'requirements'" class="small bld-reqs">
                <span v-for="r in b.requirements" :key="r.id" :class="r.own < r.need ? 'warn' : 'pos'" class="bld-req">
                  {{ name(r.id) }} {{ r.own }}/{{ r.need }}
                </span>
              </div>
            </td>
            <td class="num">
              {{ b.level }} <span class="faint"><Icon name="arrowRight" :size="11" /> {{ b.next }}</span>
              <div v-if="b.useful && b.next > b.useful" class="small faint" :title="t('buildings.uselessTitle', { level: b.useful })">{{ t('buildings.useless') }}</div>
            </td>
            <td v-for="id in RESOURCES" :key="id" class="num">
              <template v-if="b.cost[id]">
                <span :class="costClass(b, id)">{{ fmt(Math.round(b.cost[id])) }}</span>
                <div v-if="b.missing[id]" class="small neg">−{{ fmt(Math.round(b.missing[id])) }}</div>
              </template>
              <span v-else class="faint">–</span>
            </td>
            <td>
              <Ticker v-if="b.state === 'resources' || (b.state === 'busy' && b.readyAt != null && b.busy?.until != null)" v-slot="{ now: n }">
                <span v-if="b.readyAt! > n" class="mono">{{ countdown(b.readyAt! - n) }}</span>
                <span v-else class="pos">{{ stateText('buildable') }}</span>
                <div class="small faint">{{ clock(b.readyAt!) }}</div>
              </Ticker>
              <span v-else :class="b.state === 'buildable' ? 'pos' : 'warn'">{{ stateText(b.state) }}</span>
              <div v-if="b.busy" class="small warn">{{ busyText(b) }}</div>
            </td>
            <td class="num mono">{{ b.time != null ? countdown(b.time) : '–' }}</td>
            <td>
              <button
                v-if="alertable(b) || alertOf(b)"
                class="small bld-bell alert-btn"
                :class="{ active: alertOf(b) }"
                :disabled="busy === b.id"
                :title="alertOf(b) ? t('buildings.alertOff') : t('buildings.alertOn', { level: b.next })"
                :aria-label="alertOf(b) ? t('buildings.alertOff') : t('buildings.alertOn', { level: b.next })"
                @click="toggleAlert(b)"
              ><Icon :name="alertOf(b) ? 'bell' : 'bellOff'" :size="14" /></button>
              <button class="small bld-bell alert-btn" :title="isHidden(b) ? t('buildings.unhide') : t('buildings.hide')" :aria-label="isHidden(b) ? t('buildings.unhide') : t('buildings.hide')" @click="toggleHidden(b)">
                <Icon :name="isHidden(b) ? 'spy' : 'eyeOff'" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- mobile: one card per building -->
    <template v-else>
      <div v-for="b in buildingRows" :key="b.id" class="card bld-card" :class="{ faded: b.state === 'requirements' || b.state === 'max', 'bld-hidden': isHidden(b) }">
        <div class="row">
          <b>{{ name(b.id) }}</b>
          <span class="muted small">{{ b.level }} <Icon name="arrowRight" :size="11" /> {{ b.next }}</span>
          <span v-if="b.useful && b.next > b.useful" class="small faint" :title="t('buildings.uselessTitle', { level: b.useful })">{{ t('buildings.useless') }}</span>
          <span class="grow" />
          <button
            v-if="alertable(b) || alertOf(b)"
            class="small bld-bell alert-btn"
            :class="{ active: alertOf(b) }"
            :disabled="busy === b.id"
            :title="alertOf(b) ? t('buildings.alertOff') : t('buildings.alertOn', { level: b.next })"
            :aria-label="alertOf(b) ? t('buildings.alertOff') : t('buildings.alertOn', { level: b.next })"
            @click="toggleAlert(b)"
          ><Icon :name="alertOf(b) ? 'bell' : 'bellOff'" :size="14" /></button>
          <button class="small bld-bell alert-btn" :title="isHidden(b) ? t('buildings.unhide') : t('buildings.hide')" :aria-label="isHidden(b) ? t('buildings.unhide') : t('buildings.hide')" @click="toggleHidden(b)">
            <Icon :name="isHidden(b) ? 'spy' : 'eyeOff'" :size="14" />
          </button>
        </div>
        <div v-if="b.state === 'requirements'" class="small bld-reqs">
          <span v-for="r in b.requirements" :key="r.id" :class="r.own < r.need ? 'warn' : 'pos'" class="bld-req">{{ name(r.id) }} {{ r.own }}/{{ r.need }}</span>
        </div>
        <div class="small bld-costs">
          <template v-for="id in RESOURCES" :key="id">
            <span v-if="b.cost[id]">
              {{ name(id) }} <span :class="costClass(b, id)">{{ short(b.cost[id]) }}</span>
              <span v-if="b.missing[id]" class="neg">(−{{ short(b.missing[id]) }})</span>
            </span>
          </template>
        </div>
        <div class="row small">
          <Ticker v-if="b.state === 'resources' || (b.state === 'busy' && b.readyAt != null && b.busy?.until != null)" v-slot="{ now: n }">
            <span v-if="b.readyAt! > n">{{ t('buildings.readyIn') }} <span class="mono">{{ countdown(b.readyAt! - n) }}</span> <span class="faint">({{ clock(b.readyAt!) }})</span></span>
            <span v-else class="pos">{{ stateText('buildable') }}</span>
          </Ticker>
          <span v-else :class="b.state === 'buildable' ? 'pos' : 'warn'">{{ stateText(b.state) }}</span>
          <span v-if="b.busy" class="warn">{{ busyText(b) }}</span>
          <span class="grow" />
          <span v-if="b.time != null" class="muted"><Icon name="timer" :size="13" :label="t('common.time')" /> <span class="mono">{{ countdown(b.time) }}</span></span>
        </div>
      </div>
    </template>
    </template>
  </template>
</template>

<style scoped>
.bld-res { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 10px; }
.bld-res > div { display: flex; flex-direction: column; }
.bld-arrival { margin-left: 8px; white-space: nowrap; }
.bld-reqs { display: flex; flex-wrap: wrap; gap: 0 8px; }
.bld-req { white-space: nowrap; }
.bld-costs { display: flex; gap: 12px; flex-wrap: wrap; margin: 6px 0; }
.bld-filters { margin-bottom: 12px; }
.bld-search { width: 180px; }
.bld-amount { width: 72px; text-align: right; }
.bld-total + .bld-total::before { content: ' · '; }
@media (max-width: 800px) {
  .bld-filters select, .bld-search { flex: 1 1 140px; width: auto; min-width: 0; }
}
.bld-hidden { opacity: 0.45; }
.bld-bell + .bld-bell { margin-left: 4px; }
.faded { opacity: 0.6; }
.bld-card { margin-bottom: 8px; padding: 10px 12px; }
</style>
