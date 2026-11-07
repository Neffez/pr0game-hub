<script setup lang="ts">
import { distance, drivesFromResearch, fleetSaveOptions, shipSpeed, type SaveKind, type SaveTarget } from '@pr0hub/flight';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMobile, useUni } from '../composables';
import { abbr, clockTime, dateTime, duration, fmt, short } from '../format';
import { fleetShips, units } from '../units';
import Ticker from './Ticker.vue';

/**
 * Fleet save options of one planet or moon (math: `fleetSaveOptions` of @pr0hub/flight): the fleet on it flies to
 * another own body so that it is in the air from `latest` on and at rest again at `back` or a little later. Used by
 * the fleet save planner (offline window) and the attack assistant (impact).
 */
const props = withDefaults(
  defineProps<{
    from: SaveTarget;
    /** units on the body (ships without drives, defense and satellites are ignored) */
    values: Record<string, number>;
    research: Record<string, number>;
    /** deuterium on the body now */
    deuterium: number | null;
    targets: SaveTarget[];
    /** occupied positions per galaxy ([system, position]): debris fields to recycle at (`harvest`) */
    fields?: Record<string, [number, number][]>;
    now: number;
    latest: number;
    back: number;
    kinds?: SaveKind[];
    /** options shown before "more" */
    limit?: number;
  }>(),
  { kinds: () => ['deploy', 'transport'], limit: 3 },
);
const { t } = useI18n();
const { ctx } = useUni();
const all = ref(false);
const mobile = useMobile();

const drives = computed(() => drivesFromResearch(props.research));
/** the ships that can fly */
const fleet = computed(() => {
  const out: Record<string, number> = {};
  for (const id of fleetShips()) {
    const n = props.values[id] ?? 0;
    if (n > 0 && shipSpeed(id, drives.value, units.value.drives) > 0) out[id] = n;
  }
  return out;
});
const capacity = computed(() => Object.entries(fleet.value).reduce((s, [id, n]) => s + (units.value.capacity[Number(id)] ?? 0) * n, 0));
/**
 * Debris fields of the start's galaxy as targets, one per distance (the flight time only depends on it): a few hundred
 * instead of thousands of positions.
 */
const fieldTargets = computed<SaveTarget[]>(() => {
  if (!props.kinds.includes('harvest') || !props.fields) return [];
  const u = ctx.value!.universe.settings;
  const [g] = props.from.coords;
  const seen = new Set<number>();
  const out: SaveTarget[] = [];
  for (const [s, p] of props.fields[g] ?? []) {
    const coords: [number, number, number] = [g, s, p];
    const d = distance(u, props.from.coords, coords);
    if (seen.has(d)) continue;
    seen.add(d);
    out.push({ coords, type: 'debris' });
  }
  return out;
});
const options = computed(() =>
  Object.keys(fleet.value).length
    ? fleetSaveOptions({
        universe: ctx.value!.universe.settings, catalog: units.value.drives, drives: drives.value, from: props.from, fleet: fleet.value,
        now: props.now, latest: props.latest, back: props.back, targets: [...props.targets, ...fieldTargets.value], kinds: props.kinds,
      })
    : [],
);
const shown = computed(() => (all.value ? options.value : options.value.slice(0, props.limit)));
/** clock time today, otherwise with the date (cards on mobile) */
const when = (e: number) => (new Date(e * 1000).toDateString() === new Date().toDateString() ? clockTime(new Date(e * 1000)) : dateTime(e));
const label = (x: SaveTarget) => `${x.type === 'moon' ? t('common.moon') + ' ' : x.type === 'debris' ? t('fleetsave.field') + ' ' : ''}${x.name ? x.name + ' ' : ''}[${x.coords.join(':')}]`;
defineExpose({ fleet, options });
</script>

<template>
  <div class="fso">
    <p v-if="!Object.keys(fleet).length" class="muted small m-0">{{ t('fleetsave.noShips') }}</p>
    <p v-else-if="!options.length" class="warn small m-0">{{ t('fleetsave.noOption') }}</p>
    <div v-else-if="mobile" class="fso-cards">
      <div v-for="(o, i) in shown" :key="i" class="fso-card small">
        <div><b>{{ t(`fleetsave.kinds.${o.kind}`) }}</b> → {{ label(o.target) }} · {{ o.speed }} %</div>
        <div class="mono">
          {{ when(o.departure) }} → {{ when(o.rest) }}
          <span class="muted">{{ o.late > 0 ? '+' + duration(o.late) : t('fleetsave.onTime') }}</span>
        </div>
        <div v-if="o.recall != null" class="mono">{{ t('fleetsave.recallAt', { time: when(o.recall) }) }}</div>
        <div class="muted">
          <Ticker v-slot="{ now: n }"><span v-if="o.departure > n">{{ t('fleetsave.in', { time: duration(o.departure - n) }) }} · </span></Ticker>
          <span :class="{ neg: deuterium != null && o.fuel > deuterium }">{{ short(o.fuel) }} {{ abbr(903) }}</span>
        </div>
      </div>
    </div>
    <div v-else class="scroll-x">
      <table class="data fso-table">
        <thead>
          <tr>
            <th>{{ t('fleetsave.kind') }}</th>
            <th>{{ t('fleetsave.target') }}</th>
            <th class="num">{{ t('fleetsave.speed') }}</th>
            <th>{{ t('fleetsave.departure') }}</th>
            <th>{{ t('fleetsave.rest') }}</th>
            <th class="num">{{ t('fleetsave.fuel') }}</th>
            <th class="num">{{ t('fleetsave.cargo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(o, i) in shown" :key="i">
            <td>
              <b>{{ t(`fleetsave.kinds.${o.kind}`) }}</b>
              <span v-if="o.recall != null" class="small muted"> · {{ t('fleetsave.recallAt', { time: dateTime(o.recall) }) }}</span>
            </td>
            <td class="small">{{ label(o.target) }}</td>
            <td class="num">{{ o.speed }} %</td>
            <td class="mono small">
              {{ dateTime(o.departure) }}
              <Ticker v-slot="{ now: n }">
                <span v-if="o.departure > n" class="muted"> ({{ t('fleetsave.in', { time: duration(o.departure - n) }) }})</span>
                <span v-else-if="o.departure < n - 60" class="neg"> ({{ t('fleetsave.missed') }})</span>
              </Ticker>
            </td>
            <td class="mono small">
              {{ dateTime(o.rest) }}
              <span class="muted"> ({{ o.late > 0 ? '+' + duration(o.late) : t('fleetsave.onTime') }})</span>
            </td>
            <td class="num" :class="{ neg: deuterium != null && o.fuel > deuterium }" :title="t('fleetsave.fuelTitle', { cost: fmt(o.cost) })">{{ short(o.fuel) }}</td>
            <td class="num" :title="t('fleetsave.cargoTitle')">{{ short(Math.max(0, capacity - o.fuel)) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="options.length > limit" class="small link" style="margin-top: 4px" @click="all = !all">
      {{ all ? t('fleetsave.less') : t('fleetsave.more', { n: options.length - limit }) }}
    </button>
  </div>
</template>

<style scoped>
.fso-table td { white-space: nowrap; }
.fso-cards { display: flex; flex-direction: column; gap: 6px; }
.fso-card { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 6px; background: var(--surface-2); }
</style>
