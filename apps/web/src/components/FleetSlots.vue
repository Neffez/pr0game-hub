<script setup lang="ts">
/**
 * Fleet and expedition slots of a member (server: repo/slots.ts): taken and free by the newest fleet list and the
 * research, counting down to the next fleet that frees its slot.
 */
import { useI18n } from 'vue-i18n';
import type { Schema } from '../apiTypes';
import { ago, clockTime, dateTime } from '../format';
import Icon from './Icon.vue';
import Ticker from './Ticker.vue';

defineProps<{ slots: Schema<'FleetSlots'>; expeditionsOnly?: boolean }>();
const { t } = useI18n();

type Count = Schema<'SlotCount'>;
/** Slots taken at `now` (the flights listed that are not home yet). */
const used = (c: Count, now: number) => c.ends.filter((e) => e > now).length;
const next = (c: Count, now: number) => c.ends.find((e) => e > now) ?? null;
function left(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <Ticker v-slot="{ now }">
    <div class="slots small" data-tour="fleet-slots" :title="[t('slots.asOf', { t: `${dateTime(slots.time)} (${ago(slots.time)})` }), slots.own ? '' : t('slots.shared'), t('slots.hint')].filter(Boolean).join('\n')">
      <template v-for="kind in expeditionsOnly ? (['expeditions'] as const) : (['fleets', 'expeditions'] as const)" :key="kind">
        <span class="slot" :class="{ full: slots[kind].max != null && used(slots[kind], now) >= slots[kind].max! }">
          <Icon :name="kind === 'fleets' ? 'fleet' : 'expeditions'" :size="14" />
          <span>{{ t(`slots.${kind}`) }}</span>
          <b class="mono">{{ used(slots[kind], now) }}/{{ slots[kind].max ?? '?' }}</b>
          <span v-if="slots[kind].max == null" class="faint">({{ t('slots.unknown') }})</span>
          <span v-else-if="used(slots[kind], now) >= slots[kind].max!" class="warn">({{ t('slots.full') }})</span>
          <span v-else class="pos">({{ t('slots.free', { n: slots[kind].max! - used(slots[kind], now) }) }})</span>
          <span v-if="next(slots[kind], now) != null" class="muted">
            · {{ t('slots.next', { t: clockTime(new Date(next(slots[kind], now)! * 1000), true) }) }}
            <span class="mono">({{ left(next(slots[kind], now)! - now) }})</span>
          </span>
        </span>
      </template>
    </div>
  </Ticker>
</template>

<style scoped>
.slots { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-bottom: 8px; }
.slot { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.slot .icon { color: var(--muted); }
.slot.full .icon { color: var(--warn); }
</style>
