<script setup lang="ts">
import Hint from './Hint.vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import type { Ranking } from '../apiTypes';
import { useStored, useUni } from '../composables';
import { fmt, numDate } from '../format';
import { tables, useLiveReload } from '../live';

/**
 * Health page, tab "Ranking": the members' sync points of this week (Monday to today), last week or the last 30 days
 * (server: `ranking`); the tooltip of a row splits its points by kind.
 */
type Period = Ranking['period'];
const PERIODS: Period[] = ['week', 'lastWeek', 'days30'];
const { t } = useI18n();
const { uni, ctx } = useUni();
const period = useStored<Period>('health.rankingPeriod', 'week');
const data = ref<Ranking | null>(null);

async function load() {
  try {
    data.value = await uniApi<Ranking>(uni.value, `/ranking?period=${PERIODS.includes(period.value) ? period.value : 'week'}`);
  } catch {
    data.value = null;
  }
}
watch(period, load, { immediate: true });
useLiveReload(load, tables('galaxy_systems', 'spy_reports', 'battle_reports', 'expeditions', 'empire', 'overview', 'fleets', 'player_scores', 'market_rates'), 5000);

/** a day of the period (YYYY-MM-DD) in the viewer's date format */
const day = (d: string) => numDate(new Date(`${d}T12:00:00`), 'short');
const top = computed(() => Math.max(1, ...(data.value?.rows ?? []).map((r) => r.points)));
/** rank by points: the same points share a rank */
const ranked = computed(() => {
  let last = -1;
  let rank = 0;
  return (data.value?.rows ?? []).map((r, i) => {
    if (r.points !== last) rank = i + 1;
    last = r.points;
    return { ...r, rank };
  });
});
const KINDS = ['galaxy', 'spy', 'empire', 'overview', 'hostile', 'battle', 'buildings', 'research', 'market', 'expedition', 'messages', 'stats', 'statsFirst'] as const;
const partsTitle = (parts: Record<string, number>) =>
  KINDS.filter((k) => parts[k]).map((k) => `${t(`ranking.kinds.${k}`)}: ${fmt(parts[k])}`).join('\n') || t('ranking.none');
const pointsHelp = computed(() => KINDS.map((k) => t(`ranking.points.${k}`)).join(' · '));
</script>

<template>
  <div class="card row" data-tour="health-ranking-period">
    <div class="seg">
      <button v-for="p in PERIODS" :key="p" :class="{ active: period === p }" @click="period = p">{{ t(`ranking.period.${p}`) }}</button>
    </div>
    <span v-if="data" class="muted small">{{ day(data.from) }} – {{ day(data.to) }}</span>
    <span class="grow" />
    <Hint><p>{{ t('ranking.hint') }}</p><p class="small">{{ pointsHelp }}</p></Hint>
  </div>
  <div v-if="!data" class="card muted">…</div>
  <div v-else class="card" data-tour="health-ranking-list">
    <ol class="rk-list">
      <li v-for="r in ranked" :key="r.userId" :class="{ me: r.userId === ctx?.me.id, zero: !r.points }" :title="partsTitle(r.parts)">
        <span class="rk-rank mono">{{ r.points ? r.rank : '–' }}</span>
        <span class="rk-name">{{ r.name }}</span>
        <span class="rk-bar"><span :style="{ width: `${(100 * r.points) / top}%` }" /></span>
        <span class="rk-points mono">{{ fmt(r.points) }}</span>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.rk-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.rk-list li { display: grid; grid-template-columns: 2.5em minmax(90px, 180px) 1fr 5em; align-items: center; gap: 10px; cursor: help; }
.rk-list li.me .rk-name { color: var(--accent); font-weight: 600; }
.rk-list li.zero { opacity: 0.55; }
.rk-rank { text-align: right; color: var(--muted); }
.rk-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rk-bar { height: 8px; border-radius: 4px; background: var(--border); overflow: hidden; }
.rk-bar span { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
.rk-points { text-align: right; }
</style>
