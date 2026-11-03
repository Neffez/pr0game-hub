<script setup lang="ts">
/**
 * Raid statistics (tab of the raid page): battle reports, recycling and interplanetary missile attacks of the members
 * in a time range, for the whole alliance or one member.
 */
import { unitCost } from '@pr0hub/core/units';
import { nowSec } from '../clock';
import ShowMore from './ShowMore.vue';
import MemberSelect from './MemberSelect.vue';
import Hint from './Hint.vue';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import RangePicker from './RangePicker.vue';
import { useLoader, useStored, useUni, vStack, useLimit } from '../composables';
import { tables, useLiveReload } from '../live';
import { coords, dateTime, fmt, name, short } from '../format';
import { units } from '../units';

const { t, te } = useI18n();
const { uni, ctx } = useUni();
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

const perUser = computed(() =>
  [...(data.value?.perUser ?? [])].filter((u) => member.value == null || u.userId === member.value).sort((a, b) => total(b) - total(a)),
);
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
const recyclers = computed(() =>
  [...(data.value?.recyclePerUser ?? [])].filter((u: any) => shown(u.userId)).sort((a, b) => b.metal + b.crystal - (a.metal + a.crystal)),
);
const recycling = computed(() => (data.value?.recycling ?? []).filter((r: any) => shown(r.user_id)));
/** Long report lists: the newest 20 first. */
const reportsLimit = useLimit<any>(reports);
const recyclingLimit = useLimit<any>(recycling);
const recycleSum = computed(() =>
  recyclers.value.reduce(
    (s, u) => ({ runs: s.runs + u.runs, metal: s.metal + u.metal, crystal: s.crystal + u.crystal, left: s.left + u.left }),
    { runs: 0, metal: 0, crystal: 0, left: 0 },
  ),
);
const browseLink = (r: any) => ({ path: `/${uni.value}/browse`, query: { g: r.g, s: r.s } });

// interplanetary missile attacks: the destroyed units valued at their costs in the open universe
type Losses = Record<string, number> | null;
const value = (losses: Losses) => {
  void units.value; // recomputed when the universe's units change
  return Object.entries(losses ?? {}).reduce((s, [id, n]) => s + (unitCost(id) ?? [0, 0, 0]).reduce((a, b) => a + b, 0) * n, 0);
};
const unitCount = (losses: Losses) => Object.values(losses ?? {}).reduce((a, b) => a + b, 0);
const lossList = (losses: Losses) => Object.entries(losses ?? {}).map(([id, n]) => `${name(id)} −${fmt(n)}`).join(', ');
const missileUsers = computed(() =>
  [...(data.value?.missilePerUser ?? [])]
    .filter((u: any) => shown(u.userId))
    .map((u: any) => ({ ...u, units: unitCount(u.losses), value: value(u.losses) }))
    .sort((a, b) => b.value - a.value || b.fired - a.fired),
);
const missiles = computed(() => (data.value?.missiles ?? []).filter((r: any) => shown(r.user_id)));
const missilesLimit = useLimit<any>(missiles);
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
  <div class="card row">
    <RangePicker v-model="days" />
    <MemberSelect v-model="member" :all-label="t('raids.wholeAlliance')" />
  </div>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="data">
    <div class="table-wrap flat">
      <table v-stack class="data">
        <thead>
          <tr><th>{{ t('common.player') }}</th><th class="num">{{ t('raids.count') }}</th><th class="num">{{ name(901) }}</th><th class="num">{{ name(902) }}</th><th class="num">{{ t('game.deutShort') }}</th><th class="num">{{ t('common.total') }}</th><th class="num">{{ t('raids.perRaid') }}</th><th class="num">{{ t('raids.losses') }}</th><th class="num">{{ t('game.debrisShort') }}</th></tr>
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

    <h2>{{ t('raids.reports') }}</h2>
    <div class="table-wrap">
      <table v-stack="3" class="data">
        <thead>
          <tr><th>{{ t('common.time') }}</th><th>{{ t('common.player') }}</th><th>{{ t('hostile.target') }}</th><th></th><th class="num">{{ t('raids.loot') }}</th><th class="num">{{ t('raids.lostAttacker') }}</th><th class="num">{{ t('raids.lostDefender') }}</th><th class="num">{{ t('game.debrisShort') }}</th><th>{{ t('raids.report') }}</th></tr>
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

    <h2>
      {{ t('raids.recycling') }}
      <Hint>{{ t('raids.recyclingHint') }}</Hint>
    </h2>
    <div class="table-wrap flat">
      <table v-stack class="data">
        <thead>
          <tr><th>{{ t('common.player') }}</th><th class="num">{{ t('raids.runs') }}</th><th class="num">{{ name(901) }}</th><th class="num">{{ name(902) }}</th><th class="num">{{ t('common.total') }}</th><th class="num">{{ t('raids.perRun') }}</th><th class="num">{{ t('raids.leftInDebris') }}</th></tr>
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

    <div v-if="recycling.length" class="table-wrap">
      <table v-stack="3" class="data">
        <thead>
          <tr><th>{{ t('common.time') }}</th><th>{{ t('common.player') }}</th><th>{{ t('combat.debris') }}</th><th class="num">{{ name(901) }}</th><th class="num">{{ name(902) }}</th><th class="num">{{ t('raids.debrisBefore') }}</th><th class="num">{{ t('raids.rest') }}</th></tr>
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

    <h2>
      {{ t('raids.missiles') }}
      <Hint>{{ t('raids.missilesHint') }}</Hint>
    </h2>
    <div class="table-wrap flat">
      <table v-stack class="data">
        <thead>
          <tr><th>{{ t('common.player') }}</th><th class="num">{{ t('raids.missileAttacks') }}</th><th class="num">{{ t('raids.missilesFired') }}</th><th class="num">{{ t('raids.intercepted') }}</th><th class="num">{{ t('raids.destroyedUnits') }}</th><th class="num">{{ t('raids.destroyedValue') }}</th><th class="num">{{ t('raids.perMissile') }}</th></tr>
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

    <div v-if="missiles.length" class="table-wrap">
      <table v-stack="3" class="data">
        <thead>
          <tr><th>{{ t('common.time') }}</th><th>{{ t('common.player') }}</th><th>{{ t('hostile.target') }}</th><th class="num">{{ t('raids.missilesFired') }}</th><th>{{ t('raids.result') }}</th><th>{{ t('raids.destroyed') }}</th><th class="num">{{ t('raids.destroyedValue') }}</th></tr>
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
  </template>
</template>

<style scoped>
.target-player { margin-left: 6px; }
</style>
