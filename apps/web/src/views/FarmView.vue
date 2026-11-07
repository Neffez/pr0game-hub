<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import Hint from '../components/Hint.vue';
import Icon from '../components/Icon.vue';
import Loading from '../components/Loading.vue';
import FilterBar, { type FilterChip } from '../components/FilterBar.vue';
import SortBar from '../components/SortBar.vue';
import SortMark from '../components/SortMark.vue';
import PlayerLink from '../components/PlayerLink.vue';
import PlanetActions from '../components/PlanetActions.vue';
import StatusBadges from '../components/StatusBadges.vue';
import InactivityBadge, { type Inactivity } from '../components/InactivityBadge.vue';
import { distance, drivesFromResearch, fleetConsumption, flightDuration, shipSpeed } from '@pr0hub/flight';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { claimOf, remaining } from '../claims';
import { useLoader, useMobile, useProgressive, useSort, useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { ago, coords, dateTime, duration, fmt, name, short } from '../format';
import { useAutoTour } from '../tours';
import { units } from '../units';
import { spyPriority, type SpyReason } from '../spyPriority';
import { spyProbes } from '@pr0hub/core/spy';

/** Farm finder (backlog B-1): spied targets ranked by what they are worth now (server: repo/farm.ts). */
interface Section { time: number; points: number | null; units: number }
interface Target {
  g: number;
  s: number;
  p: number;
  type: 'planet' | 'moon';
  name: string | null;
  player: { id: number; name: string; status: string[]; ally_tag: string | null; points: number | null };
  report: { time: number; resources: Record<number, number>; count: number };
  levels: { time: number; values: Record<string, number> } | null;
  projected: Record<number, number>;
  perHour: Record<number, number>;
  full: Record<number, boolean>;
  loot: Record<number, number>;
  fleet: Section | null;
  defense: Section | null;
  lastBattle: number | null;
  inactivity: Inactivity | null;
  changes: Record<1 | 2 | 5, number | null>;
  espionage: number | null;
  moonDiameter?: number | null;
}
interface FarmResponse { targets: Target[]; resourceSpeed: number; speedSource: 'settings' | 'empire' | 'default'; storageFactor: number; days: number; now: number }
interface Row extends Target {
  key: string;
  lootSum: number;
  from: { label: string; c: [number, number, number] } | null;
  dist: number | null;
  /** one way, seconds */
  flight: number | null;
  ships: number | null;
  fuel: number | null;
  /** loot per hour of the round trip */
  perFlightHour: number | null;
  risk: 'none' | 'defense' | 'fleet' | 'both' | 'unknown';
  /** spy priority (B-2): loot now times the need for a new report */
  spy: { score: number; reasons: SpyReason[]; probes: number | null };
}

const { t } = useI18n();
const { ctx, uni } = useUni();
const mobile = useMobile();

const DAYS = [1, 3, 7, 14, 30];
const CARGO_SHIPS = [203, 202];
const SPEEDS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
const FILTER_DEFAULTS = {
  days: 7,
  ship: 203,
  speed: 100,
  /** "" = nearest own planet, else "g:s:p" of an own planet */
  from: '',
  inactiveOnly: false,
  hideDefense: false,
  hideFleet: false,
  hideVacation: true,
  hideClaimed: true,
  minLoot: null as number | null,
  galaxy: null as number | null,
};
const filter = useStored('farm.filter', { ...FILTER_DEFAULTS });
filter.value = { ...FILTER_DEFAULTS, ...filter.value };

/** Targets to raid, or the spy priority list (B-2) on the same data with every report of the last 30 days. */
type Tab = 'targets' | 'spy';
const tab = useStored<Tab>('farm.tab', 'targets');
const SPY_DAYS = 30;
const days = computed(() => (tab.value === 'spy' ? SPY_DAYS : filter.value.days));

const { data, error, load } = useLoader(() => uniApi<FarmResponse>(uni.value, `/farm?days=${days.value}`));
onMounted(load);
watch(days, () => load());
useLiveReload(load, tables('spy_reports', 'player_scores', 'battle_reports', 'galaxy_systems'));
useAutoTour('farm', computed(() => !!data.value));

const settings = computed(() => ctx.value!.universe.settings);
const ownPlanets = computed(() => ctx.value?.own?.planets ?? []);
const drives = computed(() => drivesFromResearch(ctx.value?.own?.research ?? {}));
const capacity = computed(() => units.value.capacity[filter.value.ship] ?? 0);
const ownEspionage = computed(() => (ctx.value?.own?.research as Record<number, number> | undefined)?.[106] ?? null);

/** Start of the flight: the chosen own planet or the nearest one. */
function startFor(target: [number, number, number]) {
  const list = ownPlanets.value.filter((p) => !filter.value.from || `${p.coords.g}:${p.coords.s}:${p.coords.p}` === filter.value.from);
  let best: { label: string; c: [number, number, number]; d: number } | null = null;
  for (const p of list) {
    const c: [number, number, number] = [p.coords.g, p.coords.s, p.coords.p];
    const d = distance(settings.value, c, target);
    if (!best || d < best.d) best = { label: `${p.name} ${coords(...c)}`, c, d };
  }
  return best;
}

const rows = computed<Row[]>(() =>
  (data.value?.targets ?? []).map((x) => {
    const lootSum = x.loot[901] + x.loot[902] + x.loot[903];
    const start = startFor([x.g, x.s, x.p]);
    const speed = shipSpeed(filter.value.ship, drives.value, units.value.drives);
    const flight = start && speed > 0 ? flightDuration(settings.value, start.d, speed, filter.value.speed) : null;
    const ships = capacity.value > 0 ? Math.max(1, Math.ceil(lootSum / capacity.value)) : null;
    const fuel = start && flight != null && ships != null ? fleetConsumption(settings.value, { [filter.value.ship]: ships }, flight, start.d, drives.value, 1, units.value.drives) : null;
    const defended = x.defense ? x.defense.units > 0 : null;
    const fleet = x.fleet ? x.fleet.units > 0 : null;
    const risk: Row['risk'] =
      defended == null || fleet == null ? (defended || fleet ? (defended ? 'defense' : 'fleet') : 'unknown') : defended && fleet ? 'both' : defended ? 'defense' : fleet ? 'fleet' : 'none';
    return {
      ...x,
      key: `${x.g}:${x.s}:${x.p}:${x.type}`,
      lootSum,
      from: start ? { label: start.label, c: start.c } : null,
      dist: start?.d ?? null,
      flight,
      ships,
      fuel,
      perFlightHour: flight ? lootSum / ((2 * flight) / 3600) : null,
      risk,
      spy: {
        ...spyPriority(
          { lootSum, reportTime: x.report.time, levels: !!x.levels, fleetKnown: !!x.fleet, defenseKnown: !!x.defense, changes: x.changes, lastBattle: x.lastBattle },
          data.value!.now,
        ),
        // probes for a report with buildings (needed for the projection), when both espionage levels are known
        probes: ownEspionage.value != null && x.espionage != null ? spyProbes(ownEspionage.value, x.espionage).buildings : null,
      },
    };
  }),
);

const galaxies = computed(() => settings.value.galaxies ?? 1);
const filtered = computed(() => {
  const f = filter.value;
  return rows.value.filter((r) => {
    if (f.galaxy && r.g !== f.galaxy) return false;
    if (f.inactiveOnly && !(r.inactivity && (r.inactivity.level === 'inactive' || r.inactivity.level === 'likely'))) return false;
    if (f.hideDefense && (r.risk === 'defense' || r.risk === 'both')) return false;
    if (f.hideFleet && (r.risk === 'fleet' || r.risk === 'both')) return false;
    if (f.hideVacation && r.player.status.includes('vacation')) return false;
    if (f.hideClaimed) {
      const c = claimOf(r.g, r.s, r.p, r.type);
      if (c && c.user_id !== ctx.value?.me.id) return false;
    }
    if (f.minLoot != null && f.minLoot > 0 && r.lootSum < f.minLoot) return false;
    return true;
  });
});

const sortValue = (r: Row, key: string): unknown => {
  switch (key) {
    case 'perFlightHour': return r.perFlightHour;
    case 'loot': return r.lootSum;
    case 'flight': return r.flight == null ? null : -r.flight;
    case 'age': return -r.report.time;
    case 'inactivity': return r.inactivity?.score ?? null;
    case 'player': return r.player.name.toLowerCase();
    case 'spy': return r.spy.score;
  }
  return null;
};
const sort = useSort(filtered, sortValue, 'perFlightHour');
// each tab starts with its own ranking
watch(
  tab,
  (v) => {
    sort.key.value = v === 'spy' ? 'spy' : 'perFlightHour';
    sort.descending.value = true;
  },
  { immediate: true },
);
const sortOptions = computed(() => [
  ...(tab.value === 'spy' ? [{ key: 'spy', label: t('farm.spy.priority') }] : []),
  { key: 'perFlightHour', label: t('farm.perFlightHour') },
  { key: 'loot', label: t('farm.loot') },
  { key: 'flight', label: t('farm.flight') },
  { key: 'age', label: t('farm.report') },
  { key: 'inactivity', label: t('farm.inactivity') },
]);
const { shown, more, sentinel } = useProgressive(sort.sorted, 60);

const chips = computed<FilterChip[]>(() => {
  const f = filter.value;
  const out: FilterChip[] = [];
  const add = (key: keyof typeof FILTER_DEFAULTS, label: string) => out.push({ key, label, clear: () => ((filter.value as Record<string, unknown>)[key] = FILTER_DEFAULTS[key]) });
  if (f.inactiveOnly) add('inactiveOnly', t('farm.inactiveOnly'));
  if (f.hideDefense) add('hideDefense', t('farm.hideDefense'));
  if (f.hideFleet) add('hideFleet', t('farm.hideFleet'));
  if (!f.hideVacation) add('hideVacation', t('farm.showVacation'));
  if (!f.hideClaimed) add('hideClaimed', t('farm.showClaimed'));
  if (f.minLoot) add('minLoot', `${t('farm.minLoot')} ${short(f.minLoot)}`);
  if (f.galaxy) add('galaxy', `${t('nav.galaxy')} ${f.galaxy}`);
  return out;
});
const resetFilters = () => (filter.value = { ...FILTER_DEFAULTS, days: filter.value.days, ship: filter.value.ship, speed: filter.value.speed, from: filter.value.from });

const resTitle = (r: Row) =>
  [
    t('farm.lootTitle'),
    ...([901, 902, 903] as const).map((id) => `${name(id)}: ${fmt(r.loot[id])} (${t('farm.onPlanet', { n: fmt(r.projected[id]) })}${r.full[id] ? `, ${t('farm.full')}` : ''})`),
    r.levels ? t('farm.perHourTitle', { m: fmt(r.perHour[901]), k: fmt(r.perHour[902]), d: fmt(r.perHour[903]) }) : t('farm.noLevels'),
  ].join('\n');
const reportTitle = (r: Row) =>
  [t('farm.reportTitle', { time: dateTime(r.report.time), n: r.report.count }), r.levels ? t('farm.levelsFrom', { time: dateTime(r.levels.time) }) : ''].filter(Boolean).join('\n');
const riskTitle = (r: Row) =>
  [
    r.defense ? t('farm.defenseTitle', { n: fmt(r.defense.units), points: fmt(r.defense.points ?? 0), time: dateTime(r.defense.time) }) : t('farm.defenseUnknown'),
    r.fleet ? t('farm.fleetTitle', { n: fmt(r.fleet.units), points: fmt(r.fleet.points ?? 0), time: dateTime(r.fleet.time) }) : t('farm.fleetUnknown'),
  ].join('\n');
const flightTitle = (r: Row) =>
  r.from ? t('farm.flightTitle', { from: r.from.label, ship: name(filter.value.ship), speed: filter.value.speed }) : t('farm.noStart');
const spyTitle = (r: Row) =>
  [
    t('farm.spy.needTitle'),
    ...(r.spy.reasons.length ? r.spy.reasons.map((x) => `• ${t(`farm.spy.reason.${x}`, { n: fmt(r.changes[x === 'fleet' ? 2 : x === 'defense' ? 5 : 1] ?? 0) })}`) : [`• ${t('farm.spy.reason.fresh')}`]),
  ].join('\n');
const probesTitle = (r: Row) =>
  ownEspionage.value != null && r.espionage != null
    ? t('farm.spy.probesTitle', { own: ownEspionage.value, target: r.espionage, ...spyProbes(ownEspionage.value, r.espionage) })
    : t('farm.spy.probesUnknown');
const anyFull = (r: Row) => r.full[901] || r.full[902] || r.full[903];
const claimText = (r: Row) => {
  const c = claimOf(r.g, r.s, r.p, r.type);
  return c ? t('farm.claimed', { member: c.member, left: remaining(c) }) : '';
};
</script>

<template>
  <PageHeader :title="t('nav.farm')" tour="farm">
    <template #hint>
      <Hint>
        <p>{{ t('farm.hint1') }}</p>
        <p>{{ t('farm.hint2') }}</p>
        <p>{{ t('farm.hint3') }}</p>
      </Hint>
      <Hint v-if="data && data.speedSource === 'default'" warn>{{ t('farm.speedUnknown') }}</Hint>
      <Hint v-if="tab === 'spy'">{{ t('farm.spy.hint', { days: SPY_DAYS }) }}</Hint>
    </template>
    <div class="seg" data-tour="farm-tabs">
      <button :class="{ active: tab === 'targets' }" @click="tab = 'targets'">{{ t('farm.tabTargets') }}</button>
      <button :class="{ active: tab === 'spy' }" @click="tab = 'spy'">{{ t('farm.tabSpy') }}</button>
    </div>
  </PageHeader>

  <FilterBar data-tour="farm-filter" store-key="farm" :chips="chips" @reset="resetFilters">
    <template #toolbar>
      <label v-if="tab === 'targets'" class="field-inline" data-tour="farm-days">
        {{ t('farm.days') }}
        <select v-model.number="filter.days">
          <option v-for="d in DAYS" :key="d" :value="d">{{ t('farm.daysOption', { n: d }, d) }}</option>
        </select>
      </label>
      <label class="field-inline" data-tour="farm-flight">
        {{ t('farm.ship') }}
        <select v-model.number="filter.ship">
          <option v-for="id in CARGO_SHIPS" :key="id" :value="id">{{ name(id) }}</option>
        </select>
        <select v-model.number="filter.speed" :aria-label="t('farm.speed')">
          <option v-for="s in SPEEDS" :key="s" :value="s">{{ s }} %</option>
        </select>
      </label>
      <label v-if="ownPlanets.length" class="field-inline">
        {{ t('farm.from') }}
        <select v-model="filter.from">
          <option value="">{{ t('farm.nearest') }}</option>
          <option v-for="p in ownPlanets.filter((x) => x.type === 'planet')" :key="`${p.coords.g}:${p.coords.s}:${p.coords.p}`" :value="`${p.coords.g}:${p.coords.s}:${p.coords.p}`">
            {{ p.name }} {{ coords(p.coords.g, p.coords.s, p.coords.p) }}
          </option>
        </select>
      </label>
    </template>
    <div class="filter-group">
      <span class="filter-title">{{ t('farm.targets') }}</span>
      <label class="check"><input v-model="filter.inactiveOnly" type="checkbox" /> {{ t('farm.inactiveOnly') }}</label>
      <label class="check"><input v-model="filter.hideDefense" type="checkbox" /> {{ t('farm.hideDefense') }}</label>
      <label class="check"><input v-model="filter.hideFleet" type="checkbox" /> {{ t('farm.hideFleet') }}</label>
      <label class="check"><input v-model="filter.hideVacation" type="checkbox" /> {{ t('farm.hideVacation') }}</label>
      <label class="check"><input v-model="filter.hideClaimed" type="checkbox" /> {{ t('farm.hideClaimed') }}</label>
    </div>
    <div class="filter-group">
      <span class="filter-title">{{ t('farm.loot') }}</span>
      <div class="field">
        <span class="lbl">{{ t('farm.minLoot') }}</span>
        <input v-model.number="filter.minLoot" type="number" min="0" step="10000" />
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
      <span class="small muted">{{ t('farm.count', { n: filtered.length, total: rows.length }) }}</span>
    </template>
  </FilterBar>

  <div v-if="error" class="error">{{ error }}</div>
  <Loading v-else-if="!data" :lines="6" />
  <div v-else-if="!rows.length" class="card muted">
    {{ t('farm.empty', { days: data.days }) }}
    <RouterLink :to="`/${uni}/paste`">{{ t('nav.sync') }}</RouterLink>
  </div>
  <template v-else>
    <p v-if="!ownPlanets.length" class="warn small">{{ t('farm.noEmpire') }}</p>

    <template v-if="mobile && tab === 'spy'">
      <SortBar :sort-key="sort.key.value" :options="sortOptions" v-model:desc="sort.descending.value" @sort="sort.sortBy" />
      <div class="farm-cards">
        <div v-for="r in shown" :key="r.key" class="card farm-card">
          <div class="farm-card-head">
            <span class="mono">{{ coords(r.g, r.s, r.p) }}<span v-if="r.type === 'moon'"> ({{ t('common.moon') }})</span></span>
            <PlayerLink :id="r.player.id" :name="r.player.name" />
            <StatusBadges :status="r.player.status" :points="r.player.points" />
            <span class="grow" />
            <PlanetActions :g="r.g" :s="r.s" :p="r.p" :type="r.type" :from="r.from?.c ?? null" :diameter="r.moonDiameter ?? null" />
          </div>
          <div class="farm-card-grid small">
            <span class="muted">{{ t('farm.spy.priority') }}</span><span :title="spyTitle(r)"><b>{{ short(r.spy.score) }}</b></span>
            <span class="muted">{{ t('farm.loot') }}</span><span :title="resTitle(r)">{{ short(r.lootSum) }}</span>
            <span class="muted">{{ t('farm.report') }}</span><span :title="reportTitle(r)">{{ ago(r.report.time) }}</span>
            <span class="muted">{{ t('farm.spy.probes') }}</span><span :title="probesTitle(r)">{{ r.spy.probes ?? '?' }}</span>
          </div>
          <div v-if="r.spy.reasons.length" class="spy-reasons small">
            <span v-for="x in r.spy.reasons" :key="x" class="badge" :class="`spy-${x}`">{{ t(`farm.spy.short.${x}`) }}</span>
          </div>
          <div v-if="claimText(r)" class="small warn">{{ claimText(r) }}</div>
        </div>
        <div v-if="more" ref="sentinel" />
      </div>
    </template>

    <div v-else-if="tab === 'spy'" class="table-wrap">
      <table class="data farm-table">
        <thead>
          <tr>
            <th>{{ t('farm.target') }}</th>
            <th class="sortable" @click="sort.sortBy('player')">{{ t('common.player') }}<SortMark :dir="sort.direction('player')" /></th>
            <th class="sortable" @click="sort.sortBy('inactivity')">{{ t('farm.inactivity') }}<SortMark :dir="sort.direction('inactivity')" /></th>
            <th class="sortable num" @click="sort.sortBy('loot')">{{ t('farm.loot') }}<SortMark :dir="sort.direction('loot')" /></th>
            <th class="sortable num" @click="sort.sortBy('age')">{{ t('farm.report') }}<SortMark :dir="sort.direction('age')" /></th>
            <th>{{ t('farm.spy.why') }}</th>
            <th class="num">{{ t('farm.spy.probes') }}</th>
            <th class="sortable num" @click="sort.sortBy('flight')">{{ t('farm.flight') }}<SortMark :dir="sort.direction('flight')" /></th>
            <th class="sortable num" @click="sort.sortBy('spy')">{{ t('farm.spy.priority') }}<SortMark :dir="sort.direction('spy')" /></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.key">
            <td class="nowrap">
              <span class="mono">{{ coords(r.g, r.s, r.p) }}</span>
              <span v-if="r.type === 'moon'" class="badge">{{ t('common.moon') }}</span>
              <div v-if="claimText(r)" class="small warn">{{ claimText(r) }}</div>
            </td>
            <td class="nowrap">
              <PlayerLink :id="r.player.id" :name="r.player.name" />
              <span v-if="r.player.ally_tag" class="muted small"> [{{ r.player.ally_tag }}]</span>
              <StatusBadges :status="r.player.status" :points="r.player.points" />
            </td>
            <td><InactivityBadge :value="r.inactivity" chip /></td>
            <td class="num" :title="resTitle(r)">{{ short(r.lootSum) }}</td>
            <td class="num" :title="reportTitle(r)">{{ ago(r.report.time) }}</td>
            <td :title="spyTitle(r)">
              <span v-for="x in r.spy.reasons" :key="x" class="badge" :class="`spy-${x}`">{{ t(`farm.spy.short.${x}`) }}</span>
            </td>
            <td class="num" :title="probesTitle(r)">{{ r.spy.probes ?? '?' }}</td>
            <td class="num" :title="flightTitle(r)">{{ r.flight == null ? '–' : duration(Math.floor(r.flight)) }}</td>
            <td class="num" :title="spyTitle(r)"><b>{{ short(r.spy.score) }}</b></td>
            <td><PlanetActions :g="r.g" :s="r.s" :p="r.p" :type="r.type" :from="r.from?.c ?? null" :diameter="r.moonDiameter ?? null" /></td>
          </tr>
        </tbody>
      </table>
      <div v-if="more" ref="sentinel" />
    </div>

    <template v-else-if="mobile">
      <SortBar :sort-key="sort.key.value" :options="sortOptions" v-model:desc="sort.descending.value" @sort="sort.sortBy" />
      <div data-tour="farm-list" class="farm-cards">
        <div v-for="r in shown" :key="r.key" class="card farm-card">
          <div class="farm-card-head">
            <span class="mono">{{ coords(r.g, r.s, r.p) }}<span v-if="r.type === 'moon'"> ({{ t('common.moon') }})</span></span>
            <PlayerLink :id="r.player.id" :name="r.player.name" />
            <StatusBadges :status="r.player.status" :points="r.player.points" />
            <InactivityBadge :value="r.inactivity" chip hide-flagged />
            <span class="grow" />
            <PlanetActions :g="r.g" :s="r.s" :p="r.p" :type="r.type" :from="r.from?.c ?? null" :diameter="r.moonDiameter ?? null" />
          </div>
          <div class="farm-card-grid small">
            <span class="muted">{{ t('farm.loot') }}</span><span :title="resTitle(r)"><b>{{ short(r.lootSum) }}</b><Icon v-if="anyFull(r)" name="warning" :size="12" class="warn" /></span>
            <span class="muted">{{ t('farm.perFlightHour') }}</span><span>{{ r.perFlightHour == null ? '–' : short(r.perFlightHour) }}</span>
            <span class="muted">{{ t('farm.flight') }}</span><span :title="flightTitle(r)">{{ r.flight == null ? '–' : duration(Math.floor(r.flight)) }}</span>
            <span class="muted">{{ t('farm.ships') }}</span><span>{{ r.ships == null ? '–' : `${fmt(r.ships)} · ${fmt(r.fuel)} ${name(903)}` }}</span>
            <span class="muted">{{ t('farm.report') }}</span><span :title="reportTitle(r)">{{ ago(r.report.time) }}<span v-if="!r.levels" class="warn"> · {{ t('farm.noLevelsShort') }}</span></span>
            <span class="muted">{{ t('farm.risk') }}</span><span :class="`risk-${r.risk}`" :title="riskTitle(r)">{{ t(`farm.riskLevel.${r.risk}`) }}</span>
          </div>
          <div v-if="claimText(r)" class="small warn">{{ claimText(r) }}</div>
        </div>
        <div v-if="more" ref="sentinel" />
      </div>
    </template>

    <div v-else class="table-wrap" data-tour="farm-list">
      <table class="data farm-table">
        <thead>
          <tr>
            <th>{{ t('farm.target') }}</th>
            <th class="sortable" @click="sort.sortBy('player')">{{ t('common.player') }}<SortMark :dir="sort.direction('player')" /></th>
            <th class="sortable" data-tour="farm-inactivity" @click="sort.sortBy('inactivity')">{{ t('farm.inactivity') }}<SortMark :dir="sort.direction('inactivity')" /></th>
            <th class="sortable num" data-tour="farm-loot" @click="sort.sortBy('loot')">{{ t('farm.loot') }}<SortMark :dir="sort.direction('loot')" /></th>
            <th class="sortable num" @click="sort.sortBy('age')">{{ t('farm.report') }}<SortMark :dir="sort.direction('age')" /></th>
            <th class="sortable num" @click="sort.sortBy('flight')">{{ t('farm.flight') }}<SortMark :dir="sort.direction('flight')" /></th>
            <th class="num">{{ t('farm.ships') }}</th>
            <th class="num">{{ t('farm.fuel') }}</th>
            <th class="sortable num" data-tour="farm-rank" @click="sort.sortBy('perFlightHour')">{{ t('farm.perFlightHour') }}<SortMark :dir="sort.direction('perFlightHour')" /></th>
            <th data-tour="farm-risk">{{ t('farm.risk') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.key">
            <td class="nowrap">
              <span class="mono">{{ coords(r.g, r.s, r.p) }}</span>
              <span v-if="r.type === 'moon'" class="badge">{{ t('common.moon') }}</span>
              <div v-if="claimText(r)" class="small warn">{{ claimText(r) }}</div>
            </td>
            <td class="nowrap">
              <PlayerLink :id="r.player.id" :name="r.player.name" />
              <span v-if="r.player.ally_tag" class="muted small"> [{{ r.player.ally_tag }}]</span>
              <StatusBadges :status="r.player.status" :points="r.player.points" />
            </td>
            <td><InactivityBadge :value="r.inactivity" chip /></td>
            <td class="num" :title="resTitle(r)">
              {{ short(r.lootSum) }}<Icon v-if="anyFull(r)" name="warning" :size="12" class="warn full-mark" />
            </td>
            <td class="num" :title="reportTitle(r)">{{ ago(r.report.time) }}<Icon v-if="!r.levels" name="warning" :size="12" class="muted full-mark" /></td>
            <td class="num" :title="flightTitle(r)">{{ r.flight == null ? '–' : duration(Math.floor(r.flight)) }}</td>
            <td class="num">{{ r.ships == null ? '–' : fmt(r.ships) }}</td>
            <td class="num">{{ r.fuel == null ? '–' : short(r.fuel) }}</td>
            <td class="num"><b>{{ r.perFlightHour == null ? '–' : short(r.perFlightHour) }}</b></td>
            <td :class="`risk-${r.risk}`" :title="riskTitle(r)">{{ t(`farm.riskLevel.${r.risk}`) }}</td>
            <td><PlanetActions :g="r.g" :s="r.s" :p="r.p" :type="r.type" :from="r.from?.c ?? null" :diameter="r.moonDiameter ?? null" /></td>
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
.full-mark { margin-left: 3px; vertical-align: -1px; }
.risk-none { color: var(--pos); }
.risk-defense, .risk-both { color: var(--neg); }
.risk-fleet { color: var(--warn); }
.risk-unknown { color: var(--muted); }
.farm-cards { display: flex; flex-direction: column; gap: 8px; }
.farm-card { padding: 10px 12px; }
.farm-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px; }
.farm-card-grid { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 3px 10px; }
.spy-reasons { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.badge + .badge { margin-left: 3px; }
.spy-reasons .badge + .badge { margin-left: 0; }
.spy-fleet, .spy-defense { color: var(--neg); }
.spy-battle, .spy-points { color: var(--warn); }
</style>
