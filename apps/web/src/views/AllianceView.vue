<script setup lang="ts">
import { classOf, elementPoints } from '@pr0hub/core/tech';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { uniApi } from '../api';
import { past, upcoming, useClock } from '../clock';
import FleetList, { FLEET_HISTORY, type Fleet } from '../components/FleetList.vue';
import Hint from '../components/Hint.vue';
import { useMobile, useSort, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { abbr, ago, dateTime, fmt, name, scaleColor } from '../format';

/** Alliance pages from the members' empire pages: planets (buildings), fleets and research, like FF-Hub. */
type Page = 'planets' | 'fleet' | 'research';

interface Member {
  key: string;
  /** null for players of the in-game alliance who are not in the hub */
  user_id: number | null;
  username: string;
  ingame_name: string | null;
  /** empire page of the member or put together from spy reports (planets and research then have their own report time) */
  source: 'empire' | 'spy' | null;
  created_at: number | null;
  data: {
    research: Record<string, number>;
    researchTime?: number | null;
    planets: { name: string; coords: { g: number; s: number; p: number }; type: 'planet' | 'moon'; values: Record<string, number>; time?: number }[];
  } | null;
  /** fleet movements of the member's latest synced overview */
  fleets: { time: number; data: Fleet[] } | null;
  /** fleets of the member's older lists that arrived in the last 12 hours, as far as they share them */
  fleetHistory?: Fleet[];
}
interface Row {
  key: string;
  member: Member;
  label: string;
  coords?: { g: number; s: number; p: number };
  type?: 'planet' | 'moon';
  values: Record<number, number>;
  points: number;
  /** report time when the row comes from spy reports */
  spy?: number | null;
}

const { t } = useI18n();
const route = useRoute();
const page = computed(() => route.meta.page as Page);
const { uni } = useUni();
const mobile = useMobile();
const members = ref<Member[]>([]);
const error = ref('');
const fleetTab = ref<'movements' | 'ships' | 'defense'>('movements');
/** fleet page, tab with the fleet movements instead of the empire tables */
const movements = computed(() => page.value === 'fleet' && fleetTab.value === 'movements');

async function load() {
  try {
    members.value = await uniApi(uni.value, '/alliance');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const now = useClock();
onMounted(load);
useLiveReload(load, tables('empire', 'fleets', 'spy_reports', 'group_members'));

const withData = computed(() => members.value.filter((m) => m.data));
const missing = computed(() => members.value.filter((m) => !m.data));
const memberName = (m: Member) => m.ingame_name || m.username;

/** Fleets of all members (or the chosen one) still in flight, next arrival first. */
const fleetMember = ref<number | null>(null);
const allFlights = computed(() =>
  members.value
    .filter((m) => fleetMember.value == null || m.user_id === fleetMember.value)
    .flatMap((m) => (m.fleets?.data ?? []).map((f) => ({ ...f, member: memberName(m) })))
    .sort((a, b) => a.arrival - b.arrival),
);
const flights = upcoming(allFlights, (f) => f.arrival, now);
/** past fleet movements of the last 12 hours, newest first: the older lists plus the arrived fleets of the newest */
const history = past(
  computed(() =>
    members.value
      .filter((m) => fleetMember.value == null || m.user_id === fleetMember.value)
      .flatMap((m) => [...(m.fleetHistory ?? []), ...(m.fleets?.data ?? [])].map((f) => ({ ...f, member: memberName(m) }))),
  ),
  (f) => f.arrival,
  now,
  FLEET_HISTORY,
);
const withFleets = computed(() => members.value.filter((m) => m.fleets));

const inCategory = (id: number) => {
  const cls = classOf(id);
  if (page.value === 'planets') return cls === 0;
  if (page.value === 'research') return cls === 100;
  return fleetTab.value === 'ships' ? cls === 200 : cls === 400;
};
const points = (values: Record<number, number>) =>
  Object.entries(values).reduce((s, [id, n]) => s + (inCategory(Number(id)) ? elementPoints(id, n) : 0), 0);

const rows = computed<Row[]>(() => {
  if (page.value === 'planets') {
    return withData.value.flatMap((m) =>
      m.data!.planets.map((p) => ({
        key: `${m.key}:${p.coords.g}:${p.coords.s}:${p.coords.p}:${p.type}`,
        member: m,
        label: p.name,
        coords: p.coords,
        type: p.type,
        values: p.values,
        points: points(p.values),
        spy: m.source === 'spy' ? p.time : null,
      })),
    );
  }
  if (page.value === 'research') {
    return withData.value
      .filter((m) => m.source !== 'spy' || m.data!.researchTime)
      .map((m) => ({
        key: m.key, member: m, label: memberName(m), values: m.data!.research, points: points(m.data!.research),
        spy: m.source === 'spy' ? m.data!.researchTime : null,
      }));
  }
  // fleet/defense: summed over all planets and moons of a member
  return withData.value.map((m) => {
    const values: Record<number, number> = {};
    for (const p of m.data!.planets) for (const [id, n] of Object.entries(p.values)) values[Number(id)] = (values[Number(id)] ?? 0) + n;
    return { key: m.key, member: m, label: memberName(m), values, points: points(values), spy: m.source === 'spy' ? m.created_at : null };
  });
});

/** Element columns of the active page that occur in any row. */
const ids = computed(() => {
  const set = new Set<number>();
  for (const r of rows.value) {
    for (const [id, n] of Object.entries(r.values)) if (inCategory(Number(id)) && (page.value !== 'fleet' || n > 0)) set.add(Number(id));
  }
  return [...set].sort((a, b) => a - b);
});

const { sorted, sortBy, indicator, key: sortKey, descending } = useSort(
  rows,
  (r, key) => {
    if (key === 'name') return r.label.toLowerCase();
    if (key === 'member') return memberName(r.member).toLowerCase();
    if (key === 'coords') return r.coords ? -(r.coords.g * 1e6 + r.coords.s * 100 + r.coords.p + (r.type === 'moon' ? 0.5 : 0)) : null;
    if (key === 'points') return r.points;
    return r.values[Number(key)] ?? null;
  },
  page.value === 'planets' ? 'coords' : 'points',
);

const max = computed(() => {
  const m: Record<string, number> = { points: 0 };
  for (const r of rows.value) {
    m.points = Math.max(m.points, r.points);
    for (const id of ids.value) m[id] = Math.max(m[id] ?? 0, r.values[id] ?? 0);
  }
  return m;
});

/** Sort options of the mobile cards (no clickable column headers there). */
const sortOptions = computed(() => [
  ...(page.value === 'planets'
    ? [
        { key: 'coords', label: t('common.coords') },
        { key: 'name', label: t('common.planet') },
        { key: 'member', label: t('common.player') },
      ]
    : [{ key: 'name', label: t('common.player') }]),
  { key: 'points', label: t('expeditions.points') },
  ...ids.value.map((id) => ({ key: String(id), label: name(id) })),
]);

/** Sum row for fleets (the alliance's total fleet). */
const total = computed(() => {
  if (page.value !== 'fleet' || rows.value.length < 2) return null;
  const values: Record<number, number> = {};
  for (const r of rows.value) for (const id of ids.value) values[id] = (values[id] ?? 0) + (r.values[id] ?? 0);
  return { values, points: rows.value.reduce((s, r) => s + r.points, 0) };
});

</script>

<template>
  <h1>
    {{ t(`nav.${page}`) }}
    <Hint>
      <p>{{ t('alliance.hint') }}</p>
      <p>{{ t(`alliance.hint_${page}`) }}</p>
      <p>{{ t('alliance.hintColumns') }}</p>
    </Hint>
  </h1>

  <div class="card row small">
    <div v-if="page === 'fleet'" class="tabs" style="margin: 0">
      <button :class="{ active: fleetTab === 'movements' }" @click="fleetTab = 'movements'">{{ t('imperium.fleets') }}</button>
      <button :class="{ active: fleetTab === 'ships' }" @click="fleetTab = 'ships'">{{ name(200) }}</button>
      <button :class="{ active: fleetTab === 'defense' }" @click="fleetTab = 'defense'">{{ t('game.sections.400') }}</button>
    </div>
    <!-- movements: when each member last synced their fleets, else their empire page -->
    <template v-if="movements">
      <select v-if="withFleets.length > 1" v-model="fleetMember">
        <option :value="null">{{ t('imperium.allMembers') }}</option>
        <option v-for="m in withFleets" :key="m.key" :value="m.user_id">{{ memberName(m) }}</option>
      </select>
      <span v-for="m in withFleets" :key="m.key" class="muted" :title="dateTime(m.fleets!.time)">{{ memberName(m) }}: {{ ago(m.fleets!.time) }}</span>
      <Hint><p>{{ t('alliance.fleetsHint') }}</p></Hint>
    </template>
    <template v-else>
      <span v-for="m in withData" :key="m.key" class="muted" :title="dateTime(m.created_at)">
        {{ memberName(m) }}: {{ ago(m.created_at) }}<template v-if="m.source === 'spy'"> ({{ t('alliance.spy') }})</template>
      </span>
      <span v-if="missing.length" class="warn">{{ t('alliance.missing', { names: missing.map(memberName).join(', ') }) }}</span>
    </template>
  </div>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="movements" class="card">
    <p v-if="!withFleets.length" class="muted small" style="margin: 0">{{ t('alliance.fleetsEmpty') }}</p>
    <p v-else-if="!flights.length" class="muted small" style="margin: 0">{{ t('imperium.fleetsNone') }}</p>
    <FleetList v-else :fleets="flights" />
    <details v-if="history.length" class="fl-history">
      <summary class="muted small">{{ t('imperium.fleetHistory', { n: history.length }) }}</summary>
      <FleetList :fleets="history" past />
    </details>
  </div>
  <div v-else-if="!withData.length" class="card muted">{{ t('alliance.empty') }}</div>

  <!-- mobile: one card per planet/member with the levels as a grid -->
  <template v-else-if="mobile">
    <div class="row small" style="margin-bottom: 8px">
      <label>
        {{ t('overview.sort') }}
        <select :value="sortKey" style="max-width: 55vw" @change="sortBy(($event.target as HTMLSelectElement).value)">
          <option v-for="o in sortOptions" :key="o.key" :value="o.key">{{ o.label }}</option>
        </select>
      </label>
      <button :title="t('overview.sortDir')" @click="descending = !descending">{{ descending ? '▾' : '▴' }}</button>
    </div>
    <div v-for="r in [...sorted, ...(total ? [{ key: 'total', label: t('common.total'), ...total }] : [])]" :key="r.key" class="card al-card" :class="{ moon: 'type' in r && r.type === 'moon' }">
      <div class="al-head">
        <template v-if="'coords' in r && r.coords">
          <span class="mono small">{{ r.coords.g }}:{{ r.coords.s }}:{{ r.coords.p }}</span>
          <span v-if="r.type === 'moon'" class="moon-tag" style="margin: 0">☾ {{ t('common.moon') }}</span>
        </template>
        <b class="al-name">{{ r.label }}</b>
        <span v-if="'spy' in r && r.spy" class="spy-tag" :title="t('alliance.spyTitle', { time: dateTime(r.spy) })">{{ t('alliance.spy') }}</span>
        <span v-if="page === 'planets' && 'member' in r" class="muted small">{{ memberName(r.member) }}</span>
        <span class="mono small" :class="{ sorted: sortKey === 'points' }" :style="{ color: r.key === 'total' ? undefined : scaleColor(r.points, max.points) }">{{ fmt(r.points) }}</span>
      </div>
      <!-- fleets have large counts: two wide columns with full names -->
      <div class="al-grid small" :class="{ wide: page === 'fleet' }">
        <div v-for="id in ids.filter((id) => r.values[id])" :key="id" :title="name(id)" :class="{ sorted: sortKey === String(id) }">
          <span class="faint">{{ page === 'fleet' ? name(id) : abbr(id) }}</span>
          <span class="mono" :style="{ color: r.key === 'total' ? undefined : scaleColor(r.values[id], max[id]) }">{{ fmt(r.values[id]) }}</span>
        </div>
      </div>
    </div>
  </template>

  <div v-else class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          <template v-if="page === 'planets'">
            <th class="sortable" @click="sortBy('coords')">{{ t('common.coords') }}{{ indicator('coords') }}</th>
            <th class="sortable" @click="sortBy('name')">{{ t('common.planet') }}{{ indicator('name') }}</th>
            <th class="sortable" @click="sortBy('member')">{{ t('common.player') }}{{ indicator('member') }}</th>
          </template>
          <th v-else class="sortable" @click="sortBy('name')">{{ t('common.player') }}{{ indicator('name') }}</th>
          <th class="sortable num" @click="sortBy('points')">{{ t('expeditions.points') }}{{ indicator('points') }}</th>
          <th v-for="id in ids" :key="id" class="sortable num" :title="name(id)" @click="sortBy(String(id))">{{ abbr(id) }}{{ indicator(String(id)) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in sorted" :key="r.key" :class="{ moon: r.type === 'moon' }">
          <template v-if="page === 'planets'">
            <td class="mono small">{{ r.coords!.g }}:{{ r.coords!.s }}:{{ r.coords!.p }}</td>
            <td>
              <span v-if="r.type === 'moon'" class="moon-tag" :title="t('common.moon')">☾ {{ t('common.moon') }}</span>
              {{ r.label }}
              <span v-if="r.spy" class="spy-tag" :title="t('alliance.spyTitle', { time: dateTime(r.spy) })">{{ t('alliance.spy') }}</span>
            </td>
            <td class="muted">{{ memberName(r.member) }}</td>
          </template>
          <td v-else>
            {{ r.label }}
            <span v-if="r.spy" class="spy-tag" :title="t('alliance.spyTitle', { time: dateTime(r.spy) })">{{ t('alliance.spy') }}</span>
          </td>
          <td class="num" :style="{ color: scaleColor(r.points, max.points) }">{{ fmt(r.points) }}</td>
          <td v-for="id in ids" :key="id" class="num" :style="{ color: scaleColor(r.values[id], max[id]) }">{{ r.values[id] ? fmt(r.values[id]) : '' }}</td>
        </tr>
        <tr v-if="total" style="font-weight: 600">
          <td>{{ t('common.total') }}</td>
          <td class="num">{{ fmt(total.points) }}</td>
          <td v-for="id in ids" :key="id" class="num">{{ total.values[id] ? fmt(total.values[id]) : '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.al-card { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; margin-bottom: 8px; }
.al-card.moon { border-left: 3px solid var(--info); background: color-mix(in srgb, var(--info) 7%, var(--surface)); }
.al-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.al-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 4px 10px; }
.al-grid.wide { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 14px; }
.al-grid > div { display: flex; justify-content: space-between; gap: 4px; min-width: 0; }
.al-grid .faint { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sorted { font-weight: 700; }
.spy-tag { display: inline-block; padding: 0 5px; margin-left: 4px; border-radius: 4px; font-size: 11px; font-weight: 600; color: var(--warn); background: color-mix(in srgb, var(--warn) 15%, transparent); }
.sorted .faint { color: var(--accent); }
</style>
