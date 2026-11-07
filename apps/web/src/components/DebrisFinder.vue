<script setup lang="ts">
import Loading from './Loading.vue';
import FilterBar, { type FilterChip } from './FilterBar.vue';
import SortBar from './SortBar.vue';
import SortMark from './SortMark.vue';
import PlayerLink from './PlayerLink.vue';
import PlanetActions from './PlanetActions.vue';
import { distance, drivesFromResearch, flightDuration, shipSpeed } from '@pr0hub/flight';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { claimOf, remaining } from '../claims';
import { useLoader, useMobile, useProgressive, useSort, useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { ago, coords, dateTime, duration, fmt, name, short } from '../format';
import { units } from '../units';

/** Debris finder (backlog B-4), a tab of the farm finder: open debris fields to recycle, with recyclers needed and the nearest member with recyclers (server: repo/debris.ts). */
interface Field {
  g: number;
  s: number;
  p: number;
  metal: number;
  crystal: number;
  time: number;
  base: { source: 'galaxy' | 'recycle'; time: number; metal: number; crystal: number; by: string | null } | null;
  battles: { time: number; metal: number; crystal: number }[];
  owner: { id: number; name: string; ally_tag: string | null; member: boolean } | null;
}
interface Stock { userId: number; member: string; g: number; s: number; p: number; type: 'planet' | 'moon'; recyclers: number; speed: number; time: number }
interface DebrisResponse { fields: Field[]; recyclers: Stock[]; capacity: number | null; days: number; now: number }
interface Row extends Field {
  key: string;
  total: number;
  needed: number | null;
  /** own flight there (one way, seconds) from the nearest own planet or moon */
  own: { from: [number, number, number]; label: string; flight: number } | null;
  /** nearest member (by flight time) with recyclers */
  nearest: { stock: Stock; flight: number; enough: boolean } | null;
}

const { t } = useI18n();
const { ctx, uni } = useUni();
const mobile = useMobile();

const DAYS = [1, 3, 7, 14, 30];
const SPEEDS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
const FILTER_DEFAULTS = {
  days: 7,
  speed: 100,
  minDebris: null as number | null,
  galaxy: null as number | null,
  hideClaimed: true,
  hideMembers: false,
};
const filter = useStored('debris.filter', { ...FILTER_DEFAULTS });
filter.value = { ...FILTER_DEFAULTS, ...filter.value };

const { data, error, load } = useLoader(() => uniApi<DebrisResponse>(uni.value, `/debris?days=${filter.value.days}`));
onMounted(load);
watch(() => filter.value.days, () => load());
useLiveReload(load, tables('galaxy_systems', 'battle_reports', 'combat_reports', 'recycle_reports', 'empire'));

const settings = computed(() => ctx.value!.universe.settings);
const capacity = computed(() => data.value?.capacity ?? units.value.capacity[209] ?? 0);
const ownSpeed = computed(() => shipSpeed(209, drivesFromResearch(ctx.value?.own?.research ?? {}), units.value.drives));
const flight = (from: [number, number, number], to: [number, number, number], speed: number) =>
  speed > 0 ? flightDuration(settings.value, distance(settings.value, from, to), speed, filter.value.speed) : null;

const rows = computed<Row[]>(() =>
  (data.value?.fields ?? []).map((f) => {
    const total = f.metal + f.crystal;
    const target: [number, number, number] = [f.g, f.s, f.p];
    const needed = capacity.value > 0 ? Math.ceil(total / capacity.value) : null;
    let own: Row['own'] = null;
    for (const pl of ctx.value?.own?.planets ?? []) {
      const c: [number, number, number] = [pl.coords.g, pl.coords.s, pl.coords.p];
      const d = flight(c, target, ownSpeed.value);
      if (d != null && (!own || d < own.flight)) own = { from: c, label: `${pl.name} ${coords(...c)}`, flight: d };
    }
    // nearest member with enough recyclers, else the nearest with any
    let nearest: Row['nearest'] = null;
    for (const st of data.value?.recyclers ?? []) {
      const d = flight([st.g, st.s, st.p], target, st.speed);
      if (d == null) continue;
      const enough = needed == null || st.recyclers >= needed;
      if (!nearest || (enough && !nearest.enough) || (enough === nearest.enough && d < nearest.flight)) nearest = { stock: st, flight: d, enough };
    }
    return { ...f, key: `${f.g}:${f.s}:${f.p}`, total, needed, own, nearest };
  }),
);

const galaxies = computed(() => settings.value.galaxies ?? 1);
const filtered = computed(() => {
  const f = filter.value;
  return rows.value.filter((r) => {
    if (f.galaxy && r.g !== f.galaxy) return false;
    if (f.minDebris && r.total < f.minDebris) return false;
    if (f.hideMembers && r.owner?.member) return false;
    if (f.hideClaimed) {
      const c = claimOf(r.g, r.s, r.p, 'debris');
      if (c && c.user_id !== ctx.value?.me.id) return false;
    }
    return true;
  });
});

const sortValue = (r: Row, key: string): unknown => {
  switch (key) {
    case 'total': return r.total;
    case 'perHour': return r.own ? r.total / ((2 * r.own.flight) / 3600) : null;
    case 'age': return -r.time;
    case 'flight': return r.own ? -r.own.flight : null;
    case 'nearest': return r.nearest ? -r.nearest.flight : null;
    case 'coords': return -(r.g * 1e6 + r.s * 100 + r.p);
  }
  return null;
};
const sort = useSort(filtered, sortValue, 'total');
const sortOptions = computed(() => [
  { key: 'total', label: t('debris.total') },
  { key: 'perHour', label: t('debris.perHour') },
  { key: 'age', label: t('debris.seen') },
  { key: 'flight', label: t('debris.flight') },
  { key: 'nearest', label: t('debris.nearest') },
]);
const { shown, more, sentinel } = useProgressive(sort.sorted, 60);

const chips = computed<FilterChip[]>(() => {
  const f = filter.value;
  const out: FilterChip[] = [];
  const add = (key: keyof typeof FILTER_DEFAULTS, label: string) => out.push({ key, label, clear: () => ((filter.value as Record<string, unknown>)[key] = FILTER_DEFAULTS[key]) });
  if (f.minDebris) add('minDebris', `${t('debris.minDebris')} ${short(f.minDebris)}`);
  if (f.galaxy) add('galaxy', `${t('nav.galaxy')} ${f.galaxy}`);
  if (!f.hideClaimed) add('hideClaimed', t('farm.showClaimed'));
  if (f.hideMembers) add('hideMembers', t('debris.hideMembers'));
  return out;
});
const resetFilters = () => (filter.value = { ...FILTER_DEFAULTS, days: filter.value.days, speed: filter.value.speed });

const totalTitle = (r: Row) =>
  [
    `${name(901)}: ${fmt(r.metal)}`,
    `${name(902)}: ${fmt(r.crystal)}`,
    r.base
      ? r.base.source === 'galaxy'
        ? t('debris.fromGalaxy', { time: dateTime(r.base.time), n: short(r.base.metal + r.base.crystal) })
        : t('debris.fromRecycle', { time: dateTime(r.base.time), n: short(r.base.metal + r.base.crystal), by: r.base.by ?? '?' })
      : '',
    ...r.battles.map((b) => t('debris.battle', { time: dateTime(b.time), n: short(b.metal + b.crystal) })),
  ]
    .filter(Boolean)
    .join('\n');
const nearestTitle = (r: Row) =>
  r.nearest
    ? t('debris.nearestTitle', {
        member: r.nearest.stock.member,
        from: `${coords(r.nearest.stock.g, r.nearest.stock.s, r.nearest.stock.p)}${r.nearest.stock.type === 'moon' ? ` (${t('common.moon')})` : ''}`,
        n: fmt(r.nearest.stock.recyclers),
        time: dateTime(r.nearest.stock.time),
      }) + (r.nearest.enough ? '' : `\n${t('debris.notEnough', { n: fmt(r.needed ?? 0) })}`)
    : t('debris.noRecyclers');
const flightTitle = (r: Row) => (r.own ? t('debris.flightTitle', { from: r.own.label, speed: filter.value.speed }) : t('farm.noStart'));
const claimText = (r: Row) => {
  const c = claimOf(r.g, r.s, r.p, 'debris');
  return c ? t('farm.claimed', { member: c.member, left: remaining(c) }) : '';
};
</script>

<template>
  <FilterBar data-tour="debris-filter" store-key="debris" :chips="chips" @reset="resetFilters">
    <template #toolbar>
      <label class="field-inline">
        {{ t('debris.days') }}
        <select v-model.number="filter.days">
          <option v-for="d in DAYS" :key="d" :value="d">{{ t('farm.daysOption', { n: d }, d) }}</option>
        </select>
      </label>
      <label class="field-inline">
        {{ t('farm.speed') }}
        <select v-model.number="filter.speed">
          <option v-for="s in SPEEDS" :key="s" :value="s">{{ s }} %</option>
        </select>
      </label>
    </template>
    <div class="filter-group">
      <span class="filter-title">{{ t('debris.fields') }}</span>
      <label class="check"><input v-model="filter.hideClaimed" type="checkbox" /> {{ t('farm.hideClaimed') }}</label>
      <label class="check"><input v-model="filter.hideMembers" type="checkbox" /> {{ t('debris.hideMembers') }}</label>
      <div class="field">
        <span class="lbl">{{ t('debris.minDebris') }}</span>
        <input v-model.number="filter.minDebris" type="number" min="0" step="10000" />
      </div>
      <div v-if="galaxies > 1" class="field">
        <span class="lbl">{{ t('nav.galaxy') }}</span>
        <select v-model="filter.galaxy">
          <option :value="null">{{ t('common.all') }}</option>
          <option v-for="g in galaxies" :key="g" :value="g">{{ g }}</option>
        </select>
      </div>
    </div>
    <template #status>
      <span class="small muted">{{ t('debris.count', { n: filtered.length, total: rows.length }) }}</span>
    </template>
  </FilterBar>

  <div v-if="error" class="error">{{ error }}</div>
  <Loading v-else-if="!data" :lines="6" />
  <div v-else-if="!rows.length" class="card muted">
    {{ t('debris.empty', { days: data.days }) }}
    <RouterLink :to="`/${uni}/paste`">{{ t('nav.sync') }}</RouterLink>
  </div>
  <template v-else>
    <template v-if="mobile">
      <SortBar :sort-key="sort.key.value" :options="sortOptions" v-model:desc="sort.descending.value" @sort="sort.sortBy" />
      <div class="debris-cards">
        <div v-for="r in shown" :key="r.key" class="card debris-card">
          <div class="debris-card-head">
            <span class="mono">{{ coords(r.g, r.s, r.p) }}</span>
            <PlayerLink v-if="r.owner" :id="r.owner.id" :name="r.owner.name" />
            <span v-if="r.owner?.member" class="badge">{{ t('debris.member') }}</span>
            <span class="grow" />
            <PlanetActions :g="r.g" :s="r.s" :p="r.p" type="debris" :from="r.own?.from ?? null" />
          </div>
          <div class="debris-card-grid small">
            <span class="muted">{{ t('debris.total') }}</span><span :title="totalTitle(r)"><b>{{ short(r.total) }}</b></span>
            <span class="muted">{{ t('debris.recyclers') }}</span><span>{{ r.needed == null ? '–' : fmt(r.needed) }}</span>
            <span class="muted">{{ t('debris.seen') }}</span><span :title="dateTime(r.time)">{{ ago(r.time) }}</span>
            <span class="muted">{{ t('debris.flight') }}</span><span :title="flightTitle(r)">{{ r.own ? duration(Math.floor(r.own.flight)) : '–' }}</span>
            <span class="muted">{{ t('debris.nearest') }}</span>
            <span :title="nearestTitle(r)" :class="{ warn: r.nearest && !r.nearest.enough }">{{ r.nearest ? `${r.nearest.stock.member} · ${duration(Math.floor(r.nearest.flight))}` : '–' }}</span>
          </div>
          <div v-if="claimText(r)" class="small warn">{{ claimText(r) }}</div>
        </div>
        <div v-if="more" ref="sentinel" />
      </div>
    </template>

    <div v-else class="table-wrap" data-tour="debris-list">
      <table class="data">
        <thead>
          <tr>
            <th class="sortable" @click="sort.sortBy('coords')">{{ t('debris.field') }}<SortMark :dir="sort.direction('coords')" /></th>
            <th>{{ t('debris.owner') }}</th>
            <th class="sortable num" data-tour="debris-total" @click="sort.sortBy('total')">{{ t('debris.total') }}<SortMark :dir="sort.direction('total')" /></th>
            <th class="num">{{ t('debris.recyclers') }}</th>
            <th class="sortable num" @click="sort.sortBy('age')">{{ t('debris.seen') }}<SortMark :dir="sort.direction('age')" /></th>
            <th class="sortable num" @click="sort.sortBy('flight')">{{ t('debris.flight') }}<SortMark :dir="sort.direction('flight')" /></th>
            <th class="sortable num" @click="sort.sortBy('perHour')">{{ t('debris.perHour') }}<SortMark :dir="sort.direction('perHour')" /></th>
            <th class="sortable" data-tour="debris-nearest" @click="sort.sortBy('nearest')">{{ t('debris.nearest') }}<SortMark :dir="sort.direction('nearest')" /></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.key">
            <td class="nowrap">
              <span class="mono">{{ coords(r.g, r.s, r.p) }}</span>
              <span v-if="r.battles.length" class="badge" :title="t('debris.battleBadge')">{{ t('debris.newBattle') }}</span>
              <div v-if="claimText(r)" class="small warn">{{ claimText(r) }}</div>
            </td>
            <td class="nowrap">
              <template v-if="r.owner">
                <PlayerLink :id="r.owner.id" :name="r.owner.name" />
                <span v-if="r.owner.ally_tag" class="muted small"> [{{ r.owner.ally_tag }}]</span>
                <span v-if="r.owner.member" class="badge">{{ t('debris.member') }}</span>
              </template>
              <span v-else class="muted">–</span>
            </td>
            <td class="num" :title="totalTitle(r)"><b>{{ short(r.total) }}</b></td>
            <td class="num">{{ r.needed == null ? '–' : fmt(r.needed) }}</td>
            <td class="num" :title="dateTime(r.time)">{{ ago(r.time) }}</td>
            <td class="num" :title="flightTitle(r)">{{ r.own ? duration(Math.floor(r.own.flight)) : '–' }}</td>
            <td class="num">{{ r.own ? short(r.total / ((2 * r.own.flight) / 3600)) : '–' }}</td>
            <td class="nowrap" :title="nearestTitle(r)" :class="{ warn: r.nearest && !r.nearest.enough }">
              <template v-if="r.nearest">{{ r.nearest.stock.member }} <span class="muted small">{{ duration(Math.floor(r.nearest.flight)) }}</span></template>
              <span v-else class="muted">–</span>
            </td>
            <td><PlanetActions :g="r.g" :s="r.s" :p="r.p" type="debris" :from="r.own?.from ?? null" /></td>
          </tr>
        </tbody>
      </table>
      <div v-if="more" ref="sentinel" />
    </div>
  </template>
</template>

<style scoped>
.field-inline { display: inline-flex; align-items: center; gap: 6px; }
.nowrap { white-space: nowrap; }
.badge { margin-left: 4px; }
.debris-cards { display: flex; flex-direction: column; gap: 8px; }
.debris-card { padding: 10px 12px; }
.debris-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px; }
.debris-card-grid { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 3px 10px; }
</style>
