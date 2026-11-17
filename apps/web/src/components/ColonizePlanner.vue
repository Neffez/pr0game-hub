<script setup lang="ts">
import Loading from './Loading.vue';
import FilterBar, { type FilterChip } from './FilterBar.vue';
import SortBar from './SortBar.vue';
import SortMark from './SortMark.vue';
import { positionInfo, type PositionInfo } from '@pr0hub/core/colonize';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useLoader, useMobile, useProgressive, useSort, useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { ago, coords, fmt, short } from '../format';
import type { Colonize, ColonySystem } from '../apiTypes';

/**
 * Colonization planner (backlog C-5), a tab of the alliance's planets page: free positions of the known galaxy ranked by profile. A fleeter wants coverage
 * of the universe and targets with many points nearby, a miner fields, temperature and the position bonus; both avoid
 * positions where many members compete for the same targets. Server: repo/colonize.ts, positions: @pr0hub/core/colonize.
 */
type System = ColonySystem;
type Profile = 'fleeter' | 'miner';
interface Row {
  key: string;
  sys: System;
  p: number;
  info: PositionInfo;
  locked: boolean;
  parts: { coverage: number; targets: number; competition: number; position: number };
  score: number;
  /** systems to the viewer's nearest planet in the same galaxy, null without one there */
  dist: number | null;
}

const { t } = useI18n();
const { ctx, uni } = useUni();
const mobile = useMobile();

/** The server's limits of the range (`GET /colonize?range=`). */
const RANGE_MIN = 1;
const RANGE_MAX = 200;
/** Weights per profile: coverage, targets (points nearby), competition (fewer members nearby), the position itself. */
const WEIGHTS: Record<Profile, Row['parts']> = {
  fleeter: { coverage: 0.25, targets: 0.5, competition: 0.15, position: 0.1 },
  miner: { coverage: 0.1, targets: 0.1, competition: 0.15, position: 0.65 },
};
/** Share of the system's own points in the targets part (the rest: points within the range), per profile. */
const SYSTEM_SHARE: Record<Profile, number> = { fleeter: 0.5, miner: 0.3 };
const FILTER_DEFAULTS = {
  profile: 'fleeter' as Profile, range: 25, galaxy: null as number | null, onlyNow: false, onlySeen: false, maxMembers: null as number | null,
  distMin: null as number | null, distMax: null as number | null,
};
const filter = useStored('colonize.filter', { ...FILTER_DEFAULTS });
filter.value = { ...FILTER_DEFAULTS, ...filter.value };

/** A number field as a whole number >= 0; an emptied field (`''` from `v-model.number`) is no value. */
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
/** The range as typed, within the server's limits (25 while the field is empty). */
const range = computed(() => Math.min(RANGE_MAX, Math.max(RANGE_MIN, count(filter.value.range) || FILTER_DEFAULTS.range)));
const { data, error, load } = useLoader(() => uniApi<Colonize>(uni.value, `/colonize?range=${range.value}`));
onMounted(load);
watch(range, () => load());
useLiveReload(load, tables('galaxy_systems', 'empire', 'player_scores'));

const settings = computed(() => ctx.value!.universe.settings);
const astro = computed(() => (ctx.value?.own?.research as Record<number, number> | undefined)?.[124] ?? 0);
const infos = computed(() => {
  const out: Record<number, PositionInfo> = {};
  for (let p = 1; p <= settings.value.positions; p++) out[p] = positionInfo(p, settings.value);
  return out;
});
/** Own planets by galaxy (systems), from the latest empire page. */
const ownSystems = computed(() => {
  const out = new Map<number, number[]>();
  for (const p of ctx.value?.own?.planets ?? []) if (p.type === 'planet') (out.get(p.coords.g) ?? out.set(p.coords.g, []).get(p.coords.g)!).push(p.coords.s);
  return out;
});
/** Systems between two systems of a galaxy, across the edge where the universe's systems wrap around. */
const sysDiff = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return settings.value.circularSystems ? Math.min(d, settings.value.systems - d) : d;
};
const distOf = (g: number, s: number) => {
  const own = ownSystems.value.get(g);
  return own?.length ? Math.min(...own.map((o) => sysDiff(o, s))) : null;
};
const hasBonus = computed(() => Object.values(infos.value).some((i) => i.bonus[901] || i.bonus[902] || i.bonus[903]));

const rows = computed<Row[]>(() => {
  const list = data.value?.systems ?? [];
  if (!list.length) return [];
  const max = (f: (s: System) => number) => Math.max(1e-9, ...list.map(f));
  const maxCov = max((s) => s.coverage);
  const maxPts = Math.sqrt(max((s) => s.targetPoints));
  const maxSys = Math.sqrt(max((s) => s.systemPoints));
  const maxMembers = max((s) => s.members);
  const all = Object.values(infos.value);
  const maxFields = Math.max(...all.map((i) => i.fields.avg));
  const [minDeut, maxDeut] = [Math.min(...all.map((i) => i.deut)), Math.max(...all.map((i) => i.deut))];
  const bonusOf = (i: PositionInfo) => i.bonus[901] + i.bonus[902] + i.bonus[903];
  const [minBonus, maxBonus] = [Math.min(...all.map(bonusOf)), Math.max(...all.map(bonusOf))];
  const w = WEIGHTS[filter.value.profile];
  const share = SYSTEM_SHARE[filter.value.profile];
  const out: Row[] = [];
  for (const sys of list) {
    const dist = distOf(sys.g, sys.s);
    const coverage = sys.coverage / maxCov;
    const targets = (1 - share) * (Math.sqrt(sys.targetPoints) / maxPts) + share * (Math.sqrt(sys.systemPoints) / maxSys);
    const competition = 1 - sys.members / maxMembers;
    for (const p of sys.free) {
      const info = infos.value[p];
      const deut = maxDeut > minDeut ? (info.deut - minDeut) / (maxDeut - minDeut) : 0;
      const bonus = maxBonus > minBonus ? (bonusOf(info) - minBonus) / (maxBonus - minBonus) : 0;
      // fields count most; without position bonuses in this universe their weight goes to fields and deuterium
      const position = hasBonus.value ? 0.5 * (info.fields.avg / maxFields) + 0.2 * deut + 0.3 * bonus : 0.7 * (info.fields.avg / maxFields) + 0.3 * deut;
      const parts = { coverage, targets, competition, position };
      const score = 100 * (w.coverage * coverage + w.targets * targets + w.competition * competition + w.position * position);
      out.push({ key: `${sys.g}:${sys.s}:${p}`, sys, p, info, locked: info.astro > Math.max(1, astro.value), parts, score, dist });
    }
  }
  return out;
});

const galaxies = computed(() => settings.value.galaxies ?? 1);
// the filter is stored for all universes: a galaxy this universe does not have is no filter
watch(galaxies, (n) => filter.value.galaxy != null && filter.value.galaxy > n && (filter.value.galaxy = null), { immediate: true });
/** "At most members" as a number; an emptied field is no filter. */
const memberLimit = computed(() => count(filter.value.maxMembers));
/** Distance to my planets from–to (systems); either end may be open. */
const distMin = computed(() => count(filter.value.distMin));
const distMax = computed(() => count(filter.value.distMax));
const distFilter = computed(() => distMin.value != null || distMax.value != null);
const filtered = computed(() =>
  rows.value.filter((r) => {
    const f = filter.value;
    if (f.galaxy && r.sys.g !== f.galaxy) return false;
    if (f.onlyNow && r.locked) return false;
    if (f.onlySeen && r.sys.seen == null) return false;
    if (memberLimit.value != null && r.sys.members > memberLimit.value) return false;
    if (distFilter.value) {
      // without an own planet in the galaxy there is no distance to keep
      if (r.dist == null) return false;
      if (distMin.value != null && r.dist < distMin.value) return false;
      if (distMax.value != null && r.dist > distMax.value) return false;
    }
    return true;
  }),
);

const sortValue = (r: Row, key: string): unknown => {
  switch (key) {
    case 'score': return r.score;
    case 'coverage': return r.sys.coverage;
    case 'points': return r.sys.targetPoints;
    case 'members': return -r.sys.members;
    case 'fields': return r.info.fields.avg;
    case 'temp': return r.info.temp.avg;
    case 'dist': return r.dist == null ? null : -r.dist;
    case 'coords': return -(r.sys.g * 1e6 + r.sys.s * 100 + r.p);
  }
  return null;
};
const sort = useSort(filtered, sortValue, 'score');
const sortOptions = computed(() => [
  { key: 'score', label: t('colonize.score') },
  { key: 'coverage', label: t('colonize.coverage') },
  { key: 'points', label: t('colonize.points') },
  { key: 'members', label: t('colonize.members') },
  { key: 'fields', label: t('colonize.fields') },
  { key: 'dist', label: t('colonize.dist') },
]);
const { shown, more, sentinel } = useProgressive(sort.sorted, 80);

const chips = computed<FilterChip[]>(() => {
  const f = filter.value;
  const out: FilterChip[] = [];
  const add = (key: keyof typeof FILTER_DEFAULTS, label: string) => out.push({ key, label, clear: () => ((filter.value as Record<string, unknown>)[key] = FILTER_DEFAULTS[key]) });
  if (f.galaxy) add('galaxy', `${t('nav.galaxy')} ${f.galaxy}`);
  if (f.onlyNow) add('onlyNow', t('colonize.onlyNow'));
  if (f.onlySeen) add('onlySeen', t('colonize.onlySeen'));
  if (memberLimit.value != null) add('maxMembers', t('colonize.maxMembersChip', { n: memberLimit.value }));
  if (distFilter.value) {
    out.push({
      key: 'dist',
      label: t('colonize.distChip', { min: distMin.value ?? 0, max: distMax.value ?? '∞' }),
      clear: () => (filter.value = { ...filter.value, distMin: null, distMax: null }),
    });
  }
  return out;
});
const resetFilters = () => (filter.value = { ...FILTER_DEFAULTS, profile: filter.value.profile, range: filter.value.range });

const pct = (v: number) => `${Math.round(v * 100)}`;
const bonusText = (i: PositionInfo) =>
  [901, 902, 903]
    .map((id) => i.bonus[id as 901] && `${i.bonus[id as 901] > 0 ? '+' : ''}${i.bonus[id as 901]} % ${t(`colonize.res.${id}`)}`)
    .filter(Boolean)
    .join(', ');
const scoreTitle = (r: Row) =>
  [
    t('colonize.scoreTitle', { profile: t(`colonize.profiles.${filter.value.profile}`) }),
    `${t('colonize.coverage')}: ${pct(r.parts.coverage)}`,
    `${t('colonize.points')}: ${pct(r.parts.targets)}`,
    `${t('colonize.competition')}: ${pct(r.parts.competition)}`,
    `${t('colonize.position')}: ${pct(r.parts.position)}`,
  ].join('\n');
const posTitle = (r: Row) =>
  [
    t('colonize.fieldsTitle', { min: r.info.fields.min, max: r.info.fields.max, avg: r.info.fields.avg }),
    t('colonize.tempTitle', { min: r.info.temp.min, max: r.info.temp.max }),
    t('colonize.deutTitle', { n: Math.round(r.info.deut * 100) }),
    bonusText(r.info),
  ]
    .filter(Boolean)
    .join('\n');
const nearTitle = (r: Row) => t('colonize.nearTitle', { range: data.value?.range ?? 0, n: r.sys.targets, inactive: r.sys.inactive, system: short(r.sys.systemPoints) });
</script>

<template>
  <FilterBar data-tour="colonize-filter" store-key="colonize" :chips="chips" @reset="resetFilters">
    <template #toolbar>
      <div class="seg" data-tour="colonize-profile">
        <button :class="{ active: filter.profile === 'fleeter' }" @click="filter.profile = 'fleeter'">{{ t('colonize.profiles.fleeter') }}</button>
        <button :class="{ active: filter.profile === 'miner' }" @click="filter.profile = 'miner'">{{ t('colonize.profiles.miner') }}</button>
      </div>
      <label class="field-inline" :title="t('colonize.rangeTitle')">
        {{ t('colonize.range') }} ±
        <input v-model.lazy.number="filter.range" class="range-input" type="number" :min="RANGE_MIN" :max="RANGE_MAX" step="1" />
        {{ t('colonize.systems') }}
      </label>
    </template>
    <div class="filter-group">
      <span class="filter-title">{{ t('colonize.positions') }}</span>
      <label class="check"><input v-model="filter.onlyNow" type="checkbox" /> {{ t('colonize.onlyNow') }}</label>
      <label class="check" :title="t('colonize.unseenTitle')"><input v-model="filter.onlySeen" type="checkbox" /> {{ t('colonize.onlySeen') }}</label>
      <div class="field">
        <span class="lbl">{{ t('colonize.maxMembers') }}</span>
        <input v-model.number="filter.maxMembers" type="number" min="0" step="1" />
      </div>
      <div class="field" :title="t('colonize.distTitle')">
        <span class="lbl">{{ t('colonize.distFilter') }}</span>
        <span class="dist-range">
          <input v-model.number="filter.distMin" type="number" min="0" step="1" :placeholder="t('colonize.from')" />
          –
          <input v-model.number="filter.distMax" type="number" min="0" step="1" :placeholder="t('colonize.to')" />
        </span>
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
      <span class="small muted">{{ t('colonize.count', { n: filtered.length, total: rows.length }) }}</span>
    </template>
  </FilterBar>

  <div v-if="error" class="error">{{ error }}</div>
  <Loading v-else-if="!data" :lines="6" />
  <template v-else>
    <p class="small muted">
      {{ t('colonize.known', { n: fmt(data.seenSystems), total: fmt(data.totalSystems) }) }}
      <template v-if="!data.own"> · <span class="warn">{{ t('colonize.noEmpire') }}</span></template>
      · {{ t('colonize.astro', { n: astro }) }}
    </p>
    <div v-if="!rows.length" class="card muted">
      {{ t('colonize.empty') }} <RouterLink :to="`/${uni}/paste`">{{ t('nav.sync') }}</RouterLink>
    </div>

    <template v-else-if="mobile">
      <SortBar :sort-key="sort.key.value" :options="sortOptions" v-model:desc="sort.descending.value" @sort="sort.sortBy" />
      <div class="colo-cards">
        <div v-for="r in shown" :key="r.key" class="card colo-card">
          <div class="colo-head">
            <RouterLink class="mono" :to="{ path: `/${uni}/browse`, query: { g: r.sys.g, s: r.sys.s } }">{{ coords(r.sys.g, r.sys.s, r.p) }}</RouterLink>
            <span v-if="r.locked" class="badge warn">{{ t('colonize.needsAstro', { n: r.info.astro }) }}</span>
            <span v-if="r.sys.seen == null" class="badge" :title="t('colonize.unseenTitle')">{{ t('colonize.unseen') }}</span>
            <span class="grow" />
            <b :title="scoreTitle(r)">{{ Math.round(r.score) }}</b>
          </div>
          <div class="colo-grid small">
            <span class="muted">{{ t('colonize.fields') }}</span><span :title="posTitle(r)">{{ r.info.fields.avg }} · {{ r.info.temp.avg }} °C</span>
            <span class="muted">{{ t('colonize.coverage') }}</span><span>{{ pct(r.sys.coverage) }} %</span>
            <span class="muted">{{ t('colonize.points') }}</span><span :title="nearTitle(r)">{{ short(r.sys.targetPoints) }}</span>
            <span class="muted">{{ t('colonize.members') }}</span><span>{{ r.sys.members }}</span>
            <span class="muted">{{ t('colonize.dist') }}</span><span>{{ r.dist ?? '–' }}</span>
          </div>
        </div>
        <div v-if="more" ref="sentinel" />
      </div>
    </template>

    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th class="sortable" @click="sort.sortBy('coords')">{{ t('colonize.position') }}<SortMark :dir="sort.direction('coords')" /></th>
            <th class="num" data-tour="colonize-astro">{{ t('colonize.astroCol') }}</th>
            <th class="sortable num" @click="sort.sortBy('fields')">{{ t('colonize.fields') }}<SortMark :dir="sort.direction('fields')" /></th>
            <th class="sortable num" @click="sort.sortBy('temp')">{{ t('colonize.temp') }}<SortMark :dir="sort.direction('temp')" /></th>
            <th v-if="hasBonus">{{ t('colonize.bonus') }}</th>
            <th class="sortable num" data-tour="colonize-coverage" :title="t('colonize.coverageTitle')" @click="sort.sortBy('coverage')">{{ t('colonize.coverage') }}<SortMark :dir="sort.direction('coverage')" /></th>
            <th class="sortable num" @click="sort.sortBy('points')">{{ t('colonize.points') }}<SortMark :dir="sort.direction('points')" /></th>
            <th class="num">{{ t('colonize.targets') }}</th>
            <th class="sortable num" data-tour="colonize-members" :title="t('colonize.membersTitle')" @click="sort.sortBy('members')">{{ t('colonize.members') }}<SortMark :dir="sort.direction('members')" /></th>
            <th class="sortable num" :title="t('colonize.distTitle')" @click="sort.sortBy('dist')">{{ t('colonize.dist') }}<SortMark :dir="sort.direction('dist')" /></th>
            <th class="num">{{ t('colonize.seen') }}</th>
            <th class="sortable num" data-tour="colonize-score" @click="sort.sortBy('score')">{{ t('colonize.score') }}<SortMark :dir="sort.direction('score')" /></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.key">
            <td class="nowrap">
              <RouterLink class="mono" :to="{ path: `/${uni}/browse`, query: { g: r.sys.g, s: r.sys.s } }">{{ coords(r.sys.g, r.sys.s, r.p) }}</RouterLink>
            </td>
            <td class="num" :class="{ warn: r.locked }" :title="r.locked ? t('colonize.needsAstro', { n: r.info.astro }) : ''">{{ r.info.astro }}</td>
            <td class="num" :title="posTitle(r)">{{ r.info.fields.avg }}</td>
            <td class="num" :title="posTitle(r)">{{ r.info.temp.avg }} °C</td>
            <td v-if="hasBonus" class="small">{{ bonusText(r.info) }}</td>
            <td class="num">{{ pct(r.sys.coverage) }} %</td>
            <td class="num" :title="nearTitle(r)">{{ short(r.sys.targetPoints) }}</td>
            <td class="num" :title="nearTitle(r)">{{ r.sys.targets }}<span v-if="r.sys.inactive" class="muted small"> ({{ t('colonize.inactiveShort', { n: r.sys.inactive }) }})</span></td>
            <td class="num">{{ r.sys.members }}</td>
            <td class="num">{{ r.dist ?? '–' }}</td>
            <td v-if="r.sys.seen != null" class="num small muted">{{ ago(r.sys.seen) }}</td>
            <td v-else class="num small warn" :title="t('colonize.unseenTitle')">{{ t('colonize.unseen') }}</td>
            <td class="num" :title="scoreTitle(r)"><b>{{ Math.round(r.score) }}</b></td>
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
.range-input { width: 4.5em; }
.dist-range { display: inline-flex; align-items: center; gap: 4px; }
.dist-range input { width: 5em; }
.colo-cards { display: flex; flex-direction: column; gap: 8px; }
.colo-card { padding: 10px 12px; }
.colo-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.colo-grid { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 3px 10px; }
</style>
