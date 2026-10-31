<script setup lang="ts">
import Sheet from './Sheet.vue';
import Icon from './Icon.vue';
import { computed, onMounted, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { uniApi } from '../api';
import Hint from './Hint.vue';
import PlayerLink from './PlayerLink.vue';
import { useLoader, useStored, useUni, vStack } from '../composables';
import { coords, dateTime, lootCalcUrl, resText } from '../format';
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
  saved: { updated_at: number; updated_by: string | null; finalized_at: number | null; deliveries: number; done: number } | null;
  /** open: older than a week, not checked; waiting: data missing; ready: complete; delivering/settled: finalized */
  stage: 'open' | 'waiting' | 'ready' | 'delivering' | 'settled';
  missing: number | null;
  /** 24 h after the last battle (game rule) */
  deadline: number | null;
  /** the viewer's open deliveries */
  mine: { from: string; to: string; sends: boolean; res: { m: number; k: number; d: number } }[];
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
/** A battle settled after the fact: the pasted report makes a done plan (or finds the one there), then its settlement opens. */
const router = useRouter();
const fromReport = reactive({ open: false, text: '', mission: '' as '' | 'attack' | 'hold', error: '', busy: false });
async function createFromReport() {
  fromReport.busy = true;
  fromReport.error = '';
  try {
    const res = await uniApi<{ id: number; existing: boolean }>(uni.value, '/settlements/from-report', {
      body: { text: fromReport.text, mission: fromReport.mission || undefined },
    });
    Object.assign(fromReport, { open: false, text: '', mission: '' });
    router.push({ path: `/${uni.value}/raid-planner/${res.id}/loot`, query: res.existing ? { existing: '1' } : {} });
  } catch (e) {
    fromReport.error = (e as Error).message;
  } finally {
    fromReport.busy = false;
  }
}
/** settled when it is finalized and every delivery is ticked off */
const settled = (e: Entry) => e.stage === 'settled';
const onlyMine = useStored('settlements.onlyMine', false);
const shown = computed(() => (onlyMine.value ? (data.value ?? []).filter((e) => e.mine.length) : (data.value ?? [])));
const STAGE_CLASS: Record<Entry['stage'], string> = { open: 'muted', waiting: 'warn', ready: 'ok', delivering: 'warn', settled: 'ok' };
/** time left until the deadline (open ones only) */
const left = (e: Entry) => {
  if (!e.deadline || e.stage === 'settled') return null;
  const s = e.deadline - Date.now() / 1000;
  return s <= 0 ? t('loot.deadlinePassed') : t('loot.deadlineLeft', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
};
</script>

<template>
  <div class="row" style="margin-bottom: 12px">
    <span class="muted small">{{ t('loot.listHint') }}</span>
    <span class="grow" />
    <label class="small row" style="gap: 4px"><input v-model="onlyMine" type="checkbox" /> {{ t('loot.onlyMine') }}</label>
    <select v-model.number="days" :aria-label="t('loot.period')">
      <option v-for="d in DAYS" :key="d" :value="d">{{ t('loot.lastDays', { n: d }) }}</option>
    </select>
    <a v-if="calcUrl" class="small" :href="calcUrl" target="_blank" rel="noopener">{{ t('loot.calculatorPlain') }} <Icon name="external" :size="12" /></a>
    <Hint>{{ t('loot.calculatorPlainHint') }}</Hint>
    <button class="primary" @click="fromReport.open = true">{{ t('loot.createFromReport') }}</button>
  </div>
  <Sheet v-model="fromReport.open" :title="t('loot.createFromReport')">
    <template #head><Hint>{{ t('loot.createFromReportHint') }}</Hint></template>
    <div class="from-report">
      <textarea v-model="fromReport.text" :placeholder="t('loot.pastePlaceholder')" />
      <label class="small">
        {{ t('loot.kind') }}
        <select v-model="fromReport.mission">
          <option value="">{{ t('loot.missionAuto') }}</option>
          <option value="attack">{{ t('loot.attack') }}</option>
          <option value="hold">{{ t('hold.badge') }}</option>
        </select>
      </label>
      <div v-if="fromReport.error" class="error">{{ fromReport.error }}</div>
    </div>
    <template #footer>
      <button @click="fromReport.open = false">{{ t('plans.cancelForm') }}</button>
      <button class="primary" :disabled="!fromReport.text.trim() || fromReport.busy" @click="createFromReport">{{ t('loot.createFromReportGo') }}</button>
    </template>
  </Sheet>
  <div v-if="error" class="error">{{ error }}</div>
  <div v-else-if="data && !shown.length" class="card muted">{{ t('loot.listEmpty') }}</div>
  <div v-else-if="data" class="table-wrap flat">
    <table v-stack class="data">
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
        <tr v-for="e in shown" :key="e.id" :class="{ dim: settled(e) }">
          <td class="mono">{{ dateTime(e.target_time) }}</td>
          <td>
            <span class="mono">{{ coords(e.g, e.s, e.p) }}</span>
            <span v-if="e.planet_type === 'moon'" class="moon-tag"><Icon name="moon" :size="12" :label="t('common.moon')" /></span>
            <PlayerLink v-if="e.player_id" :id="e.player_id" :name="e.player_name ?? '?'" />
          </td>
          <td><span class="badge" :class="{ 'mission-hold': e.mission === 'hold' }">{{ e.mission === 'hold' ? t('hold.badge') : t('loot.attack') }}</span></td>
          <td class="small">{{ e.members.join(', ') }}</td>
          <td :class="e.battle ? 'ok' : 'faint'"><Icon v-if="e.battle" name="check" :size="14" :label="t('common.yes')" /><template v-else>–</template></td>
          <td class="small">
            <span :class="STAGE_CLASS[e.stage]">{{ t(`loot.stage.${e.stage}`, { n: e.missing ?? 0 }, e.missing ?? 0) }}</span>
            <template v-if="e.saved?.finalized_at && e.saved.deliveries">
              · <span :class="settled(e) ? 'ok' : 'warn'">{{ t('loot.deliveriesDone', { done: e.saved.done, n: e.saved.deliveries }) }}</span>
            </template>
            <span v-else-if="e.saved && !e.saved.finalized_at" class="faint"> · {{ t('loot.liveCorrected') }}</span>
            <div v-if="left(e)" class="faint">{{ left(e) }}</div>
            <div v-for="(x, i) in e.mine" :key="i" class="mine">
              {{ x.sends ? t('loot.youSend', { to: x.to }) : t('loot.youGet', { from: x.from }) }} {{ resText(x.res) }}
            </div>
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
.mine { color: var(--warn); }
.from-report { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.from-report h3 { margin: 0; }
.from-report textarea { width: 100%; min-height: 120px; font-size: 12px; }
</style>
