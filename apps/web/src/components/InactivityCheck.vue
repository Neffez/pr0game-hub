<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { dateTime, fmt } from '../format';

/** Admin panel: how well the inactivity score fits the alliance's data (server: repo/inactivityCheck.ts). */
interface Check {
  generatedAt: number;
  weights: Record<string, number>;
  events: number;
  skipped: number;
  detection: { hours: number; n: number; likely: number; inactive: number; median: number | null }[];
  falseAlarms: { days: number; positives: number; contradicted: number; rate: number | null; examples: { playerId: number; name: string; time: number; score: number; activeAt: number }[] };
}

const props = defineProps<{ universe: string; groupId: number }>();
const { t } = useI18n();
const data = ref<Check | null>(null);
const busy = ref(false);
const error = ref('');

async function run(fresh: boolean) {
  busy.value = true;
  error.value = '';
  try {
    data.value = await api<Check>(`/${props.universe}/inactivity-check?group=${props.groupId}${fresh ? '&fresh=1' : ''}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)} %`);
const weights = computed(() =>
  data.value
    ? [
        `max ${data.value.weights.max}`,
        `tau ${Math.round(data.value.weights.tau / 3600)} h`,
        `weakGain ${pct(data.value.weights.weakGain)}`,
        `galaxy ×${data.value.weights.galaxyFactor}`,
        `idleSpy +${data.value.weights.idleSpyBonus}`,
        `losses +${data.value.weights.lossBonus}`,
      ].join(' · ')
    : '',
);
</script>

<template>
  <div>
    <div class="row">
      <button :disabled="busy" @click="run(!!data)">{{ busy ? t('inactivityCheck.running') : data ? t('inactivityCheck.again') : t('inactivityCheck.run') }}</button>
      <span v-if="data" class="small muted">{{ t('inactivityCheck.generated', { time: dateTime(data.generatedAt) }) }}</span>
    </div>
    <div v-if="error" class="error">{{ error }}</div>
    <template v-if="data">
      <h4>{{ t('inactivityCheck.detection') }}</h4>
      <p class="small muted">{{ t('inactivityCheck.events', { n: data.events, skipped: data.skipped }) }}</p>
      <div class="table-wrap">
        <table class="data" style="width: auto">
          <thead>
            <tr>
              <th>{{ t('inactivityCheck.after') }}</th>
              <th class="num">{{ t('inactivityCheck.players') }}</th>
              <th class="num">{{ t('inactivityCheck.likely') }}</th>
              <th class="num">{{ t('inactivityCheck.inactive') }}</th>
              <th class="num">{{ t('inactivityCheck.median') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in data.detection" :key="d.hours">
              <td>{{ d.hours }} h</td>
              <td class="num">{{ d.n }}</td>
              <td class="num">{{ d.n ? pct(d.likely) : '–' }}</td>
              <td class="num">{{ d.n ? pct(d.inactive) : '–' }}</td>
              <td class="num">{{ d.median ?? '–' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h4>{{ t('inactivityCheck.falseAlarms') }}</h4>
      <p class="small">
        {{ t('inactivityCheck.falseAlarmsText', { days: data.falseAlarms.days, positives: fmt(data.falseAlarms.positives), contradicted: fmt(data.falseAlarms.contradicted), rate: pct(data.falseAlarms.rate) }, data.falseAlarms.days) }}
      </p>
      <ul v-if="data.falseAlarms.examples.length" class="small">
        <li v-for="e in data.falseAlarms.examples" :key="`${e.playerId}:${e.time}`">
          {{ t('inactivityCheck.example', { name: e.name, score: e.score, time: dateTime(e.time), active: dateTime(e.activeAt) }) }}
        </li>
      </ul>
      <p class="small muted">{{ t('inactivityCheck.weights') }} {{ weights }}</p>
    </template>
  </div>
</template>
