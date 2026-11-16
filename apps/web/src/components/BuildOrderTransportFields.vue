<script setup lang="ts">
import { isPlannedKey } from '@pr0hub/planner';
import { SPEED_PERCENTS } from '@pr0hub/flight';
import { RESOURCES } from '@pr0hub/core/tech';
import { watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { COLONY_SHIP, MISSIONS, SMALL_CARGO, type TransportDraft } from '../buildOrderTransport';
import { name } from '../format';
import { units } from '../units';
import Hint from './Hint.vue';
import Icon from './Icon.vue';

/**
 * Fields of a transport step of the build order (mission, target, speed, ships, cargo, time), for adding one and for
 * editing one. `noShips`: the step may fly without ships (imported from pr0plan with a flight time); `noTarget`: it may
 * keep no target.
 */
const props = defineProps<{ targets: string[]; label: (key: string) => string; noShips?: boolean; noTarget?: boolean }>();
const d = defineModel<TransportDraft>({ required: true });
const { t } = useI18n();

// a colonization flies with a colony ship, to a planned planet when there is one
watch(() => d.value.mission, (m) => {
  if (m !== 'colonize') return;
  if (units.value.ships.includes(COLONY_SHIP) && !d.value.ships.some((s) => s.id === COLONY_SHIP)) d.value.ships = [{ id: COLONY_SHIP, count: 1 }];
  const planned = props.targets.find(isPlannedKey);
  if (planned && !isPlannedKey(d.value.target ?? '')) d.value.target = planned;
});
</script>

<template>
  <div class="row bo-add-row">
    <select v-model="d.mission" :aria-label="t('buildOrder.trMission')">
      <option v-for="m in MISSIONS" :key="m" :value="m">{{ t(`buildOrder.mission.${m}`) }}</option>
    </select>
    <label>{{ t('buildOrder.trTarget') }}
      <select v-model="d.target">
        <option v-if="noTarget || !d.target" :value="null">–</option>
        <option v-for="k in targets" :key="k" :value="k">{{ label(k) }}</option>
      </select>
    </label>
    <label>{{ t('buildOrder.trSpeed') }}
      <select v-model.number="d.speed">
        <option v-for="p in SPEED_PERCENTS" :key="p" :value="p">{{ p }} %</option>
      </select>
    </label>
    <Hint>{{ t(d.mission === 'colonize' ? 'buildOrder.trColonizeHint' : 'buildOrder.trHint') }}</Hint>
  </div>
  <div class="row bo-add-row">
    <span class="muted">{{ t('buildOrder.trShips') }}</span>
    <span v-for="(s, i) in d.ships" :key="i" class="bo-ship">
      <input v-model.number="s.count" type="number" min="1" step="1" class="bo-num-input" :aria-label="t('buildOrder.addUnits')" />
      <select v-model.number="s.id" :aria-label="t('buildOrder.trShip')">
        <option v-for="id in units.ships" :key="id" :value="id">{{ name(id) }}</option>
      </select>
      <button v-if="d.ships.length > 1 || noShips" type="button" class="small icon-btn" :title="t('buildOrder.trRemoveShip')" :aria-label="t('buildOrder.trRemoveShip')" @click="d.ships.splice(i, 1)"><Icon name="close" :size="12" /></button>
    </span>
    <button type="button" class="small" @click="d.ships.push({ id: units.ships[0] ?? SMALL_CARGO, count: 1 })"><Icon name="plus" :size="12" /> {{ t('buildOrder.trAddShip') }}</button>
    <label v-if="noShips && !d.ships.length">{{ t('buildOrder.trFlight') }} <input v-model.number="d.flight" type="number" min="0" step="1" class="bo-num-input" /></label>
  </div>
  <div class="row bo-add-row">
    <span class="muted">{{ t('buildOrder.trAll') }}</span>
    <label v-for="r in RESOURCES" :key="r"><input v-model="d.all" type="checkbox" :value="r" /> {{ name(r) }}</label>
    <Hint>{{ t('buildOrder.trAllHint') }}</Hint>
  </div>
  <div v-if="d.all.length < RESOURCES.length" class="row bo-add-row">
    <template v-for="r in RESOURCES" :key="r">
      <label v-if="!d.all.includes(r)">{{ name(r) }} <input v-model.number="d.res[r]" type="number" min="0" step="1" class="bo-res-input" /></label>
    </template>
  </div>
  <div class="row bo-add-row">
    <label>{{ t('buildOrder.trTime') }}
      <select v-model="d.timeMode">
        <option value="none">{{ t('buildOrder.trTimeMode.none') }}</option>
        <option value="notBefore">{{ t('buildOrder.trTimeMode.notBefore') }}</option>
        <option value="arriveAt">{{ t('buildOrder.trTimeMode.arriveAt') }}</option>
      </select>
    </label>
    <input v-if="d.timeMode !== 'none'" v-model="d.time" type="datetime-local" :aria-label="t(`buildOrder.trTimeMode.${d.timeMode}`)" />
  </div>
</template>

<style scoped>
.bo-add-row { gap: 6px 10px; flex-wrap: wrap; }
.bo-num-input { width: 6em; margin-left: 4px; }
.bo-res-input { width: 8em; margin-left: 4px; }
.bo-ship { display: inline-flex; align-items: center; gap: 4px; }
</style>
