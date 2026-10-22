<script setup lang="ts">
import { RESOURCES } from '@pr0hub/core/tech';
import { useI18n } from 'vue-i18n';
import { abbr, dateTime, fmt, name, short } from '../format';

/** Fleet movements of the game overview, next arrival first (empire view, alliance fleets). */
export interface FleetBody {
  coords: { g: number; s: number; p: number };
  type: 'planet' | 'moon' | 'debris' | null;
  name: string | null;
}
/** fleet of the overview's event list (server: FleetMovement plus the arrival) */
export interface Fleet {
  owner: 'own' | 'hostile' | 'foreign';
  player: string | null;
  missionName: string;
  phase: 'out' | 'return' | 'hold';
  from: FleetBody;
  to: FleetBody | null;
  ships: Record<string, number>;
  resources: Record<string, number> | null;
  arrival: number;
}

defineProps<{
  /** fleets in flight, sorted; `member` names the owner in the alliance list */
  fleets: (Fleet & { member?: string })[];
  now: number;
}>();

const { t } = useI18n();

const body = (b: FleetBody) => `${b.name ? b.name + ' ' : ''}${b.type === 'moon' ? '☾ ' : ''}[${b.coords.g}:${b.coords.s}:${b.coords.p}]`;
const shipList = (ships: Record<string, number>) =>
  Object.entries(ships)
    .map(([id, n]) => `${fmt(n)} ${name(id)}`)
    .join(', ');
const cargo = (res: Record<string, number> | null) =>
  res && RESOURCES.some((id) => res[id]) ? RESOURCES.filter((id) => res[id]).map((id) => `${short(res[id])} ${abbr(id)}`).join(' · ') : '';

/** "1d 02:03:04" / "02:03:04" */
function countdown(sec: number) {
  const d = Math.floor(sec / 86400);
  const hms = [Math.floor((sec % 86400) / 3600), Math.floor((sec % 3600) / 60), Math.floor(sec % 60)].map((n) => String(n).padStart(2, '0')).join(':');
  return d ? `${d}d ${hms}` : hms;
}
</script>

<template>
  <ul class="fleet-list">
    <li v-for="(f, i) in fleets" :key="i" :class="{ hostile: f.owner === 'hostile' }">
      <span class="mono" :title="dateTime(f.arrival)">{{ countdown(f.arrival - now) }}</span>
      <span>
        <b v-if="f.member">{{ f.member }}: </b>
        <b>{{ f.missionName }}</b>
        <span v-if="f.owner !== 'own'" class="small" :class="f.owner === 'hostile' ? 'neg' : 'muted'">
          ({{ t(`imperium.${f.owner}`) }}<template v-if="f.player">: {{ f.player }}</template>)
        </span>
        {{ body(f.from) }} {{ t(`imperium.phase.${f.phase}`) }} <template v-if="f.to">{{ body(f.to) }}</template>
        <span v-if="shipList(f.ships) || cargo(f.resources)" class="small muted fleet-detail">
          {{ shipList(f.ships) }}<template v-if="cargo(f.resources)"> · {{ t('imperium.cargo') }} {{ cargo(f.resources) }}</template>
        </span>
      </span>
    </li>
  </ul>
</template>

<style scoped>
/* countdown, then mission, route and ships */
.fleet-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; }
.fleet-list li { display: contents; }
.fleet-list li > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.fleet-list li.hostile > span { color: var(--neg); }
.fleet-detail { display: block; }
</style>
