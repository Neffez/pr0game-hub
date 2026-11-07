<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import Hint from '../components/Hint.vue';
import Loading from '../components/Loading.vue';
import FilterBar, { type FilterChip } from '../components/FilterBar.vue';
import SortBar from '../components/SortBar.vue';
import SortMark from '../components/SortMark.vue';
import { positionInfo, type PositionInfo } from '@pr0hub/core/colonize';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useLoader, useMobile, useProgressive, useSort, useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { ago, coords, fmt, short } from '../format';

/**
 * Colonization planner (backlog C-5): free positions of the known galaxy ranked by profile. A fleeter wants coverage
 * of the universe and targets with many points nearby, a miner fields, temperature and the position bonus; both avoid
 * positions where many members compete for the same targets. Server: repo/colonize.ts, positions: @pr0hub/core/colonize.
 */
interface System {
  g: number; s: number; free: number[]; seen: number; coverage: number; nearest: number | null;
  members: number; targets: number; inactive: number; targetPoints: number; systemPoints: number;
}
interface ColonizeResponse { systems: System[]; own: number; seenSystems: number; totalSystems: number; range: number }
type Profile = 'fleeter' | 'miner';
interface Row {
  key: string;
  sys: System;
  p: number;
  info: PositionInfo;
  locked: boolean;
  parts: { coverage: number; targets: number; competition: number; position: number };
  score: number;
}

const { t } = useI18n();
const { ctx, uni } = useUni();
const mobile = useMobile();

const RANGES = [10, 25, 50, 100];
/** Weights per profile: coverage, targets (points nearby), competition (fewer members nearby), the position itself. */
const WEIGHTS: Record<Profile, Row['parts']> = {
  fleeter: { coverage: 0.4, targets: 0.3, competition: 0.15, position: 0.15 },
  miner: { coverage: 0.1, targets: 0.1, competition: 0.15, position: 0.65 },
};
const FILTER_DEFAULTS = { profile: 'fleeter' as Profile, range: 25, galaxy: null as number | null, onlyNow: false, maxMembers: null as number | null };
const filter = useStored('colonize.filter', { ...FILTER_DEFAULTS });
filter.value = { ...FILTER_DEFAULTS, ...filter.value };

const { data, error, load } = useLoader(() => uniApi<ColonizeResponse>(uni.value, `/colonize?range=${filter.value.range}`));
onMounted(load);
watch(() => filter.value.range, () => load());
useLiveReload(load, tables('galaxy_systems', 'empire', 'player_scores'));

const settings = computed(() => ctx.value!.universe.settings);
const astro = computed(() => (ctx.value?.own?.research as Record<number, number> | undefined)?.[124] ?? 0);
const infos = computed(() => {
  const out: Record<number, PositionInfo> = {};
  for (let p = 1; p <= settings.value.positions; p++) out[p] = positionInfo(p, settings.value);
  return out;
});
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
  const out: Row[] = [];
  for (const sys of list) {
    const coverage = sys.coverage / maxCov;
    const targets = 0.7 * (Math.sqrt(sys.targetPoints) / maxPts) + 0.3 * (Math.sqrt(sys.systemPoints) / maxSys);
    const competition = 1 - sys.members / maxMembers;
    for (const p of sys.free) {
      const info = infos.value[p];
      const deut = maxDeut > minDeut ? (info.deut - minDeut) / (maxDeut - minDeut) : 0;
      const bonus = maxBonus > minBonus ? (bonusOf(info) - minBonus) / (maxBonus - minBonus) : 0;
      // fields count most; without position bonuses in this universe their weight goes to fields and deuterium
      const position = hasBonus.value ? 0.5 * (info.fields.avg / maxFields) + 0.2 * deut + 0.3 * bonus : 0.7 * (info.fields.avg / maxFields) + 0.3 * deut;
      const parts = { coverage, targets, competition, position };
      const score = 100 * (w.coverage * coverage + w.targets * targets + w.competition * competition + w.position * position);
      out.push({ key: `${sys.g}:${sys.s}:${p}`, sys, p, info, locked: info.astro > Math.max(1, astro.value), parts, score });
    }
  }
  return out;
});

const galaxies = computed(() => settings.value.galaxies ?? 1);
const filtered = computed(() =>
  rows.value.filter((r) => {
    const f = filter.value;
    if (f.galaxy && r.sys.g !== f.galaxy) return false;
    if (f.onlyNow && r.locked) return false;
    if (f.maxMembers != null && f.maxMembers >= 0 && r.sys.members > f.maxMembers) return false;
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
]);
const { shown, more, sentinel } = useProgressive(sort.sorted, 80);

const chips = computed<FilterChip[]>(() => {
  const f = filter.value;
  const out: FilterChip[] = [];
  const add = (key: keyof typeof FILTER_DEFAULTS, label: string) => out.push({ key, label, clear: () => ((filter.value as Record<string, unknown>)[key] = FILTER_DEFAULTS[key]) });
  if (f.galaxy) add('galaxy', `${t('nav.galaxy')} ${f.galaxy}`);
  if (f.onlyNow) add('onlyNow', t('colonize.onlyNow'));
  if (f.maxMembers != null) add('maxMembers', t('colonize.maxMembersChip', { n: f.maxMembers }));
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
  <PageHeader :title="t('nav.colonize')">
    <template #hint>
      <Hint>
        <p>{{ t('colonize.hint1') }}</p>
        <p>{{ t('colonize.hint2') }}</p>
        <p>{{ t('colonize.hint3') }}</p>
      </Hint>
    </template>
    <div class="seg">
      <button :class="{ active: filter.profile === 'fleeter' }" @click="filter.profile = 'fleeter'">{{ t('colonize.profiles.fleeter') }}</button>
      <button :class="{ active: filter.profile === 'miner' }" @click="filter.profile = 'miner'">{{ t('colonize.profiles.miner') }}</button>
    </div>
  </PageHeader>

  <FilterBar store-key="colonize" :chips="chips" @reset="resetFilters">
    <template #toolbar>
      <label class="field-inline">
        {{ t('colonize.range') }}
        <select v-model.number="filter.range">
          <option v-for="r in RANGES" :key="r" :value="r">{{ t('colonize.systemsOption', { n: r }) }}</option>
        </select>
      </label>
    </template>
    <div class="filter-group">
      <span class="filter-title">{{ t('colonize.positions') }}</span>
      <label class="check"><input v-model="filter.onlyNow" type="checkbox" /> {{ t('colonize.onlyNow') }}</label>
      <div class="field">
        <span class="lbl">{{ t('colonize.maxMembers') }}</span>
        <input v-model.number="filter.maxMembers" type="number" min="0" step="1" />
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
            <span class="grow" />
            <b :title="scoreTitle(r)">{{ Math.round(r.score) }}</b>
          </div>
          <div class="colo-grid small">
            <span class="muted">{{ t('colonize.fields') }}</span><span :title="posTitle(r)">{{ r.info.fields.avg }} · {{ r.info.temp.avg }} °C</span>
            <span class="muted">{{ t('colonize.coverage') }}</span><span>{{ pct(r.sys.coverage) }} %</span>
            <span class="muted">{{ t('colonize.points') }}</span><span :title="nearTitle(r)">{{ short(r.sys.targetPoints) }}</span>
            <span class="muted">{{ t('colonize.members') }}</span><span>{{ r.sys.members }}</span>
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
            <th class="num">{{ t('colonize.astroCol') }}</th>
            <th class="sortable num" @click="sort.sortBy('fields')">{{ t('colonize.fields') }}<SortMark :dir="sort.direction('fields')" /></th>
            <th class="sortable num" @click="sort.sortBy('temp')">{{ t('colonize.temp') }}<SortMark :dir="sort.direction('temp')" /></th>
            <th v-if="hasBonus">{{ t('colonize.bonus') }}</th>
            <th class="sortable num" :title="t('colonize.coverageTitle')" @click="sort.sortBy('coverage')">{{ t('colonize.coverage') }}<SortMark :dir="sort.direction('coverage')" /></th>
            <th class="sortable num" @click="sort.sortBy('points')">{{ t('colonize.points') }}<SortMark :dir="sort.direction('points')" /></th>
            <th class="num">{{ t('colonize.targets') }}</th>
            <th class="sortable num" :title="t('colonize.membersTitle')" @click="sort.sortBy('members')">{{ t('colonize.members') }}<SortMark :dir="sort.direction('members')" /></th>
            <th class="num">{{ t('colonize.seen') }}</th>
            <th class="sortable num" @click="sort.sortBy('score')">{{ t('colonize.score') }}<SortMark :dir="sort.direction('score')" /></th>
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
            <td class="num" :title="nearTitle(r)">{{ r.sys.targets }}<span v-if="r.sys.inactive" class="muted small"> ({{ r.sys.inactive }} i)</span></td>
            <td class="num">{{ r.sys.members }}</td>
            <td class="num small muted">{{ ago(r.sys.seen) }}</td>
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
.colo-cards { display: flex; flex-direction: column; gap: 8px; }
.colo-card { padding: 10px 12px; }
.colo-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.colo-grid { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 3px 10px; }
</style>
