<script setup lang="ts">
import { buildingsOf, capacityOf, resourceAt, type Arrival, type BuildingGroup, type BuildingInfo, type BuildPlanet } from '@pr0hub/core/buildings';
import { RESOURCES } from '@pr0hub/core/tech';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { uniApi } from '../api';
import { useClock } from '../clock';
import Hint from '../components/Hint.vue';
import Ticker from '../components/Ticker.vue';
import { useLoader, useMobile, useStored, useUni } from '../composables';
import { ago, dateTime, fmt, name, short } from '../format';
import { tables, useLiveReload } from '../live';

/**
 * The viewer's buildings per planet/moon like the game's buildings page: level, requirements, cost of the next level,
 * missing resources and when they are there (production per hour up to the storage, plus fleets landing on the
 * planet). An alert per building notifies (bell, push, Discord) once the next level is affordable.
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
  source: 'empire' | 'buildings';
  planet: BuildPlanet;
  shown: Record<string, { next: number; cost: Record<number, number>; time: number | null }> | null;
  arrivals: (Arrival & { missionName: string; from: C3 })[];
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
  catchUp: number | null;
  buildingSpeed: number | null;
  storageFactor: number;
  empireTime: number | null;
  fleetsTime: number | null;
  alerts: Alert[];
}

const { t, locale } = useI18n();
const { uni } = useUni();
const route = useRoute();
const mobile = useMobile();
const { data, error, load } = useLoader(() => uniApi<Data>(uni.value, '/buildings'));
onMounted(load);
useLiveReload(load, tables('empire', 'overview', 'buildings', 'fleets', 'building_alerts'));

const stored = useStored<string | null>('buildings.planet', null);
const filter = useStored<BuildingGroup | 'all'>('buildings.filter', 'all');
/** a link (push notification) names the planet */
watch(
  () => [route.query.c, route.query.type],
  ([c, type]) => {
    if (typeof c === 'string' && /^\d+:\d+:\d+$/.test(c)) stored.value = `${c}:${type === 'moon' ? 'moon' : 'planet'}`;
  },
  { immediate: true },
);
const planets = computed(() => data.value?.planets ?? []);
const current = computed(() => planets.value.find((p) => p.key === stored.value) ?? planets.value[0] ?? null);

const now = useClock();
/** the list is calculated every 10 seconds; countdowns tick in `<Ticker>`s */
const slow = computed(() => Math.floor(now.value / 10) * 10);
const list = computed<BuildingInfo[]>(() => {
  const p = current.value;
  const d = data.value;
  if (!p || !d) return [];
  return buildingsOf(p.planet, {
    research: d.research, catchUp: d.catchUp, buildingSpeed: d.buildingSpeed, storageFactor: d.storageFactor,
    arrivals: p.arrivals, now: slow.value, shown: p.shown ?? undefined,
  });
});
/** buildings the viewer hid (for all planets, per browser) and the name filter */
const hidden = useStored<number[]>('buildings.hidden', []);
const showHidden = ref(false);
const search = ref('');
const isHidden = (b: BuildingInfo) => hidden.value.includes(b.id);
function toggleHidden(b: BuildingInfo) {
  hidden.value = isHidden(b) ? hidden.value.filter((id) => id !== b.id) : [...hidden.value, b.id];
}
const inGroup = computed(() => list.value.filter((b) => filter.value === 'all' || b.group === filter.value));
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
const planetLabel = (p: Planet) => `${p.type === 'moon' ? '☾ ' : ''}${p.name ? p.name + ' ' : ''}[${p.coords.g}:${p.coords.s}:${p.coords.p}]`;

// ---------------------------------------------------------------- alerts
const alertOf = (b: BuildingInfo) => {
  const p = current.value!;
  return data.value?.alerts.find((a) => a.element_id === b.id && a.planet_type === p.type && a.g === p.coords.g && a.s === p.coords.s && a.p === p.coords.p) ?? null;
};
/** an alert makes sense while the next level waits for resources */
const alertable = (b: BuildingInfo) => b.state === 'resources' || b.state === 'never' || b.state === 'storage';
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

const FILTERS: (BuildingGroup | 'all')[] = ['prod', 'storage', 'other', 'all'];
const costClass = (b: BuildingInfo, res: number) => (b.missing[res] ? 'neg' : 'pos');
</script>

<template>
  <h1>
    {{ t('buildings.title') }}
    <Hint>
      <p>{{ t('buildings.hint1') }}</p>
      <p>{{ t('buildings.hint2') }}</p>
      <p>{{ t('buildings.hint3') }}</p>
    </Hint>
  </h1>

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
          {{ current.source === 'buildings' ? t('buildings.fromPage') : t('buildings.fromEmpire') }}: {{ dateTime(current.planet.time) }} ({{ ago(current.planet.time) }})
        </span>
        <span class="muted">
          {{ t('imperium.fleets') }}: <template v-if="data.fleetsTime">{{ dateTime(data.fleetsTime) }} ({{ ago(data.fleetsTime) }})</template><span v-else class="warn">{{ t('imperium.fleetsMissing') }}</span>
        </span>
        <span v-if="data.catchUp" class="muted">{{ t('buildings.catchUp', { n: fmt(data.catchUp, 2) }) }}</span>
        <span v-if="!data.buildingSpeed" class="faint" :title="t('buildings.speedUnknownTitle')">{{ t('buildings.speedUnknown') }}</span>
        <span v-if="current.planet.fields" class="muted">{{ t('buildings.fields', { used: current.planet.fields.used, max: current.planet.fields.max }) }}</span>
      </div>
      <p v-if="missingPerHour" class="warn small" style="margin: 8px 0 0">{{ t('imperium.perHourMissing') }}</p>

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
            {{ clock(a.at) }} · {{ a.missionName || t(`game.missions.${a.mission}`) }}{{ a.back ? ' ↩' : '' }}:
            <template v-for="id in RESOURCES" :key="id"><span v-if="a.resources[id]"> +{{ short(a.resources[id]) }} {{ name(id) }}</span></template>
          </span>
        </div>
      </Ticker>
    </div>

    <div class="row bld-filters">
      <div class="tabs">
        <button v-for="f in FILTERS" :key="f" :class="{ active: filter === f }" @click="filter = f">{{ t(`buildings.filter.${f}`) }}</button>
      </div>
      <input v-model="search" type="search" :placeholder="t('buildings.search')" class="bld-search" />
      <label v-if="hiddenCount || showHidden" class="small">
        <input v-model="showHidden" type="checkbox" /> {{ t('buildings.showHidden', { n: hiddenCount }) }}
      </label>
    </div>
    <p v-if="!shownList.length" class="card muted">{{ t('buildings.noMatch') }}</p>

    <!-- desktop: one table row per building -->
    <div v-if="!mobile" class="card scroll-x">
      <table class="data">
        <thead>
          <tr>
            <th>{{ t('buildings.building') }}</th>
            <th class="num">{{ t('buildings.level') }}</th>
            <th v-for="id in RESOURCES" :key="id" class="num">{{ name(id) }}</th>
            <th>{{ t('buildings.status') }}</th>
            <th class="num">{{ t('buildings.buildTime') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in shownList" :key="b.id" :class="{ faded: b.state === 'requirements' || b.state === 'max', 'bld-hidden': isHidden(b) }">
            <td style="white-space: normal">
              {{ name(b.id) }}
              <div v-if="b.state === 'requirements'" class="small bld-reqs">
                <span v-for="r in b.requirements" :key="r.id" :class="r.own < r.need ? 'warn' : 'pos'" class="bld-req">
                  {{ name(r.id) }} {{ r.own }}/{{ r.need }}
                </span>
              </div>
            </td>
            <td class="num">{{ b.level }} <span class="faint">→ {{ b.next }}</span></td>
            <td v-for="id in RESOURCES" :key="id" class="num">
              <template v-if="b.cost[id]">
                <span :class="costClass(b, id)">{{ fmt(Math.floor(b.cost[id])) }}</span>
                <div v-if="b.missing[id]" class="small neg">−{{ fmt(Math.floor(b.missing[id])) }}</div>
              </template>
              <span v-else class="faint">–</span>
            </td>
            <td>
              <Ticker v-if="b.state === 'resources'" v-slot="{ now: n }">
                <span v-if="b.readyAt! > n" class="mono">{{ countdown(b.readyAt! - n) }}</span>
                <span v-else class="pos">{{ t('buildings.state.buildable') }}</span>
                <div class="small faint">{{ clock(b.readyAt!) }}</div>
              </Ticker>
              <span v-else :class="b.state === 'buildable' ? 'pos' : 'warn'">{{ t(`buildings.state.${b.state}`) }}</span>
            </td>
            <td class="num mono">{{ b.time != null ? countdown(b.time) : '–' }}</td>
            <td>
              <button
                v-if="alertable(b) || alertOf(b)"
                class="small bld-bell"
                :class="{ active: alertOf(b) }"
                :disabled="busy === b.id"
                :title="alertOf(b) ? t('buildings.alertOff') : t('buildings.alertOn', { level: b.next })"
                @click="toggleAlert(b)"
              >{{ alertOf(b) ? '🔔' : '🔕' }}</button>
              <button class="small bld-bell" :title="isHidden(b) ? t('buildings.unhide') : t('buildings.hide')" @click="toggleHidden(b)">
                {{ isHidden(b) ? '👁' : '✕' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- mobile: one card per building -->
    <template v-else>
      <div v-for="b in shownList" :key="b.id" class="card bld-card" :class="{ faded: b.state === 'requirements' || b.state === 'max', 'bld-hidden': isHidden(b) }">
        <div class="row">
          <b>{{ name(b.id) }}</b>
          <span class="muted small">{{ b.level }} → {{ b.next }}</span>
          <span class="grow" />
          <button
            v-if="alertable(b) || alertOf(b)"
            class="small bld-bell"
            :class="{ active: alertOf(b) }"
            :disabled="busy === b.id"
            :title="alertOf(b) ? t('buildings.alertOff') : t('buildings.alertOn', { level: b.next })"
            @click="toggleAlert(b)"
          >{{ alertOf(b) ? '🔔' : '🔕' }}</button>
          <button class="small bld-bell" :title="isHidden(b) ? t('buildings.unhide') : t('buildings.hide')" @click="toggleHidden(b)">
            {{ isHidden(b) ? '👁' : '✕' }}
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
          <Ticker v-if="b.state === 'resources'" v-slot="{ now: n }">
            <span v-if="b.readyAt! > n">{{ t('buildings.readyIn') }} <span class="mono">{{ countdown(b.readyAt! - n) }}</span> <span class="faint">({{ clock(b.readyAt!) }})</span></span>
            <span v-else class="pos">{{ t('buildings.state.buildable') }}</span>
          </Ticker>
          <span v-else :class="b.state === 'buildable' ? 'pos' : 'warn'">{{ t(`buildings.state.${b.state}`) }}</span>
          <span class="grow" />
          <span v-if="b.time != null" class="muted">⏱ <span class="mono">{{ countdown(b.time) }}</span></span>
        </div>
      </div>
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
.bld-bell { padding: 2px 6px; }
.bld-filters { margin-bottom: 12px; }
.bld-filters .tabs { margin-bottom: 0; }
.bld-search { width: 180px; }
.bld-hidden { opacity: 0.45; }
.bld-bell + .bld-bell { margin-left: 4px; }
.bld-bell.active { border-color: var(--accent); background: var(--accent-soft); }
.faded { opacity: 0.6; }
.bld-card { margin-bottom: 8px; padding: 10px 12px; }
</style>
