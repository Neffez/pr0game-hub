<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { dateTime, fmt, short, STATS_SHORT } from '../format';

/** Admin panel: how well the inactivity score fits the alliance's data (server: repo/inactivityCheck.ts). */
interface Check {
  generatedAt: number;
  weights: Record<string, number>;
  events: number;
  skipped: number;
  narrowed: number;
  detection: { hours: number; n: number; likely: number; inactive: number; median: number | null }[];
  falseAlarms: Summary & {
    rate: number | null;
    causes: Record<string, number>;
    examples: {
      playerId: number; name: string; time: number; score: number; hours: number; activeAt: number; cause: string;
      gain: { size: number | null; ratio: number | null; categories: Record<string, number> } | null;
    }[];
  };
  endPhase: (Summary & { ended: number }) | null;
}
interface Summary {
  days: number;
  positives: number;
  players: number;
  horizons: { hours: number; contradicted: number; players: number; rate: number | null }[];
  bands: { band: string; positives: number; within: Record<string, number> }[];
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
const causeLabel = (c: string) => t(`inactivityCheck.cause.${c}`);
const causes = computed(() =>
  Object.entries(data.value?.falseAlarms.causes ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${causeLabel(c)} ${n}×`)
    .join(' · '),
);
/** Gain of an example: points, share of the median around the rank, categories that grew. */
const gainText = (g: NonNullable<Check['falseAlarms']['examples'][number]['gain']>) =>
  [
    g.size != null ? `+${short(g.size)}` : '',
    g.ratio != null ? t('inactivityCheck.ratio', { x: fmt(g.ratio, g.ratio < 10 ? 1 : 0) }) : '',
    Object.entries(g.categories).map(([c, n]) => `${STATS_SHORT[Number(c)]} +${short(n)}`).join(' '),
  ].filter(Boolean).join(' · ');
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
      <p class="small muted">{{ t('inactivityCheck.events', { n: data.events, skipped: data.skipped, narrowed: data.narrowed }) }}</p>
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
        {{ t('inactivityCheck.falseAlarmsText', { days: data.falseAlarms.days, positives: fmt(data.falseAlarms.positives), players: fmt(data.falseAlarms.players), rate: pct(data.falseAlarms.rate) }, data.falseAlarms.days) }}
      </p>
      <template v-for="part in [{ key: 'normal', s: data.falseAlarms }, ...(data.endPhase ? [{ key: 'end', s: data.endPhase }] : [])]" :key="part.key">
        <p v-if="part.key === 'end'" class="small warn">{{ t('inactivityCheck.endPhase', { time: dateTime(data.endPhase!.ended), days: part.s.days, positives: fmt(part.s.positives) }, part.s.days) }}</p>
        <div v-if="part.s.positives" class="table-wrap">
          <table class="data" style="width: auto">
            <thead>
              <tr>
                <th>{{ t('inactivityCheck.band') }}</th>
                <th class="num">{{ t('inactivityCheck.highScores') }}</th>
                <th v-for="h in part.s.horizons" :key="h.hours" class="num">{{ t('inactivityCheck.within', { h: h.hours }) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in part.s.bands" :key="b.band">
                <td>{{ b.band }} %</td>
                <td class="num">{{ fmt(b.positives) }}</td>
                <td v-for="h in part.s.horizons" :key="h.hours" class="num">
                  {{ b.positives ? `${fmt(b.within[h.hours] ?? 0)} (${pct((b.within[h.hours] ?? 0) / b.positives)})` : '–' }}
                </td>
              </tr>
              <tr class="total">
                <td>{{ t('inactivityCheck.all') }}</td>
                <td class="num">{{ fmt(part.s.positives) }}</td>
                <td v-for="h in part.s.horizons" :key="h.hours" class="num">{{ fmt(h.contradicted) }} ({{ pct(h.rate) }})</td>
              </tr>
              <tr>
                <td>{{ t('inactivityCheck.players') }}</td>
                <td class="num">{{ fmt(part.s.players) }}</td>
                <td v-for="h in part.s.horizons" :key="h.hours" class="num">{{ fmt(h.players) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-if="causes" class="small">{{ t('inactivityCheck.causes') }} {{ causes }}</p>
      <ul v-if="data.falseAlarms.examples.length" class="small">
        <li v-for="e in data.falseAlarms.examples" :key="`${e.playerId}:${e.time}`">
          {{ t('inactivityCheck.example', { name: e.name, score: e.score, time: dateTime(e.time), active: dateTime(e.activeAt), h: e.hours, cause: causeLabel(e.cause) }) }}
          <span v-if="e.gain" class="muted"> – {{ gainText(e.gain) }}</span>
        </li>
      </ul>
      <p class="small muted">{{ t('inactivityCheck.weights') }} {{ weights }}</p>
    </template>
  </div>
</template>
