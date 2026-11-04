<script setup lang="ts">
import { useAutoTour } from '../tours';
import { nowSec } from '../clock';
import ShowMore from './ShowMore.vue';
import MemberSelect from './MemberSelect.vue';
import RangePicker from './RangePicker.vue';
import Section from './Section.vue';
import SortBar from './SortBar.vue';
import SortMark from './SortMark.vue';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useLoader, useLimit, useMobile, useSort, useStored, useUni, vStack } from '../composables';
import { tables, useLiveReload } from '../live';
import { CRYSTAL, DEUTERIUM, elementPoints, METAL } from '@pr0hub/core/tech';
import { cardLabel, coords, dateTime, DEPLETION_LABEL, fmt, name, short } from '../format';

/**
 * Expedition statistics (tab of the expeditions page): yields per member, the distribution of events compared to the
 * deck and the latest expeditions, each a collapsible section with sortable columns.
 */
const { t } = useI18n();
const { uni, ctx } = useUni();
/** Column headers are hidden in the stacked mobile tables: a sort selection instead. */
const mobile = useMobile();
/** Default like the FF-Hub: the last 24 hours. */
const days = useStored('expos.range', 1);
/**
 * Member whose distribution and expeditions are shown (null = whole alliance); the yields always list everyone.
 * Starts with the viewer's own.
 */
const member = useStored<number | null>('expos.memberFilter', ctx.value!.me.id);
const memberLabel = computed(() =>
  member.value == null ? t('raids.wholeAlliance') : (ctx.value!.members.find((m) => m.id === member.value)?.name ?? '?'),
);

const { data, error, load } = useLoader<any>(() => uniApi(uni.value, `/expeditions?from=${nowSec() - days.value * 86400}`));
onMounted(load);
useLiveReload(load, tables('expeditions'));
watch(days, load);

const pct = (n: number, total: number) => (total ? (n / total) * 100 : 0);
/** observed share vs deck share */
function devStyle(observed: number, expected: number) {
  if (!expected) return {};
  const r = observed / expected;
  if (r > 1.3) return { color: 'var(--pos)' };
  if (r < 0.7) return { color: 'var(--neg)' };
  return {};
}
const posClass = (n: number) => (n > 0 ? 'pos' : 'faint');
const rangeLabel = (d: number) => (d === 1 ? t('expeditions.last24h') : d >= 3650 ? t('expeditions.allTime') : t('expeditions.lastDays', { n: d }));

// ------------------------------------------- yields: one row per member (like the FF-Hub)
interface Yield { userId: number; name: string; count: number; metal: number; crystal: number; deut: number; shipPoints: number; points: number; perExpo: number | null }
const shipPoints = (ships: Record<string, number>) => Object.entries(ships).reduce((sum, [id, n]) => sum + elementPoints(id, n), 0);
const yields = computed<Yield[]>(() => {
  const byUser = new Map<number, any>((data.value?.perUser ?? []).map((u: any) => [u.userId, u]));
  return ctx.value!.members.map((m) => {
    const u = byUser.get(m.id);
    const metal = u?.resources[METAL] ?? 0;
    const crystal = u?.resources[CRYSTAL] ?? 0;
    const deut = u?.resources[DEUTERIUM] ?? 0;
    const sp = u ? shipPoints(u.ships) : 0;
    const count = u?.total ?? 0;
    const points = (metal + crystal + deut) / 1000 + sp;
    return { userId: m.id, name: m.name, count, metal, crystal, deut, shipPoints: sp, points, perExpo: count ? points / count : null };
  });
});
const yieldSort = useSort(yields, (y, k) => y[k as keyof Yield], 'points');
const yieldCols = computed(() => [
  { key: 'count', label: t('expeditions.expos') },
  { key: 'metal', label: name(METAL) },
  { key: 'crystal', label: name(CRYSTAL) },
  { key: 'deut', label: name(DEUTERIUM) },
  { key: 'shipPoints', label: t('game.events.Ships'), title: t('expeditions.shipsTitle') },
  { key: 'points', label: t('expeditions.points'), title: t('expeditions.pointsTitle') },
  { key: 'perExpo', label: t('expeditions.perExpo'), title: t('expeditions.perExpoTitle') },
]);
const { key: yieldKey, descending: yieldDesc } = yieldSort;
const yieldOptions = computed(() => [{ key: 'name', label: t('common.player') }, ...yieldCols.value.map((c) => ({ key: c.key, label: c.label }))]);
const yieldTotal = computed(() =>
  yields.value.reduce(
    (s, y) => ({ count: s.count + y.count, metal: s.metal + y.metal, crystal: s.crystal + y.crystal, deut: s.deut + y.deut, shipPoints: s.shipPoints + y.shipPoints, points: s.points + y.points }),
    { count: 0, metal: 0, crystal: 0, deut: 0, shipPoints: 0, points: 0 },
  ),
);
/** A click on a member filters distribution and list to them, a second click shows the whole alliance again. */
const pickMember = (id: number) => (member.value = member.value === id ? null : id);

// ------------------------------------------- distribution: events × members
const shown = computed(() => (data.value?.perUser ?? []).filter((u: any) => member.value == null || u.userId === member.value));
/** Columns: each member, plus the alliance total when several are shown. */
const columns = computed(() => {
  const list = [...shown.value];
  if (list.length < 2) return list;
  const add = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n;
  };
  const total = { userId: -1, username: t('raids.allianceTotal'), total: 0, events: {}, resources: {}, ships: {} };
  for (const u of list) {
    total.total += u.total;
    add(total.events, u.events);
    add(total.resources, u.resources);
    add(total.ships, u.ships);
  }
  return [...list, total];
});
/** Event rows in deck order; sortable by name, deck share or a column's count. */
const keys = computed(() => Object.keys(data.value?.expected ?? {}).map((k, i) => ({ k, i })));
const distSort = useSort(
  keys,
  (row, s) => {
    if (s === 'order') return row.i;
    if (s === 'event') return cardLabel(row.k);
    if (s === 'deck') return data.value.expected[row.k];
    const u = columns.value.find((c: any) => `u${c.userId}` === s);
    return u ? (u.events[row.k] ?? 0) : null;
  },
  'order',
  false,
);
const sumRes = (u: any) => Object.values(u.resources as Record<string, number>).reduce((a, b) => a + b, 0);

// ------------------------------------------- latest expeditions
const list = computed(() => (data.value?.list ?? []).filter((e: any) => member.value == null || e.user_id === member.value));
const foundRes = (e: any) => Object.values((e.found_resources ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
const listSort = useSort(
  list,
  (e: any, k) => {
    if (k === 'time') return e.time;
    if (k === 'player') return e.username;
    if (k === 'target') return e.g ? e.g * 1e6 + e.s * 100 + e.p : null;
    if (k === 'event') return cardLabel(`${e.event}:${e.size}`);
    if (k === 'found') return foundRes(e) / 1000 + shipPoints(e.found_ships ?? {});
    return null;
  },
  'time',
);
const { key: listKey, descending: listDesc } = listSort;
const listOptions = computed(() => [
  { key: 'time', label: t('common.time') },
  { key: 'player', label: t('common.player') },
  { key: 'target', label: t('hostile.target') },
  { key: 'event', label: t('expeditions.event') },
  { key: 'found', label: t('expeditions.found') },
]);
const listLimit = useLimit<any>(listSort.sorted);
const isManual = (e: any) => String(e.dedupe_key).startsWith('manual:');
/** Own manually counted entries (deck tab) can be removed again. */
async function removeManual(e: any) {
  if (!confirm(t('expeditions.deleteConfirm', { event: cardLabel(`${e.event}:${e.size}`), time: dateTime(e.time) }))) return;
  await uniApi(uni.value, `/deck/events/${e.id}`, { method: 'DELETE' });
  await load();
}
useAutoTour('expeditions', () => !!data.value, 'stats');
</script>

<template>
  <div class="row toolbar">
    <RangePicker v-model="days" />
    <span class="grow" />
    <MemberSelect v-model="member" :all-label="t('raids.wholeAlliance')" :label="t('expeditions.memberFilter')" />
  </div>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="data">
    <Section data-tour="expo-yields" :title="`${t('expeditions.yields')} (${rangeLabel(days)})`" :card="false" :level="2" store-key="expos.yields">
      <SortBar v-if="mobile" v-model:desc="yieldDesc" :sort-key="yieldKey" :options="yieldOptions" @sort="yieldSort.sortBy" />
      <div class="table-wrap flat">
        <table v-stack class="data yields">
          <thead>
            <tr>
              <th class="sortable" @click="yieldSort.sortBy('name')">{{ t('common.player') }}<SortMark :dir="yieldSort.direction('name')" /></th>
              <th v-for="c in yieldCols" :key="c.key" class="sortable num" :title="c.title" @click="yieldSort.sortBy(c.key)">
                {{ c.label }}<SortMark :dir="yieldSort.direction(c.key)" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="y in yieldSort.sorted.value" :key="y.userId" :class="{ mine: y.userId === ctx!.me.id, picked: y.userId === member, dim: !y.count }">
              <td><a href="#" class="plain" :title="t('expeditions.onlyThisPlayer')" @click.prevent="pickMember(y.userId)">{{ y.name }}</a></td>
              <td class="num">{{ fmt(y.count) }}</td>
              <td class="num" :class="posClass(y.metal)">{{ fmt(y.metal) }}</td>
              <td class="num" :class="posClass(y.crystal)">{{ fmt(y.crystal) }}</td>
              <td class="num" :class="posClass(y.deut)">{{ fmt(y.deut) }}</td>
              <td class="num" :class="posClass(y.shipPoints)">{{ fmt(y.shipPoints) }}</td>
              <td class="num strong" :class="posClass(y.points)">{{ fmt(y.points) }}</td>
              <td class="num muted">{{ y.perExpo != null ? fmt(y.perExpo) : '' }}</td>
            </tr>
          </tbody>
          <tfoot v-if="yields.length > 1">
            <tr>
              <th>{{ t('raids.allianceTotal') }}</th>
              <th class="num">{{ fmt(yieldTotal.count) }}</th>
              <th class="num">{{ fmt(yieldTotal.metal) }}</th>
              <th class="num">{{ fmt(yieldTotal.crystal) }}</th>
              <th class="num">{{ fmt(yieldTotal.deut) }}</th>
              <th class="num">{{ fmt(yieldTotal.shipPoints) }}</th>
              <th class="num">{{ fmt(yieldTotal.points) }}</th>
              <th class="num">{{ yieldTotal.count ? fmt(yieldTotal.points / yieldTotal.count) : '' }}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>

    <Section data-tour="expo-distribution" :title="`${t('expeditions.distribution')} · ${memberLabel}`" :card="false" :level="2" store-key="expos.distribution">
      <div v-if="!columns.length" class="card muted">{{ t('expeditions.empty') }}</div>
      <div v-else class="table-wrap flat">
        <table v-stack class="data dist">
          <thead>
            <tr>
              <th class="sortable" @click="distSort.sortBy('event')">{{ t('expeditions.event') }}<SortMark :dir="distSort.direction('event')" /></th>
              <th class="sortable num" @click="distSort.sortBy('deck')">{{ t('expeditions.deckPct') }}<SortMark :dir="distSort.direction('deck')" /></th>
              <th v-for="u in columns" :key="u.username" class="sortable num" @click="distSort.sortBy(`u${u.userId}`)">
                {{ u.username }}<span v-if="u.userId === ctx!.me.id" class="faint small"> {{ t('raids.you') }}</span><SortMark :dir="distSort.direction(`u${u.userId}`)" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="{ k } in distSort.sorted.value" :key="k">
              <td>{{ cardLabel(k) }}</td>
              <td class="num muted">{{ fmt(pct(data.expected[k], data.deckSize), 1) }}</td>
              <td v-for="u in columns" :key="u.username" class="num" :style="devStyle(pct(u.events[k] ?? 0, u.total), pct(data.expected[k], data.deckSize))">
                {{ u.events[k] ?? 0 }} <span class="faint small">({{ fmt(pct(u.events[k] ?? 0, u.total), 1) }}%)</span>
              </td>
            </tr>
          </tbody>
          <!-- sums stay below the sorted rows -->
          <tfoot>
            <tr>
              <th>{{ t('common.total') }}</th>
              <th />
              <th v-for="u in columns" :key="u.username" class="num">{{ u.total }}</th>
            </tr>
            <tr>
              <td>{{ t('game.events.Res') }}</td>
              <td />
              <td v-for="u in columns" :key="u.username" class="num" :title="Object.entries(u.resources).map(([id, n]) => `${name(id)}: ${fmt(n as number)}`).join('\n')">
                {{ short(sumRes(u)) }}
              </td>
            </tr>
            <tr>
              <td>{{ t('game.events.Ships') }}</td>
              <td />
              <td v-for="u in columns" :key="u.username" class="num small">
                <div v-for="(n, id) in u.ships" :key="id">{{ name(id) }}: {{ fmt(n) }}</div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>

    <Section data-tour="expo-recent" :title="`${t('expeditions.recent')} · ${memberLabel}`" :count="list.length" :card="false" :level="2" store-key="expos.recent">
      <div v-if="!list.length" class="card muted">{{ t('expeditions.empty') }}</div>
      <template v-else>
        <SortBar v-if="mobile" v-model:desc="listDesc" :sort-key="listKey" :options="listOptions" @sort="listSort.sortBy" />
        <div class="table-wrap">
          <table v-stack="3" class="data">
            <thead>
              <tr>
                <th class="sortable" @click="listSort.sortBy('time')">{{ t('common.time') }}<SortMark :dir="listSort.direction('time')" /></th>
                <th class="sortable" @click="listSort.sortBy('player')">{{ t('common.player') }}<SortMark :dir="listSort.direction('player')" /></th>
                <th class="sortable" @click="listSort.sortBy('target')">{{ t('hostile.target') }}<SortMark :dir="listSort.direction('target')" /></th>
                <th class="sortable" @click="listSort.sortBy('event')">{{ t('expeditions.event') }}<SortMark :dir="listSort.direction('event')" /></th>
                <th>{{ t('expeditions.depletion') }}</th>
                <th class="sortable" :title="t('expeditions.foundTitle')" @click="listSort.sortBy('found')">{{ t('expeditions.found') }}<SortMark :dir="listSort.direction('found')" /></th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in listLimit.shown.value" :key="e.id">
                <td class="small">{{ dateTime(e.time) }}</td>
                <td>{{ e.username }}</td>
                <td class="mono">{{ e.g ? coords(e.g, e.s, e.p) : '' }}</td>
                <td>
                  {{ cardLabel(`${e.event}:${e.size}`) }}<span v-if="e.factor" class="faint"> ×{{ e.factor }}</span>
                  <span v-if="isManual(e)" class="badge" :title="t('expeditions.manualTitle')">{{ t('expeditions.manual') }}</span>
                </td>
                <td class="small muted">{{ e.depletion ? DEPLETION_LABEL[e.depletion] ?? e.depletion : '?' }}</td>
                <td class="small">
                  <span v-for="(n, id) in e.found_resources" :key="'r' + id">{{ name(id) }} {{ fmt(n) }} </span>
                  <span v-for="(n, id) in e.found_ships" :key="'s' + id">{{ name(id) }} {{ fmt(n) }} </span>
                </td>
                <td>
                  <button v-if="isManual(e) && e.user_id === ctx!.me.id" class="small" :title="t('expeditions.deleteTitle')" @click="removeManual(e)">{{ t('common.delete') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ShowMore :limit="listLimit" />
      </template>
    </Section>
  </template>
</template>

<style scoped>
.toolbar { margin-bottom: 4px; }
table.yields tr.mine td { background: var(--accent-soft); }
table.yields td.strong { font-weight: 600; }
table.data tfoot th { color: var(--text); }
/* desktop only: the stacked mobile cards have their own separators */
@media (min-width: 801px) {
  table.yields tr.picked td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
  table.data tfoot tr:first-child th { border-top: 2px solid var(--border-strong); }
}
a.plain { color: var(--text); }
a.plain:hover { color: var(--accent); }
</style>
