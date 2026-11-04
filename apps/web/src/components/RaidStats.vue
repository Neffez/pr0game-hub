<script setup lang="ts">
/**
 * Raid statistics (tab of the raid page): battle reports, recycling and interplanetary missile attacks of the members
 * in a time range, for the whole alliance or one member.
 */
import { unitCost } from '@pr0hub/core/units';
import { nowSec } from '../clock';
import ShowMore from './ShowMore.vue';
import MemberSelect from './MemberSelect.vue';
import Section from './Section.vue';
import Hint from './Hint.vue';
import SortBar from './SortBar.vue';
import SortMark from './SortMark.vue';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import RangePicker from './RangePicker.vue';
import { useLoader, useStored, useUni, useMobile, useSort, vStack, useLimit } from '../composables';
import { tables, useLiveReload } from '../live';
import { coords, dateTime, fmt, name, short } from '../format';
import { units } from '../units';

const { t, te } = useI18n();
const { uni, ctx } = useUni();
/** Column headers are hidden in the stacked mobile tables: a sort selection instead. */
const mobile = useMobile();
const days = useStored('raids.days', 7);
/** null = whole alliance, otherwise one member */
const member = useStored<number | null>('raids.member', null);

const { data, error, load } = useLoader<any>(() => uniApi(uni.value, `/raids?from=${nowSec() - days.value * 86400}`));
onMounted(load);
useLiveReload(load, tables('battle_reports', 'combat_reports', 'recycle_reports', 'missile_impacts'));
watch(days, load);

const total = (u: any) => u.metal + u.crystal + u.deuterium;
/** Links to the battle report like the battle hall: in the game (its report id) and the locally archived copy. */
const gameUrl = computed(() => ctx.value?.universe.settings.gameUrl?.replace(/\/?$/, '/') ?? '');
const inGame = (r: any) => !!gameUrl.value && /^[0-9a-f]{32}$/i.test(r.report_id ?? '');
const reportLink = (r: any) => `${gameUrl.value}game.php?page=raport&raport=${r.report_id}`;

const perUserRows = computed(() => (data.value?.perUser ?? []).filter((u: any) => member.value == null || u.userId === member.value));
const perUserSort = useSort<any>(
  perUserRows,
  (u, k) => (k === 'name' ? u.username : k === 'total' ? total(u) : k === 'perRaid' ? total(u) / u.raids : u[k]),
  'total',
);
const perUser = perUserSort.sorted;
const reports = computed(() => (data.value?.reports ?? []).filter((r: any) => member.value == null || r.user_id === member.value));
/** Sum over the shown members (alliance total). */
const sum = computed(() =>
  perUser.value.reduce(
    (s, u) => ({
      raids: s.raids + u.raids, metal: s.metal + u.metal, crystal: s.crystal + u.crystal,
      deuterium: s.deuterium + u.deuterium, lost: s.lost + u.lost, debris: s.debris + u.debris,
    }),
    { raids: 0, metal: 0, crystal: 0, deuterium: 0, lost: 0, debris: 0 },
  ),
);

// recycling reports (debris collected by the members' recyclers)
const shown = (userId: number) => member.value == null || userId === member.value;
const recyclerRows = computed(() => (data.value?.recyclePerUser ?? []).filter((u: any) => shown(u.userId)));
const recyclerSort = useSort<any>(
  recyclerRows,
  (u, k) => (k === 'name' ? u.username : k === 'total' ? u.metal + u.crystal : k === 'perRun' ? (u.metal + u.crystal) / u.runs : u[k]),
  'total',
);
const recyclers = recyclerSort.sorted;
const recycling = computed(() => (data.value?.recycling ?? []).filter((r: any) => shown(r.user_id)));
/** Long report lists: the newest 20 first. */
const reportSort = useSort<any>(
  reports,
  (r, k) => {
    if (k === 'player') return r.username;
    if (k === 'target') return r.g * 1e6 + r.s * 100 + r.p;
    if (k === 'outcome') return r.defense ? 'defense' : (r.outcome ?? null);
    if (k === 'loot') return r.loot_metal + r.loot_crystal + r.loot_deuterium;
    if (k === 'debris') return r.debris_metal + r.debris_crystal;
    return r[k === 'time' ? 'time' : k === 'lostA' ? 'lost_attacker' : 'lost_defender'];
  },
  'time',
);
const recyclingSort = useSort<any>(
  recycling,
  (r, k) => {
    if (k === 'time') return r.time ?? r.created_at;
    if (k === 'player') return r.username;
    if (k === 'target') return r.g * 1e6 + r.s * 100 + r.p;
    if (k === 'before') return r.total_metal + r.total_crystal;
    if (k === 'rest') return Math.max(0, r.total_metal - r.metal) + Math.max(0, r.total_crystal - r.crystal);
    return r[k];
  },
  'time',
);
const reportsLimit = useLimit<any>(reportSort.sorted);
const recyclingLimit = useLimit<any>(recyclingSort.sorted);
const recycleSum = computed(() =>
  recyclers.value.reduce(
    (s, u) => ({ runs: s.runs + u.runs, metal: s.metal + u.metal, crystal: s.crystal + u.crystal, left: s.left + u.left }),
    { runs: 0, metal: 0, crystal: 0, left: 0 },
  ),
);
/** Sort selection of the stacked mobile tables (same columns as the headers). */
const opts = (list: [string, string][]) => computed(() => list.map(([key, label]) => ({ key, label })));
const perUserOptions = opts([['name', t('common.player')], ['raids', t('raids.count')], ['metal', name(901)], ['crystal', name(902)], ['deuterium', t('game.deutShort')], ['total', t('common.total')], ['perRaid', t('raids.perRaid')], ['lost', t('raids.losses')], ['debris', t('game.debrisShort')]]);
const reportOptions = opts([['time', t('common.time')], ['player', t('common.player')], ['target', t('hostile.target')], ['outcome', t('raids.result')], ['loot', t('raids.loot')], ['lostA', t('raids.lostAttacker')], ['lostD', t('raids.lostDefender')], ['debris', t('game.debrisShort')]]);
const recyclerOptions = opts([['name', t('common.player')], ['runs', t('raids.runs')], ['metal', name(901)], ['crystal', name(902)], ['total', t('common.total')], ['perRun', t('raids.perRun')], ['left', t('raids.leftInDebris')]]);
const recyclingOptions = opts([['time', t('common.time')], ['player', t('common.player')], ['target', t('combat.debris')], ['metal', name(901)], ['crystal', name(902)], ['before', t('raids.debrisBefore')], ['rest', t('raids.rest')]]);
const missileUserOptions = opts([['name', t('common.player')], ['attacks', t('raids.missileAttacks')], ['fired', t('raids.missilesFired')], ['intercepted', t('raids.intercepted')], ['units', t('raids.destroyedUnits')], ['value', t('raids.destroyedValue')], ['perMissile', t('raids.perMissile')]]);
const missileOptions = opts([['time', t('common.time')], ['player', t('common.player')], ['target', t('hostile.target')], ['count', t('raids.missilesFired')], ['result', t('raids.result')], ['destroyed', t('raids.destroyed')], ['value', t('raids.destroyedValue')]]);
const browseLink = (r: any) => ({ path: `/${uni.value}/browse`, query: { g: r.g, s: r.s } });

// interplanetary missile attacks: the destroyed units valued at their costs in the open universe
type Losses = Record<string, number> | null;
const value = (losses: Losses) => {
  void units.value; // recomputed when the universe's units change
  return Object.entries(losses ?? {}).reduce((s, [id, n]) => s + (unitCost(id) ?? [0, 0, 0]).reduce((a, b) => a + b, 0) * n, 0);
};
const unitCount = (losses: Losses) => Object.values(losses ?? {}).reduce((a, b) => a + b, 0);
const lossList = (losses: Losses) => Object.entries(losses ?? {}).map(([id, n]) => `${name(id)} −${fmt(n)}`).join(', ');
const missileRows = computed(() =>
  (data.value?.missilePerUser ?? [])
    .filter((u: any) => shown(u.userId))
    .map((u: any) => ({ ...u, units: unitCount(u.losses), value: value(u.losses) })),
);
const missileUserSort = useSort<any>(
  missileRows,
  (u, k) => (k === 'name' ? u.username : k === 'perMissile' ? (u.fired ? u.value / u.fired : null) : u[k]),
  'value',
);
const missileUsers = missileUserSort.sorted;
const missiles = computed(() => (data.value?.missiles ?? []).filter((r: any) => shown(r.user_id)));
const missileSort = useSort<any>(
  missiles,
  (r, k) => {
    if (k === 'time') return r.time ?? r.created_at;
    if (k === 'player') return r.username;
    if (k === 'target') return r.g * 1e6 + r.s * 100 + r.p;
    if (k === 'result') return r.result;
    if (k === 'destroyed') return unitCount(r.losses);
    if (k === 'value') return value(r.losses);
    return r[k];
  },
  'time',
);
const missilesLimit = useLimit<any>(missileSort.sorted);
const missileSum = computed(() =>
  missileUsers.value.reduce(
    (s, u) => ({
      attacks: s.attacks + u.attacks, fired: s.fired + u.fired, known: s.known + u.known, intercepted: s.intercepted + u.intercepted,
      units: s.units + u.units, value: s.value + u.value,
    }),
    { attacks: 0, fired: 0, known: 0, intercepted: 0, units: 0, value: 0 },
  ),
);
/** Intercepted missiles as a share of those with a known result. */
const interceptRate = (u: { known: number; intercepted: number }) => (u.known ? `${Math.round((u.intercepted / u.known) * 100)} %` : '–');
const targetLink = (r: any) => ({ path: `/${uni.value}/spy`, query: { c: `${r.g}:${r.s}:${r.p}` } });
</script>

<template>
  <div class="card row" data-tour="raids-stats-filter">
    <RangePicker v-model="days" />
    <MemberSelect v-model="member" :all-label="t('raids.wholeAlliance')" />
  </div>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="data">
    <Section data-tour="raids-stats-players" :title="t('raids.perPlayer')" :card="false" :level="2" store-key="raids.players">
    <SortBar v-if="mobile" v-model:desc="perUserSort.descending.value" :sort-key="perUserSort.key.value" :options="perUserOptions" @sort="perUserSort.sortBy" />
    <div class="table-wrap flat">
      <table v-stack class="data">
        <thead>
          <tr><th class="sortable" @click="perUserSort.sortBy('name')">{{ t('common.player') }}<SortMark :dir="perUserSort.direction('name')" /></th><th class="sortable num" @click="perUserSort.sortBy('raids')">{{ t('raids.count') }}<SortMark :dir="perUserSort.direction('raids')" /></th><th class="sortable num" @click="perUserSort.sortBy('metal')">{{ name(901) }}<SortMark :dir="perUserSort.direction('metal')" /></th><th class="sortable num" @click="perUserSort.sortBy('crystal')">{{ name(902) }}<SortMark :dir="perUserSort.direction('crystal')" /></th><th class="sortable num" @click="perUserSort.sortBy('deuterium')">{{ t('game.deutShort') }}<SortMark :dir="perUserSort.direction('deuterium')" /></th><th class="sortable num" @click="perUserSort.sortBy('total')">{{ t('common.total') }}<SortMark :dir="perUserSort.direction('total')" /></th><th class="sortable num" @click="perUserSort.sortBy('perRaid')">{{ t('raids.perRaid') }}<SortMark :dir="perUserSort.direction('perRaid')" /></th><th class="sortable num" @click="perUserSort.sortBy('lost')">{{ t('raids.losses') }}<SortMark :dir="perUserSort.direction('lost')" /></th><th class="sortable num" @click="perUserSort.sortBy('debris')">{{ t('game.debrisShort') }}<SortMark :dir="perUserSort.direction('debris')" /></th></tr>
        </thead>
        <tbody>
          <tr v-for="u in perUser" :key="u.username">
            <td>{{ u.username }}<span v-if="u.userId === ctx!.me.id" class="faint small"> {{ t('raids.you') }}</span></td>
            <td class="num">{{ u.raids }}</td>
            <td class="num">{{ short(u.metal) }}</td>
            <td class="num">{{ short(u.crystal) }}</td>
            <td class="num">{{ short(u.deuterium) }}</td>
            <td class="num"><b>{{ short(total(u)) }}</b></td>
            <td class="num">{{ short(total(u) / u.raids) }}</td>
            <td class="num neg">{{ short(u.lost) }}</td>
            <td class="num">{{ short(u.debris) }}</td>
          </tr>
          <tr v-if="perUser.length > 1" style="font-weight: 600">
            <td>{{ t('raids.allianceTotal') }}</td>
            <td class="num">{{ sum.raids }}</td>
            <td class="num">{{ short(sum.metal) }}</td>
            <td class="num">{{ short(sum.crystal) }}</td>
            <td class="num">{{ short(sum.deuterium) }}</td>
            <td class="num">{{ short(total(sum)) }}</td>
            <td class="num">{{ sum.raids ? short(total(sum) / sum.raids) : '' }}</td>
            <td class="num neg">{{ short(sum.lost) }}</td>
            <td class="num">{{ short(sum.debris) }}</td>
          </tr>
          <tr v-if="!perUser.length"><td colspan="9" class="muted">{{ t('raids.noRaids') }}</td></tr>
        </tbody>
      </table>
    </div>
    </Section>

    <Section data-tour="raids-stats-reports" :title="t('raids.reports')" :count="reports.length" :card="false" :level="2" store-key="raids.reports">
    <SortBar v-if="mobile" v-model:desc="reportSort.descending.value" :sort-key="reportSort.key.value" :options="reportOptions" @sort="reportSort.sortBy" />
    <div class="table-wrap">
      <table v-stack="3" class="data">
        <thead>
          <tr><th class="sortable" @click="reportSort.sortBy('time')">{{ t('common.time') }}<SortMark :dir="reportSort.direction('time')" /></th><th class="sortable" @click="reportSort.sortBy('player')">{{ t('common.player') }}<SortMark :dir="reportSort.direction('player')" /></th><th class="sortable" @click="reportSort.sortBy('target')">{{ t('hostile.target') }}<SortMark :dir="reportSort.direction('target')" /></th><th class="sortable" @click="reportSort.sortBy('outcome')">{{ t('raids.result') }}<SortMark :dir="reportSort.direction('outcome')" /></th><th class="sortable num" @click="reportSort.sortBy('loot')">{{ t('raids.loot') }}<SortMark :dir="reportSort.direction('loot')" /></th><th class="sortable num" @click="reportSort.sortBy('lostA')">{{ t('raids.lostAttacker') }}<SortMark :dir="reportSort.direction('lostA')" /></th><th class="sortable num" @click="reportSort.sortBy('lostD')">{{ t('raids.lostDefender') }}<SortMark :dir="reportSort.direction('lostD')" /></th><th class="sortable num" @click="reportSort.sortBy('debris')">{{ t('game.debrisShort') }}<SortMark :dir="reportSort.direction('debris')" /></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in reportsLimit.shown.value" :key="r.id" :class="{ dim: r.defense }">
            <td class="small">{{ dateTime(r.time) }}</td>
            <td>{{ r.username }}</td>
            <td>
              <RouterLink class="mono" :to="{ path: `/${uni}/spy`, query: { c: `${r.g}:${r.s}:${r.p}`, type: r.planet_type } }">{{ coords(r.g, r.s, r.p) }}</RouterLink>
              <span v-if="r.target_player_name" class="muted small target-player">{{ r.target_player_name }}</span>
            </td>
            <td class="small">
              <span v-if="r.defense" class="muted">{{ t('raids.defense') }}</span>
              <span v-else-if="r.outcome" :class="r.outcome === 'win' ? 'pos' : r.outcome === 'lose' ? 'neg' : 'muted'">{{ te(`raids.outcome.${r.outcome}`) ? t(`raids.outcome.${r.outcome}`) : r.outcome }}</span>
            </td>
            <td class="num">{{ fmt(r.loot_metal + r.loot_crystal + r.loot_deuterium) }}</td>
            <td class="num">{{ fmt(r.lost_attacker) }}</td>
            <td class="num">{{ fmt(r.lost_defender) }}</td>
            <td class="num">{{ fmt(r.debris_metal + r.debris_crystal) }}</td>
            <td class="small">
              <a v-if="inGame(r)" :href="reportLink(r)" target="_blank" rel="noopener" :title="t('battleHall.reportInGame')">{{ t('battleHall.game') }}</a>
              <template v-if="r.archived"><template v-if="inGame(r)"> · </template><RouterLink :to="`/${uni}/battle-hall/${r.report_id}`" :title="t('battleHall.localTitle')">{{ t('battleHall.local') }}</RouterLink></template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ShowMore :limit="reportsLimit" />
    </Section>

    <Section data-tour="raids-stats-recycling" :title="t('raids.recycling')" :count="recycling.length" :card="false" :level="2" store-key="raids.recycling">
    <template #hint><Hint>{{ t('raids.recyclingHint') }}</Hint></template>
    <SortBar v-if="mobile" v-model:desc="recyclerSort.descending.value" :sort-key="recyclerSort.key.value" :options="recyclerOptions" @sort="recyclerSort.sortBy" />
    <div class="table-wrap flat">
      <table v-stack class="data">
        <thead>
          <tr><th class="sortable" @click="recyclerSort.sortBy('name')">{{ t('common.player') }}<SortMark :dir="recyclerSort.direction('name')" /></th><th class="sortable num" @click="recyclerSort.sortBy('runs')">{{ t('raids.runs') }}<SortMark :dir="recyclerSort.direction('runs')" /></th><th class="sortable num" @click="recyclerSort.sortBy('metal')">{{ name(901) }}<SortMark :dir="recyclerSort.direction('metal')" /></th><th class="sortable num" @click="recyclerSort.sortBy('crystal')">{{ name(902) }}<SortMark :dir="recyclerSort.direction('crystal')" /></th><th class="sortable num" @click="recyclerSort.sortBy('total')">{{ t('common.total') }}<SortMark :dir="recyclerSort.direction('total')" /></th><th class="sortable num" @click="recyclerSort.sortBy('perRun')">{{ t('raids.perRun') }}<SortMark :dir="recyclerSort.direction('perRun')" /></th><th class="sortable num" @click="recyclerSort.sortBy('left')">{{ t('raids.leftInDebris') }}<SortMark :dir="recyclerSort.direction('left')" /></th></tr>
        </thead>
        <tbody>
          <tr v-for="u in recyclers" :key="u.username">
            <td>{{ u.username }}<span v-if="u.userId === ctx!.me.id" class="faint small"> {{ t('raids.you') }}</span></td>
            <td class="num">{{ u.runs }}</td>
            <td class="num">{{ short(u.metal) }}</td>
            <td class="num">{{ short(u.crystal) }}</td>
            <td class="num"><b>{{ short(u.metal + u.crystal) }}</b></td>
            <td class="num">{{ short((u.metal + u.crystal) / u.runs) }}</td>
            <td class="num muted">{{ short(u.left) }}</td>
          </tr>
          <tr v-if="recyclers.length > 1" style="font-weight: 600">
            <td>{{ t('raids.allianceTotal') }}</td>
            <td class="num">{{ recycleSum.runs }}</td>
            <td class="num">{{ short(recycleSum.metal) }}</td>
            <td class="num">{{ short(recycleSum.crystal) }}</td>
            <td class="num">{{ short(recycleSum.metal + recycleSum.crystal) }}</td>
            <td class="num">{{ recycleSum.runs ? short((recycleSum.metal + recycleSum.crystal) / recycleSum.runs) : '' }}</td>
            <td class="num muted">{{ short(recycleSum.left) }}</td>
          </tr>
          <tr v-if="!recyclers.length"><td colspan="7" class="muted">{{ t('raids.noRecycling') }}</td></tr>
        </tbody>
      </table>
    </div>

    <SortBar v-if="mobile && recycling.length" v-model:desc="recyclingSort.descending.value" :sort-key="recyclingSort.key.value" :options="recyclingOptions" @sort="recyclingSort.sortBy" />
    <div v-if="recycling.length" class="table-wrap">
      <table v-stack="3" class="data">
        <thead>
          <tr><th class="sortable" @click="recyclingSort.sortBy('time')">{{ t('common.time') }}<SortMark :dir="recyclingSort.direction('time')" /></th><th class="sortable" @click="recyclingSort.sortBy('player')">{{ t('common.player') }}<SortMark :dir="recyclingSort.direction('player')" /></th><th class="sortable" @click="recyclingSort.sortBy('target')">{{ t('combat.debris') }}<SortMark :dir="recyclingSort.direction('target')" /></th><th class="sortable num" @click="recyclingSort.sortBy('metal')">{{ name(901) }}<SortMark :dir="recyclingSort.direction('metal')" /></th><th class="sortable num" @click="recyclingSort.sortBy('crystal')">{{ name(902) }}<SortMark :dir="recyclingSort.direction('crystal')" /></th><th class="sortable num" @click="recyclingSort.sortBy('before')">{{ t('raids.debrisBefore') }}<SortMark :dir="recyclingSort.direction('before')" /></th><th class="sortable num" @click="recyclingSort.sortBy('rest')">{{ t('raids.rest') }}<SortMark :dir="recyclingSort.direction('rest')" /></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in recyclingLimit.shown.value" :key="r.id">
            <td class="small">{{ dateTime(r.time ?? r.created_at) }}</td>
            <td>{{ r.username }}</td>
            <td class="mono"><RouterLink :to="browseLink(r)" :title="t('activity.showInBrowser')">{{ coords(r.g, r.s, r.p) }}</RouterLink></td>
            <td class="num">{{ fmt(r.metal) }}</td>
            <td class="num">{{ fmt(r.crystal) }}</td>
            <td class="num muted">{{ fmt(r.total_metal + r.total_crystal) }}</td>
            <td class="num muted">{{ fmt(Math.max(0, r.total_metal - r.metal) + Math.max(0, r.total_crystal - r.crystal)) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <ShowMore :limit="recyclingLimit" />
    </Section>

    <Section data-tour="raids-stats-missiles" :title="t('raids.missiles')" :count="missiles.length" :card="false" :level="2" store-key="raids.missiles">
    <template #hint><Hint>{{ t('raids.missilesHint') }}</Hint></template>
    <SortBar v-if="mobile" v-model:desc="missileUserSort.descending.value" :sort-key="missileUserSort.key.value" :options="missileUserOptions" @sort="missileUserSort.sortBy" />
    <div class="table-wrap flat">
      <table v-stack class="data">
        <thead>
          <tr><th class="sortable" @click="missileUserSort.sortBy('name')">{{ t('common.player') }}<SortMark :dir="missileUserSort.direction('name')" /></th><th class="sortable num" @click="missileUserSort.sortBy('attacks')">{{ t('raids.missileAttacks') }}<SortMark :dir="missileUserSort.direction('attacks')" /></th><th class="sortable num" @click="missileUserSort.sortBy('fired')">{{ t('raids.missilesFired') }}<SortMark :dir="missileUserSort.direction('fired')" /></th><th class="sortable num" @click="missileUserSort.sortBy('intercepted')">{{ t('raids.intercepted') }}<SortMark :dir="missileUserSort.direction('intercepted')" /></th><th class="sortable num" @click="missileUserSort.sortBy('units')">{{ t('raids.destroyedUnits') }}<SortMark :dir="missileUserSort.direction('units')" /></th><th class="sortable num" @click="missileUserSort.sortBy('value')">{{ t('raids.destroyedValue') }}<SortMark :dir="missileUserSort.direction('value')" /></th><th class="sortable num" @click="missileUserSort.sortBy('perMissile')">{{ t('raids.perMissile') }}<SortMark :dir="missileUserSort.direction('perMissile')" /></th></tr>
        </thead>
        <tbody>
          <tr v-for="u in missileUsers" :key="u.username">
            <td>{{ u.username }}<span v-if="u.userId === ctx!.me.id" class="faint small"> {{ t('raids.you') }}</span></td>
            <td class="num">{{ u.attacks }}</td>
            <td class="num">{{ fmt(u.fired) }}</td>
            <td class="num">{{ fmt(u.intercepted) }} <span class="muted small">({{ interceptRate(u) }})</span></td>
            <td class="num">{{ fmt(u.units) }}</td>
            <td class="num"><b>{{ short(u.value) }}</b></td>
            <td class="num">{{ u.fired ? short(u.value / u.fired) : '' }}</td>
          </tr>
          <tr v-if="missileUsers.length > 1" style="font-weight: 600">
            <td>{{ t('raids.allianceTotal') }}</td>
            <td class="num">{{ missileSum.attacks }}</td>
            <td class="num">{{ fmt(missileSum.fired) }}</td>
            <td class="num">{{ fmt(missileSum.intercepted) }} <span class="muted small">({{ interceptRate(missileSum) }})</span></td>
            <td class="num">{{ fmt(missileSum.units) }}</td>
            <td class="num">{{ short(missileSum.value) }}</td>
            <td class="num">{{ missileSum.fired ? short(missileSum.value / missileSum.fired) : '' }}</td>
          </tr>
          <tr v-if="!missileUsers.length"><td colspan="7" class="muted">{{ t('raids.noMissiles') }}</td></tr>
        </tbody>
      </table>
    </div>

    <SortBar v-if="mobile && missiles.length" v-model:desc="missileSort.descending.value" :sort-key="missileSort.key.value" :options="missileOptions" @sort="missileSort.sortBy" />
    <div v-if="missiles.length" class="table-wrap">
      <table v-stack="3" class="data">
        <thead>
          <tr><th class="sortable" @click="missileSort.sortBy('time')">{{ t('common.time') }}<SortMark :dir="missileSort.direction('time')" /></th><th class="sortable" @click="missileSort.sortBy('player')">{{ t('common.player') }}<SortMark :dir="missileSort.direction('player')" /></th><th class="sortable" @click="missileSort.sortBy('target')">{{ t('hostile.target') }}<SortMark :dir="missileSort.direction('target')" /></th><th class="sortable num" @click="missileSort.sortBy('count')">{{ t('raids.missilesFired') }}<SortMark :dir="missileSort.direction('count')" /></th><th class="sortable" @click="missileSort.sortBy('result')">{{ t('raids.result') }}<SortMark :dir="missileSort.direction('result')" /></th><th class="sortable" @click="missileSort.sortBy('destroyed')">{{ t('raids.destroyed') }}<SortMark :dir="missileSort.direction('destroyed')" /></th><th class="sortable num" @click="missileSort.sortBy('value')">{{ t('raids.destroyedValue') }}<SortMark :dir="missileSort.direction('value')" /></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in missilesLimit.shown.value" :key="r.id" :class="{ dim: r.defense }">
            <td class="small">{{ dateTime(r.time ?? r.created_at) }}</td>
            <td>{{ r.username }}</td>
            <td>
              <RouterLink class="mono" :to="targetLink(r)">{{ coords(r.g, r.s, r.p) }}</RouterLink>
              <span v-if="r.target_player_name" class="muted small target-player">{{ r.target_player_name }}</span>
            </td>
            <td class="num">{{ fmt(r.count) }}</td>
            <td class="small">
              <span v-if="r.defense" class="muted">{{ t('raids.defense') }}: </span>
              <span v-if="r.result === 'intercepted'" class="neg">{{ t('raids.allIntercepted') }}</span>
              <span v-else-if="r.result === 'noDefense'" class="muted">{{ t('raids.noDefense') }}</span>
              <span v-else-if="r.result === 'hit'">{{ t('raids.interceptedN', { n: fmt(r.intercepted ?? 0) }) }}</span>
              <span v-else class="faint">–</span>
            </td>
            <td class="small">{{ lossList(r.losses) }}</td>
            <td class="num">{{ unitCount(r.losses) ? fmt(value(r.losses)) : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <ShowMore :limit="missilesLimit" />
    </Section>
  </template>
</template>

<style scoped>
.target-player { margin-left: 6px; }
</style>
