<script setup lang="ts">
/**
 * Who threatens me (A-5, server: repo/threats.ts): the players who spied on or attacked the viewer, ranked, with the
 * trend of their fleet points, their nearest planet with the flight time and the hours they usually come at.
 */
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useLoader, useUni, vStack } from '../composables';
import { ago, coords, duration, fmt, fmtSigned, name as techName, short } from '../format';
import { tables, useLiveReload } from '../live';
import Countdown from './Countdown.vue';
import PlayerLink from './PlayerLink.vue';
import StatusBadges from './StatusBadges.vue';

type C = { g: number; s: number; p: number };
export interface Threat {
  key: string;
  player: { id: number | null; name: string; status: string[]; allyTag: string | null };
  score: number;
  spied: { count: number; last: number | null };
  attacked: { count: number; last: number | null };
  incoming: { count: number; next: number | null };
  fleetPoints: { points: number; time: number; before: { points: number; time: number } | null } | null;
  reach: { from: C; to: C; duration: number; ship: number; shipKnown: boolean; researchKnown: boolean } | null;
  planets: number;
  hours: number[];
  peak: { from: number; to: number; share: number } | null;
  targets: (C & { count: number })[];
}
interface Threats {
  days: number;
  timezone: string;
  ownPlanets: number;
  threats: Threat[];
  now: number;
}

const props = defineProps<{ days: number }>();
const { t } = useI18n();
const { uni } = useUni();
const { data, error, load } = useLoader<Threats>(() => uniApi(uni.value, `/threats?days=${props.days}`));
onMounted(load);
watch(() => props.days, load);
useLiveReload(load, tables('hostile_spying', 'combat_reports', 'fleets'));
defineExpose({ ready: computed(() => !!data.value) });

const pad = (h: number) => String(h).padStart(2, '0');
const peakText = (x: Threat) => (x.peak ? t('threats.peak', { from: pad(x.peak.from), to: pad(x.peak.to), share: Math.round(x.peak.share * 100) }) : '');
/** Bars of the day's histogram, the highest hour full height. */
const bars = (hours: number[]) => {
  const max = Math.max(1, ...hours);
  return hours.map((n) => Math.round((n / max) * 100));
};
const trend = (x: Threat) => (x.fleetPoints?.before ? x.fleetPoints.points - x.fleetPoints.before.points : null);
</script>

<template>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="data">
    <p v-if="!data.ownPlanets" class="card muted">{{ t('threats.noPlanets') }}</p>
    <p v-if="!data.threats.length" class="card muted">{{ t('threats.none') }}</p>
    <div v-else class="table-wrap" data-tour="threats-list">
      <table v-stack class="data">
        <thead>
          <tr>
            <th>{{ t('common.player') }}</th>
            <th class="num" data-tour="threats-events">{{ t('threats.spied') }}</th>
            <th class="num">{{ t('threats.attacked') }}</th>
            <th class="num hinted" data-tour="threats-fleet" :title="t('threats.fleetPointsHint')">{{ t('threats.fleetPoints') }}</th>
            <th class="hinted" data-tour="threats-reach" :title="t('threats.reachHint')">{{ t('threats.reach') }}</th>
            <th class="hinted" data-tour="threats-hours" :title="t('threats.hoursHint', { tz: data.timezone })">{{ t('threats.hours') }}</th>
            <th>{{ t('threats.targets') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in data.threats" :key="x.key">
            <td>
              <PlayerLink v-if="x.player.id != null" :id="x.player.id" :name="x.player.name" />
              <span v-else>{{ x.player.name }}</span>
              <span v-if="x.player.allyTag" class="muted"> [{{ x.player.allyTag }}]</span>
              <StatusBadges :status="x.player.status" />
              <div v-if="x.incoming.next != null" class="incoming">
                ⚔ {{ t('threats.incoming', x.incoming.count) }} <Countdown :to="x.incoming.next" />
              </div>
            </td>
            <td class="num">
              <template v-if="x.spied.count">{{ fmt(x.spied.count) }} <span class="muted small">{{ ago(x.spied.last) }}</span></template>
              <span v-else class="muted">–</span>
            </td>
            <td class="num">
              <template v-if="x.attacked.count"><b>{{ fmt(x.attacked.count) }}</b> <span class="muted small">{{ ago(x.attacked.last) }}</span></template>
              <span v-else class="muted">–</span>
            </td>
            <td class="num">
              <template v-if="x.fleetPoints">
                {{ short(x.fleetPoints.points) }}
                <span v-if="trend(x) != null" class="small" :class="trend(x)! > 0 ? 'up' : trend(x)! < 0 ? 'down' : 'muted'" :title="t('threats.since', { ago: ago(x.fleetPoints.before!.time) })">
                  {{ fmtSigned(trend(x)) }}
                </span>
              </template>
              <span v-else class="muted">–</span>
            </td>
            <td>
              <template v-if="x.reach">
                <span class="mono">{{ coords(x.reach.from.g, x.reach.from.s, x.reach.from.p) }} → {{ coords(x.reach.to.g, x.reach.to.s, x.reach.to.p) }}</span>
                <div class="small" :title="t(x.reach.researchKnown ? 'threats.reachKnown' : 'threats.reachGuess')">
                  {{ duration(x.reach.duration) }}
                  <span class="muted">{{ techName(x.reach.ship) }}{{ x.reach.shipKnown && x.reach.researchKnown ? '' : ' ≈' }}</span>
                </div>
              </template>
              <span v-else class="muted small">{{ t('threats.reachUnknown') }}</span>
            </td>
            <td>
              <div class="hours" :title="peakText(x)" role="img" :aria-label="peakText(x) || t('threats.hours')">
                <i v-for="(h, i) in bars(x.hours)" :key="i" :style="{ height: `${Math.max(h, 6)}%` }" :class="{ on: h > 0 }"></i>
              </div>
              <div v-if="x.peak" class="small">{{ peakText(x) }}</div>
            </td>
            <td class="mono small">
              <div v-for="c in x.targets.slice(0, 3)" :key="`${c.g}:${c.s}:${c.p}`">{{ coords(c.g, c.s, c.p) }} <span class="muted">×{{ c.count }}</span></div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>

<style scoped>
.incoming { color: var(--neg); font-weight: 600; font-size: 12px; }
.up { color: var(--neg); }
.down { color: var(--pos); }
/* column headers explained by their tooltip (a Hint inside would end up in the labels of the mobile cards) */
.hinted { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.hours { display: flex; align-items: flex-end; gap: 1px; height: 22px; width: 120px; }
.hours i { flex: 1; background: var(--border); border-radius: 1px; }
.hours i.on { background: var(--accent); }
</style>
