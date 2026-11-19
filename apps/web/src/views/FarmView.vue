<script setup lang="ts">
import Contributors from '../components/Contributors.vue';
import PageHeader from '../components/PageHeader.vue';
import StaleData from '../components/StaleData.vue';
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
import DebrisFinder from '../components/DebrisFinder.vue';
import { distance, drivesFromResearch, fleetConsumption, flightDuration, shipSpeed } from '@pr0hub/flight';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { readError, uniApi } from '../api';
import type { FarmSimulation, FarmTarget, FarmTargets } from '../apiTypes';
import { claimOf, remaining } from '../claims';
import { useLoader, useMobile, useProgressive, useSort, useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { abbr, ago, coords, dateTime, duration, fmt, name, short } from '../format';
import { useAutoTour } from '../tours';
import { units } from '../units';
import { spyPriority, type SpyReason } from '../spyPriority';
import { beatable, beatableValue, debrisValue, DEFENSE_WEIGHT, recommendedValue, riskTier, shareOf, standingFleet, STANDING_FLEET_HOURS, strengthOf, WEAK_SHARE, type RiskTier, type SimOutcome } from '../farmRank';
import { spyProbes } from '@pr0hub/core/spy';

/** Farm finder (backlog B-1): spied targets ranked by what they are worth now (server: repo/farm.ts). */
interface Row extends FarmTarget {
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
  /** fleet plus weighted defense and its share of the own fleet points (null: own fleet unknown) */
  strength: FarmTarget['strength'] & { points: number; known: boolean; estimated: boolean; share: number | null };
  tier: RiskTier;
  /** a fleet stands on the planet of a player inactive for at least 12 hours */
  standing: boolean;
  sim: SimOutcome | null;
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
  /** most strength as a share of the own fleet points (null: any) */
  maxShare: null as number | null,
};
const SHARES = [0.3, 0.6, 1];
const filter = useStored('farm.filter', { ...FILTER_DEFAULTS });
filter.value = { ...FILTER_DEFAULTS, ...filter.value };

/**
 * Targets to raid, the spy priority list (B-2) on the same data with every report of the last 30 days, or the debris
 * finder (B-4, its own data). The tab from the link (`?tab=debris`), else the last one.
 */
type Tab = 'targets' | 'spy' | 'debris';
const TABS: Tab[] = ['targets', 'spy', 'debris'];
const route = useRoute();
const router = useRouter();
const storedTab = useStored<Tab>('farm.tab', 'targets');
const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : TABS.includes(storedTab.value) ? storedTab.value : 'targets'),
  set: (v) => {
    storedTab.value = v;
    router.replace({ query: { ...route.query, tab: v } });
  },
});
const SPY_DAYS = 30;
const days = computed(() => (tab.value === 'spy' ? SPY_DAYS : filter.value.days));

// the debris tab has its own data: the targets load when one of their tabs is shown
const { data, error, load } = useLoader<FarmTargets | null>((): Promise<FarmTargets | null> =>
  tab.value === 'debris' ? Promise.resolve(data.value) : uniApi<FarmTargets>(uni.value, `/farm?days=${days.value}`),
);
onMounted(load);
watch(days, () => load());
const ownPoints = computed(() => data.value?.own?.points ?? null);

/** Simulations of the own fleet against targets (point 5): by target, for the report they were run with. */
const sims = ref(new Map<string, { reportTime: number; outcome: SimOutcome | null; reason: string | null }>());
const simFleet = ref<FarmSimulation['fleet'] | null>(null);
const simRuns = ref(0);
const simBusy = ref(false);
const simError = ref('');
const SIM_COUNT = 20;
/** The first targets of the list as shown (sorted and filtered) against the own fleet of the newest empire page. */
async function simulateTop() {
  const list = sort.sorted.value.slice(0, SIM_COUNT);
  if (!list.length) return;
  simBusy.value = true;
  simError.value = '';
  try {
    const res = await uniApi<FarmSimulation>(uni.value, '/farm/simulate', {
      body: {
        targets: list.map((r) => ({ g: r.g, s: r.s, p: r.p, type: r.type, resources: { metal: r.projected[901] ?? 0, crystal: r.projected[902] ?? 0, deuterium: r.projected[903] ?? 0 } })),
      },
    });
    const next = new Map(sims.value);
    res.results.forEach((x, i) => next.set(`${x.g}:${x.s}:${x.p}:${x.type}`, { reportTime: list[i].report.time, outcome: x.outcome, reason: x.reason }));
    sims.value = next;
    simFleet.value = res.fleet;
    simRuns.value = res.runs;
  } catch (e) {
    simError.value = readError(e);
  } finally {
    simBusy.value = false;
  }
}
// coming back from the debris tab the data may be the one of the other tab's period (spy: 30 days)
watch(tab, (v) => v !== 'debris' && (!data.value || data.value.days !== days.value) && load());
useLiveReload(load, tables('spy_reports', 'player_scores', 'battle_reports', 'galaxy_systems'));
useAutoTour('farm', computed(() => tab.value === 'debris' || !!data.value), tab);

const settings = computed(() => ctx.value!.universe.settings);
const ownPlanets = computed(() => ctx.value?.own?.planets ?? []);
const drives = computed(() => drivesFromResearch(ctx.value?.own?.research ?? {}));
const capacity = computed(() => units.value.capacity[filter.value.ship] ?? 0);
const ownEspionage = computed(() => (ctx.value?.own?.research as Record<number, number> | undefined)?.[106] ?? null);

const planetKey = (p: { coords: { g: number; s: number; p: number } }) => `${p.coords.g}:${p.coords.s}:${p.coords.p}`;
/**
 * The stored start planet, when it is one of the own planets here: the filter is stored for all universes, and the
 * planet of another universe means "nearest" (and is forgotten once the own planets are known).
 */
const from = computed(() => (filter.value.from && ownPlanets.value.some((p) => planetKey(p) === filter.value.from) ? filter.value.from : ''));
watch(ownPlanets, (list) => list.length && filter.value.from && !from.value && (filter.value.from = ''), { immediate: true });

/** Start of the flight: the chosen own planet or the nearest one. */
function startFor(target: [number, number, number]) {
  const list = ownPlanets.value.filter((p) => !from.value || planetKey(p) === from.value);
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
    const key = `${x.g}:${x.s}:${x.p}:${x.type}`;
    const simmed = sims.value.get(key);
    const sim = simmed && simmed.reportTime === x.report.time ? simmed.outcome : null;
    return {
      ...x,
      key,
      strength: { ...x.strength, ...strengthOf(x.strength), share: shareOf(x.strength, ownPoints.value) },
      tier: riskTier(x.strength, ownPoints.value, sim),
      standing: standingFleet(x.strength, x.inactivity, data.value!.now),
      sim,
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
// the filter is stored for all universes: a galaxy this universe does not have is no filter
watch(galaxies, (n) => filter.value.galaxy != null && filter.value.galaxy > n && (filter.value.galaxy = null), { immediate: true });
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
    // targets of unknown strength stay (spy them first)
    if (f.maxShare != null && r.strength.share != null && r.strength.share > f.maxShare && !beatable(r.tier)) return false;
    return true;
  });
});

const sortValue = (r: Row, key: string): unknown => {
  switch (key) {
    case 'recommended': return recommendedValue(r.inactivity, r.tier, r.perFlightHour);
    case 'beatable': return beatableValue(r.tier, r.perFlightHour);
    // weakest first when descending; unknown strength last
    case 'strength': return r.strength.known || r.strength.points > 0 ? -r.strength.points : null;
    case 'debris': return debrisValue(r.fleetDebris, r.standing);
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
const sort = useSort(filtered, sortValue, 'recommended');
// each tab starts with its own ranking
watch(
  tab,
  (v) => {
    sort.key.value = v === 'spy' ? 'spy' : 'recommended';
    sort.descending.value = true;
  },
  { immediate: true },
);
const sortOptions = computed(() => [
  ...(tab.value === 'spy'
    ? [{ key: 'spy', label: t('farm.spy.priority') }]
    : [
        { key: 'recommended', label: t('farm.sort.recommended') },
        { key: 'beatable', label: t('farm.sort.beatable') },
        { key: 'strength', label: t('farm.sort.strength') },
        { key: 'debris', label: t('farm.sort.debris') },
      ]),
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
  if (f.maxShare != null) add('maxShare', t('farm.maxShareChip', { n: Math.round(f.maxShare * 100) }));
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
const ownTitle = computed(() => {
  const o = data.value?.own;
  if (!o || o.points == null) return t('farm.own.unknown');
  return t(o.from === 'empire' ? 'farm.own.empire' : 'farm.own.stats', { points: fmt(Math.round(o.points)), time: o.time ? dateTime(o.time) : '?' });
});
const sideTitle = (r: Row, side: 'fleet' | 'defense') => {
  const from = r.strength[side === 'fleet' ? 'fleetFrom' : 'defenseFrom'];
  const points = r.strength[side];
  const sec = r[side];
  if (from === 'report' && sec) return t(`farm.${side}Title`, { n: fmt(sec.units), points: fmt(Math.round(points ?? 0)), time: dateTime(sec.time) });
  if (from === 'stats') return t(`farm.${side}Stats`, { points: fmt(Math.round(points ?? 0)) });
  return t(`farm.${side}Unknown`);
};
const pct = (share: number) => `${Math.round(share * 100)} %`;
const simText = (o: SimOutcome) => {
  const lost = o.lost.metal + o.lost.crystal + o.lost.deuterium;
  return t('farm.sim.short', { wins: Math.round(o.wins * 100), lost: short(lost), share: pct(o.lostShare) });
};
const riskTitle = (r: Row) => {
  const simmed = sims.value.get(r.key);
  const lines = [
    sideTitle(r, 'fleet'),
    sideTitle(r, 'defense'),
    ...(r.strength.grown ? [t('farm.grown')] : []),
    r.strength.share != null
      ? t('farm.strengthTitle', { points: fmt(Math.round(r.strength.points)), weight: DEFENSE_WEIGHT, share: pct(r.strength.share), weak: pct(WEAK_SHARE) })
      : t('farm.strengthNoShare', { points: fmt(Math.round(r.strength.points)), weight: DEFENSE_WEIGHT }),
    ownTitle.value,
  ];
  if (r.sim) {
    const lost = r.sim.lost.metal + r.sim.lost.crystal + r.sim.lost.deuterium;
    const loot = r.sim.loot.metal + r.sim.loot.crystal + r.sim.loot.deuterium;
    lines.push(
      t('farm.sim.title', {
        time: simFleet.value ? dateTime(simFleet.value.time) : '?',
        runs: simRuns.value,
        wins: Math.round(r.sim.wins * 100),
        loot: fmt(Math.round(loot)),
        lost: fmt(Math.round(lost)),
        share: pct(r.sim.lostShare),
        debris: fmt(Math.round(r.sim.debris.metal + r.sim.debris.crystal)),
        profit: fmt(r.sim.profit),
      }),
    );
  } else if (simmed?.reason) lines.push(t(`farm.sim.${simmed.reason === 'budget' ? 'budget' : 'noReport'}`));
  return lines.join('\n');
};
const standingTitle = (r: Row) =>
  t('farm.standingTitle', { h: STANDING_FLEET_HOURS, m: fmt(r.fleetDebris?.[901] ?? 0), k: fmt(r.fleetDebris?.[902] ?? 0) });
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
  <PageHeader :title="t('nav.farm')" tour="farm" sync>
    <template #hint>
      <Hint v-if="tab === 'debris'">
        <p>{{ t('debris.hint1') }}</p>
        <p>{{ t('debris.hint2') }}</p>
      </Hint>
      <Hint v-else-if="tab === 'spy'">{{ t('farm.spy.hint', { days: SPY_DAYS }) }}</Hint>
      <Hint v-else>
        <p>{{ t('farm.hint1') }}</p>
        <p>{{ t('farm.hint2') }}</p>
        <p>{{ t('farm.hint3') }}</p>
      </Hint>
      <Hint v-if="tab !== 'debris' && data && data.speedSource === 'default'" warn>{{ t('farm.speedUnknown') }}</Hint>
    </template>
    <div class="seg">
      <button data-tour="farm-tab-targets" :class="{ active: tab === 'targets' }" @click="tab = 'targets'">{{ t('farm.tabTargets') }}</button>
      <button data-tour="farm-tab-spy" :class="{ active: tab === 'spy' }" @click="tab = 'spy'">{{ t('farm.tabSpy') }}</button>
      <button data-tour="farm-tab-debris" :class="{ active: tab === 'debris' }" @click="tab = 'debris'">{{ t('farm.tabDebris') }}</button>
    </div>
  </PageHeader>
  <StaleData v-if="tab !== 'debris'" :checks="[{ key: 'messages', maxAge: 86400 }]" />

  <DebrisFinder v-if="tab === 'debris'" />
  <template v-else>

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
      <div v-if="tab === 'targets'" class="field">
        <span class="lbl">{{ t('farm.maxShare') }}</span>
        <select v-model="filter.maxShare">
          <option :value="null">{{ t('common.all') }}</option>
          <option v-for="x in SHARES" :key="x" :value="x">{{ t('farm.maxShareOption', { n: Math.round(x * 100) }) }}</option>
        </select>
      </div>
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
    <div v-if="tab === 'targets'" class="farm-sim small" data-tour="farm-sim">
      <button class="secondary" :disabled="simBusy || !ctx?.own || !filtered.length" :title="ctx?.own ? t('farm.sim.hint', { n: SIM_COUNT }) : t('farm.sim.noEmpire')" @click="simulateTop">
        <Icon name="attack" :size="14" /> {{ simBusy ? t('farm.sim.running') : t('farm.sim.run', { n: Math.min(SIM_COUNT, filtered.length) }) }}
      </button>
      <span class="muted">{{ ownTitle }}</span>
      <span v-if="simError" class="error">{{ simError }}</span>
    </div>

    <template v-if="mobile && tab === 'spy'">
      <SortBar :sort-key="sort.key.value" :options="sortOptions" v-model:desc="sort.descending.value" @sort="sort.sortBy" />
      <div class="farm-cards">
        <div v-for="r in shown" :key="r.key" class="card farm-card">
          <div class="farm-card-head">
            <span class="mono">{{ coords(r.g, r.s, r.p) }}<span v-if="r.type === 'moon'"> ({{ t('common.moon') }})</span></span>
            <PlayerLink :id="r.player.id" :name="r.player.name" />
            <span v-if="r.player.ally_tag" class="muted small">[{{ r.player.ally_tag }}]</span>
            <StatusBadges :status="r.player.status" :points="r.player.points" />
            <InactivityBadge :value="r.inactivity" chip hide-flagged />
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
            <th data-tour="farm-spy-why">{{ t('farm.spy.why') }}</th>
            <th class="num" data-tour="farm-spy-probes">{{ t('farm.spy.probes') }}</th>
            <th class="sortable num" @click="sort.sortBy('flight')">{{ t('farm.flight') }}<SortMark :dir="sort.direction('flight')" /></th>
            <th class="sortable num" data-tour="farm-spy-rank" @click="sort.sortBy('spy')">{{ t('farm.spy.priority') }}<SortMark :dir="sort.direction('spy')" /></th>
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
              <span class="farm-player" :title="r.player.name"><PlayerLink :id="r.player.id" :name="r.player.name" /></span>
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
            <span v-if="r.player.ally_tag" class="muted small">[{{ r.player.ally_tag }}]</span>
            <StatusBadges :status="r.player.status" :points="r.player.points" />
            <InactivityBadge :value="r.inactivity" chip hide-flagged />
            <span v-if="r.standing" class="badge standing" :title="standingTitle(r)">{{ t('farm.standing') }}</span>
            <span class="grow" />
            <PlanetActions :g="r.g" :s="r.s" :p="r.p" :type="r.type" :from="r.from?.c ?? null" :diameter="r.moonDiameter ?? null" />
          </div>
          <div class="farm-card-grid small">
            <span class="muted">{{ t('farm.loot') }}</span><span :title="resTitle(r)"><b>{{ short(r.lootSum) }}</b><Icon v-if="anyFull(r)" name="warning" :size="12" class="warn" /></span>
            <span class="muted">{{ t('farm.perFlightHour') }}</span><span>{{ r.perFlightHour == null ? '–' : short(r.perFlightHour) }}</span>
            <span class="muted">{{ t('farm.flight') }}</span><span :title="flightTitle(r)">{{ r.flight == null ? '–' : duration(Math.floor(r.flight)) }}</span>
            <span class="muted">{{ t('farm.ships') }}</span><span>{{ r.ships == null ? '–' : `${fmt(r.ships)} · ${fmt(r.fuel)} ${name(903)}` }}</span>
            <span class="muted">{{ t('farm.report') }}</span><span :title="reportTitle(r)">{{ ago(r.report.time) }}<span v-if="!r.levels" class="warn"> · {{ t('farm.noLevelsShort') }}</span></span>
            <span class="muted">{{ t('farm.risk') }}</span>
            <span :class="`risk-${r.tier}`" :title="riskTitle(r)">
              {{ t(`farm.riskTier.${r.tier}`) }}<span v-if="r.strength.share != null" class="faint"> · {{ r.strength.estimated ? '≤ ' : '' }}{{ pct(r.strength.share) }}</span>
              <span v-if="r.sim" class="faint"> · {{ simText(r.sim) }}</span>
            </span>
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
            <th class="num" :title="t('farm.shipsTitle')">{{ t('farm.ships') }}</th>
            <th class="sortable num" data-tour="farm-rank" @click="sort.sortBy('perFlightHour')">{{ t('farm.perFlightHour') }}<SortMark :dir="sort.direction('perFlightHour')" /></th>
            <th class="sortable" data-tour="farm-risk" @click="sort.sortBy('strength')">{{ t('farm.risk') }}<SortMark :dir="sort.direction('strength')" /></th>
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
              <span class="farm-player" :title="r.player.name"><PlayerLink :id="r.player.id" :name="r.player.name" /></span>
              <span v-if="r.player.ally_tag" class="muted small"> [{{ r.player.ally_tag }}]</span>
              <StatusBadges :status="r.player.status" :points="r.player.points" />
            </td>
            <td><InactivityBadge :value="r.inactivity" chip /></td>
            <td class="num" :title="resTitle(r)">
              {{ short(r.lootSum) }}<Icon v-if="anyFull(r)" name="warning" :size="12" class="warn full-mark" />
            </td>
            <td class="num" :title="reportTitle(r)">{{ ago(r.report.time) }}<Icon v-if="!r.levels" name="warning" :size="12" class="muted full-mark" /></td>
            <td class="num" :title="flightTitle(r)">{{ r.flight == null ? '–' : duration(Math.floor(r.flight)) }}</td>
            <td class="num" :title="r.fuel == null ? undefined : `${t('farm.fuel')}: ${fmt(r.fuel)} ${name(903)}`">
              {{ r.ships == null ? '–' : fmt(r.ships) }}<span v-if="r.fuel != null" class="faint"> · {{ short(r.fuel) }} {{ abbr(903) }}</span>
            </td>
            <td class="num"><b>{{ r.perFlightHour == null ? '–' : short(r.perFlightHour) }}</b></td>
            <td :class="`risk-${r.tier}`" :title="riskTitle(r)">
              <span class="nowrap">{{ t(`farm.riskTier.${r.tier}`) }}<span v-if="r.strength.share != null" class="faint"> · {{ r.strength.estimated ? '≤ ' : '' }}{{ pct(r.strength.share) }}</span></span>
              <span v-if="r.standing" class="badge standing" :title="standingTitle(r)">{{ t('farm.standing') }}</span>
              <div v-if="r.sim" class="small faint nowrap">{{ simText(r.sim) }}</div>
            </td>
            <td><PlanetActions :g="r.g" :s="r.s" :p="r.p" :type="r.type" :from="r.from?.c ?? null" :diameter="r.moonDiameter ?? null" /></td>
          </tr>
        </tbody>
      </table>
      <div v-if="more" ref="sentinel" />
    </div>
  </template>
  </template>
  <Contributors v-if="tab === 'debris'" scope="galaxy" />
  <Contributors v-else scope="farm" :days="days" />
</template>

<style scoped>
.field-inline { display: inline-flex; align-items: center; gap: 6px; }
.nowrap { white-space: nowrap; }
/* long names must not push risk and actions out of view (full name as title) */
.farm-player { display: inline-block; max-width: 16ch; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
.full-mark { margin-left: 3px; vertical-align: -1px; }
.risk-safe, .risk-weak { color: var(--pos); }
.risk-acceptable { color: var(--warn); }
.risk-risky, .risk-strong { color: var(--neg); }
.risk-unknown { color: var(--muted); }
.standing { color: var(--warn); margin-left: 4px; }
.farm-sim { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 8px; }
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
