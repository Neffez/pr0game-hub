<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import Hint from './Hint.vue';
import PlayerLink from './PlayerLink.vue';
import { useLoader, useStored, useUni } from '../composables';
import { coords, dateTime, lootCalcUrl } from '../format';
import { tables, useLiveReload } from '../live';

/** An attack or hold to settle (`GET /settlements`). */
interface Entry {
  id: number;
  mission: 'attack' | 'hold';
  g: number;
  s: number;
  p: number;
  planet_type: 'planet' | 'moon';
  target_time: number;
  status: string;
  player_id: number | null;
  player_name: string | null;
  members: string[];
  battle: boolean;
  saved: { updated_at: number; updated_by: string | null; deliveries: number; done: number } | null;
}

const DAYS = [7, 30, 90];

const { t } = useI18n();
const { uni, ctx } = useUni();
const days = useStored('settlements.days', 30);
const { data, error, load } = useLoader<Entry[]>(() => uniApi(uni.value, `/settlements?days=${days.value}`));
onMounted(load);
watch(days, load);
useLiveReload(load, tables('raid_settlements', 'attack_plans', 'battle_reports', 'combat_reports'));

const calcUrl = computed(() => (ctx.value ? lootCalcUrl(ctx.value.universe.settings) : ''));
/** settled when every delivery is ticked off */
const settled = (e: Entry) => !!e.saved && e.saved.done >= e.saved.deliveries;
</script>

<template>
  <div class="row" style="margin-bottom: 12px">
    <span class="muted small">{{ t('loot.listHint') }}</span>
    <span class="grow" />
    <select v-model.number="days" :aria-label="t('loot.period')">
      <option v-for="d in DAYS" :key="d" :value="d">{{ t('loot.lastDays', { n: d }) }}</option>
    </select>
    <a v-if="calcUrl" class="small" :href="calcUrl" target="_blank" rel="noopener">{{ t('loot.calculatorPlain') }} ↗</a>
    <Hint>{{ t('loot.calculatorPlainHint') }}</Hint>
  </div>
  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !data.length" class="card muted">{{ t('loot.listEmpty') }}</div>
  <div v-else-if="data" class="card table-wrap">
    <table class="data">
      <thead>
        <tr>
          <th>{{ t('loot.when') }}</th>
          <th>{{ t('loot.target') }}</th>
          <th>{{ t('loot.kind') }}</th>
          <th>{{ t('loot.participants') }}</th>
          <th>{{ t('loot.report') }}</th>
          <th>{{ t('loot.state') }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in data" :key="e.id" :class="{ dim: settled(e) }">
          <td class="mono">{{ dateTime(e.target_time) }}</td>
          <td>
            <span class="mono">{{ coords(e.g, e.s, e.p) }}</span>
            <span v-if="e.planet_type === 'moon'" class="moon-tag">M</span>
            <PlayerLink v-if="e.player_id" :id="e.player_id" :name="e.player_name ?? '?'" />
          </td>
          <td><span class="badge" :class="{ 'mission-hold': e.mission === 'hold' }">{{ e.mission === 'hold' ? t('hold.badge') : t('loot.attack') }}</span></td>
          <td class="small">{{ e.members.join(', ') }}</td>
          <td :class="e.battle ? 'ok' : 'faint'">{{ e.battle ? '✓' : '–' }}</td>
          <td class="small">
            <template v-if="e.saved">
              <span v-if="!e.saved.deliveries" class="ok">{{ t('loot.noTransfers') }}</span>
              <span v-else :class="settled(e) ? 'ok' : 'warn'">{{ t('loot.deliveriesDone', { done: e.saved.done, n: e.saved.deliveries }) }}</span>
              <span class="faint"> · {{ e.saved.updated_by ?? '?' }}, {{ dateTime(e.saved.updated_at) }}</span>
            </template>
            <span v-else class="muted">{{ t('loot.notSaved') }}</span>
          </td>
          <td><RouterLink :to="`/${uni}/raid-planner/${e.id}/loot`">{{ t('loot.open') }}</RouterLink></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.badge.mission-hold { color: var(--pos); }
td .moon-tag { margin-left: 4px; }
</style>
