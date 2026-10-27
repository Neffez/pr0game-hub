<script setup lang="ts">
import Section from './Section.vue';
import Hint from './Hint.vue';
import Icon from './Icon.vue';
import DateTimeInput from './DateTimeInput.vue';
import { Chart, registerables, type ChartDataset } from 'chart.js';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { activityCurve, minuteOfDay, type ActivityEvent, type ActivitySource } from '../activity';
import { useLoader, useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';
import { dateTime } from '../format';
import { fromLocalInput, toLocalInput } from '../plans';
import { toast } from '../toast';

Chart.register(...registerables);

/** Activity pattern of a player over the day (player page), with the manual "online now" reports. */
const props = defineProps<{ player: number }>();
const { t, locale } = useI18n();
const { uni } = useUni();

const COLORS: Record<ActivitySource, string> = {
  spy: '#58a6ff', attack: '#f2683c', defense: '#d29922', message: '#a371f7', sync: '#56d4dd',
  galaxy: '#3fb950', fleet: '#ff7b72', recall: '#db61a2', manual: '#e6edf3', hub: '#8b98a9',
};
const CURVE = '#7c6cf0';

const days = useStored('player.activityDays', 7);
const { data, error, load } = useLoader(() => uniApi<{ from: number; events: ActivityEvent[] }>(uni.value, `/players/${props.player}/activity`));
const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

const shown = computed(() => {
  const from = Date.now() / 1000 - days.value * 86400;
  return (data.value?.events ?? []).filter((e) => e.time >= from);
});
const manual = computed(() => shown.value.filter((e) => e.source === 'manual').reverse());
const sourceLabel = (s: ActivitySource) => t(`player.activity.sources.${s}`);

function draw() {
  chart?.destroy();
  chart = null;
  if (!canvas.value || !shown.value.length) return;
  const curve = activityCurve(shown.value, Date.now() / 1000, days.value);
  const step = 24 / curve.length;
  const present = [...new Set(shown.value.map((e) => e.source))];
  const datasets: ChartDataset<'scatter', { x: number; y: number; e?: ActivityEvent }[]>[] = [
    {
      showLine: true,
      label: t('player.activity.title'),
      // closed over midnight: the value at 24:00 is the one at 00:00
      data: [...curve.map((y, i) => ({ x: (i + 0.5) * step, y })), { x: 24, y: curve[0] }, { x: 0, y: curve[0] }].sort((a, b) => a.x - b.x),
      borderColor: CURVE,
      backgroundColor: `${CURVE}55`,
      fill: 'origin',
      pointRadius: 0,
      tension: 0.3,
      borderWidth: 2,
    },
    // one tick per event below the curve
    ...present.map((source) => ({
      label: sourceLabel(source),
      data: shown.value.filter((e) => e.source === source).map((e) => ({ x: minuteOfDay(e.time) / 60, y: -0.06, e })),
      borderColor: COLORS[source],
      backgroundColor: COLORS[source],
      pointStyle: 'line' as const,
      rotation: 90,
      pointRadius: 7,
      pointHoverRadius: 9,
      borderWidth: 2,
    })),
  ];
  chart = new Chart(canvas.value, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 24,
          ticks: { color: '#8b98a9', stepSize: 3, callback: (v) => `${String(v).padStart(2, '0')}:00` },
          grid: { color: '#283241' },
        },
        y: { min: -0.12, max: 1.05, display: false },
      },
      plugins: {
        legend: { labels: { color: '#e6edf3', filter: (item) => item.datasetIndex! > 0 } },
        tooltip: {
          filter: (item) => item.datasetIndex > 0,
          callbacks: {
            title: (items) => {
              const e = (items[0]?.raw as { e?: ActivityEvent })?.e;
              return e ? dateTime(e.time) : '';
            },
            label: (item) => {
              const e = (item.raw as { e?: ActivityEvent }).e!;
              const parts = [sourceLabel(e.source)];
              if (e.spread >= 120) parts.push(t('player.activity.spread', { min: Math.round(e.spread / 60) }));
              if (e.reporter) parts.push(e.reporter);
              return parts.join(' · ');
            },
          },
        },
      },
    },
  });
}

async function reload() {
  await load();
  await nextTick();
  draw();
}

// manual report: now, or a time picked
const reporting = ref(false);
const pick = ref('');
function openReport() {
  pick.value = toLocalInput(Math.floor(Date.now() / 1000)).slice(0, 16);
  reporting.value = !reporting.value;
}
async function report(time: number | null) {
  try {
    await uniApi(uni.value, `/players/${props.player}/activity`, { method: 'POST', body: time == null ? {} : { time } });
    toast(t('player.activity.reported'));
    reporting.value = false;
    await reload();
  } catch (e) {
    toast((e as Error).message, 'warn');
  }
}
async function remove(e: ActivityEvent) {
  try {
    await uniApi(uni.value, `/players/${props.player}/activity/${e.id}`, { method: 'DELETE' });
    await reload();
  } catch (err) {
    toast((err as Error).message, 'warn');
  }
}

onMounted(reload);
watch(() => props.player, reload);
// the canvas is only there while the section is open
watch([days, locale, canvas], () => nextTick(draw));
useLiveReload(reload, tables('player_activity', 'hostile_spying', 'battle_hall', 'combat_reports', 'player_messages', 'galaxy_systems', 'fleets'));
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <Section :title="t('player.activity.title')" store-key="player.activity">
    <template #hint><Hint>{{ t('player.activity.hint') }} {{ t('player.activity.hintGalaxy') }}</Hint></template>
    <template #actions>
      <select v-model.number="days" :aria-label="t('time.range')">
        <option :value="1">{{ t('time.h24') }}</option>
        <option :value="7">{{ t('time.days', { n: 7 }) }}</option>
      </select>
      <button type="button" :aria-expanded="reporting" @click="openReport"><Icon name="plus" :size="13" /> {{ t('player.activity.report') }}</button>
    </template>

    <div v-if="reporting" class="row report">
      <button type="button" class="primary" @click="report(null)">{{ t('player.activity.now') }}</button>
      <span class="muted small">{{ t('player.activity.or') }}</span>
      <DateTimeInput v-model="pick" />
      <button type="button" :disabled="fromLocalInput(pick) == null" @click="report(fromLocalInput(pick))">{{ t('common.save') }}</button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>
    <p v-else-if="data && !shown.length" class="muted small m-0">{{ t('player.activity.empty') }}</p>
    <div v-show="shown.length" class="chart"><canvas ref="canvas" /></div>

    <div v-if="manual.length" class="manual small">
      <span class="muted">{{ t('player.activity.manual') }}:</span>
      <span v-for="e in manual" :key="e.id" class="chip">
        {{ dateTime(e.time) }} <span class="faint">{{ e.reporter }}</span>
        <button v-if="e.mine" type="button" class="icon-btn small" :title="t('player.activity.withdraw')" @click="remove(e)">
          <Icon name="close" :size="11" :label="t('player.activity.withdraw')" />
        </button>
      </span>
    </div>
  </Section>
</template>

<style scoped>
.chart { height: 220px; }
.report { margin-bottom: 10px; }
.manual { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.manual .chip { display: inline-flex; align-items: center; gap: 6px; }
</style>
