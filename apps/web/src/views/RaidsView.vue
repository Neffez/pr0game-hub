<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import RangePicker from '../components/RangePicker.vue';
import { useLoader, useStored, useUni, vStack } from '../composables';
import { coords, dateTime, fmt, name, short } from '../format';

const { t, te } = useI18n();
const { uni, ctx } = useUni();
const days = useStored('raids.days', 7);
/** null = whole alliance, otherwise one member */
const member = useStored<number | null>('raids.member', null);

const { data, error, load } = useLoader<any>(() => uniApi(uni.value, `/raids?from=${Math.floor(Date.now() / 1000) - days.value * 86400}`));
onMounted(load);
watch(days, load);

const total = (u: any) => u.metal + u.crystal + u.deuterium;

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
const recycleSum = computed(() =>
  recyclers.value.reduce(
    (s, u) => ({ runs: s.runs + u.runs, metal: s.metal + u.metal, crystal: s.crystal + u.crystal, left: s.left + u.left }),
    { runs: 0, metal: 0, crystal: 0, left: 0 },
  ),
);
const browseLink = (r: any) => ({ path: `/${uni.value}/browse`, query: { g: r.g, s: r.s } });
</script>

<template>
  <h1>
    {{ t('nav.raids') }}
    <Hint>{{ t('raids.hint') }}</Hint>
  </h1>
  <div class="card row">
    <RangePicker v-model="days" />
    <label>
      {{ t('common.player') }}
      <select v-model="member">
        <option :value="null">{{ t('raids.wholeAlliance') }}</option>
        <option :value="ctx!.me.id">{{ t('raids.onlyMine') }}</option>
        <option v-for="m in ctx!.members.filter((x) => x.id !== ctx!.me.id)" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
    </label>
  </div>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="data">
    <div class="table-wrap" style="max-height: none; margin-bottom: 14px">
      <table v-stack class="data">
        <thead>
          <tr><th>{{ t('common.player') }}</th><th class="num">{{ t('nav.raids') }}</th><th class="num">{{ name(901) }}</th><th class="num">{{ name(902) }}</th><th class="num">{{ t('game.deutShort') }}</th><th class="num">{{ t('common.total') }}</th><th class="num">{{ t('raids.perRaid') }}</th><th class="num">{{ t('raids.losses') }}</th><th class="num">{{ t('game.debrisShort') }}</th></tr>
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
          <tr><th>{{ t('common.time') }}</th><th>{{ t('common.player') }}</th><th>{{ t('hostile.target') }}</th><th></th><th class="num">{{ t('raids.loot') }}</th><th class="num">{{ t('raids.lostAttacker') }}</th><th class="num">{{ t('raids.lostDefender') }}</th><th class="num">{{ t('game.debrisShort') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in reports" :key="r.id" :class="{ dim: r.defense }">
            <td class="small">{{ dateTime(r.time) }}</td>
            <td>{{ r.username }}</td>
            <td class="mono">
              <RouterLink :to="{ path: `/${uni}/spy`, query: { c: `${r.g}:${r.s}:${r.p}`, type: r.planet_type } }">{{ coords(r.g, r.s, r.p) }}</RouterLink>
            </td>
            <td class="small">
              <span v-if="r.defense" class="muted">{{ t('raids.defense') }}</span>
              <span v-else-if="r.outcome" :class="r.outcome === 'win' ? 'pos' : r.outcome === 'lose' ? 'neg' : 'muted'">{{ te(`raids.outcome.${r.outcome}`) ? t(`raids.outcome.${r.outcome}`) : r.outcome }}</span>
            </td>
            <td class="num">{{ fmt(r.loot_metal + r.loot_crystal + r.loot_deuterium) }}</td>
            <td class="num">{{ fmt(r.lost_attacker) }}</td>
            <td class="num">{{ fmt(r.lost_defender) }}</td>
            <td class="num">{{ fmt(r.debris_metal + r.debris_crystal) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>
      {{ t('raids.recycling') }}
      <Hint>{{ t('raids.recyclingHint') }}</Hint>
    </h2>
    <div class="table-wrap" style="max-height: none; margin-bottom: 14px">
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
          <tr v-for="r in recycling" :key="r.id">
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
  </template>
</template>
