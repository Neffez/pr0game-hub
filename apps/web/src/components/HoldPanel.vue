<script setup lang="ts">
import EnemySummary from './EnemySummary.vue';
import Icon from './Icon.vue';
import Hint from './Hint.vue';
import Section from './Section.vue';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { abbr, fmt, name, timeWithAge } from '../format';
import { intlLocale } from '../i18n';
import { FLEET_SHIPS, holdRating, spyShips, type AttackPlan, type PlanEnemy } from '../plans';

/**
 * Hold against a hostile attack: the own fleets land on the attacked planet `hold_offset` seconds from the impact,
 * each on its own (holds cannot be delayed). The target time follows the impact, also after a delay of the enemy.
 * The ships on the attacked planet (for the combat simulators) come from the member's empire page or the planet's spy
 * report and can be changed, e.g. when ships are sent away before the impact.
 */
const props = defineProps<{ plan: AttackPlan; editable: boolean }>();
const enemy = computed(() => props.plan.enemy as PlanEnemy);
const emit = defineEmits<{ saved: []; error: [message: string] }>();
const { t } = useI18n();
const { uni } = useUni();

const offset = ref(enemy.value.hold_offset);
const dirty = ref(false);
watch(() => enemy.value.hold_offset + ':' + enemy.value.updated_at, () => {
  if (!dirty.value) offset.value = enemy.value.hold_offset;
});
const rating = computed(() => holdRating(offset.value));
const enemyShips = computed(() =>
  enemy.value.fleets
    .flatMap((f) => Object.entries(f.ships))
    .map(([id, n]) => `${fmt(n)} ${abbr(Number(id))}`)
    .join(', '),
);
const clock = (epoch: number) => new Date(epoch * 1000).toLocaleTimeString(intlLocale(), { hour: '2-digit', hourCycle: 'h23', minute: '2-digit', second: '2-digit' });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)} s`;

// ---- ships on the attacked planet ----
const sourceShips = computed(() => spyShips(props.plan));
const planetShips = computed(() => enemy.value.planet_ships ?? sourceShips.value);
const ships = reactive<Record<number, number>>({});
const shipsDirty = ref(false);
function resetShips() {
  for (const id of Object.keys(ships)) delete ships[Number(id)];
  Object.assign(ships, planetShips.value);
  shipsDirty.value = false;
}
watch(planetShips, () => !shipsDirty.value && resetShips(), { immediate: true });
const shipIds = computed(() => Object.keys(ships).map(Number).sort((a, b) => a - b));
const addable = computed(() => FLEET_SHIPS.filter((id) => ships[id] == null));
const shipsValid = computed(() => Object.values(ships).every((n) => Number.isInteger(n) && n >= 0));
function addShip(e: Event) {
  const el = e.target as HTMLSelectElement;
  if (el.value) ships[Number(el.value)] = 0;
  el.value = '';
  shipsDirty.value = true;
}
function removeShip(id: number) {
  delete ships[id];
  shipsDirty.value = true;
}
/** Saves the ships, or with null takes them from the empire page or spy report again. */
async function saveShips(value: Record<number, number> | null) {
  try {
    const body = value && Object.fromEntries(Object.entries(value).filter(([, n]) => n > 0));
    await uniApi(uni.value, `/plans/${props.plan.id}/enemy`, { method: 'PUT', body: { planet_ships: body } });
    shipsDirty.value = false;
    emit('saved');
  } catch (e) {
    emit('error', (e as Error).message);
  }
}

async function save() {
  try {
    await uniApi(uni.value, `/plans/${props.plan.id}/enemy`, { method: 'PUT', body: { hold_offset: offset.value } });
    dirty.value = false;
    emit('saved');
  } catch (e) {
    emit('error', (e as Error).message);
  }
}
</script>

<template>
  <div class="hold">
    <EnemySummary :enemy="enemy">
      <template #hint><Hint>{{ t('hold.hint') }}</Hint></template>
      {{ enemyShips }}
    </EnemySummary>

    <!-- the result: when the hold fleets land, with the offset to change it -->
    <div class="landing">
      <div class="landing-line">
        <span class="landing-time">
          <span class="muted small">{{ t('hold.landsAt') }}</span>
          <b class="mono">{{ clock(enemy.arrival + offset) }}</b>
          <span class="small">({{ signed(offset) }})</span>
        </span>
        <span class="badge" :class="rating === 'safe' ? 'pos' : 'warn'">{{ t(`hold.rating.${rating}`) }}</span>
      </div>
      <div class="field">
        <span class="small muted">{{ t('hold.offset') }}</span>
        <input v-model.number="offset" type="number" min="-3600" max="3600" step="1" :disabled="!editable" :aria-label="t('hold.offset')" @input="dirty = true" />
        <span class="small">s</span>
        <template v-if="editable && dirty">
          <button class="primary" :disabled="!Number.isInteger(offset)" @click="save">{{ t('plans.save') }}</button>
          <button @click="(offset = enemy.hold_offset), (dirty = false)">{{ t('plans.cancelForm') }}</button>
        </template>
      </div>
      <span v-if="enemy.updated_by" class="muted small">{{ t('retime.updatedBy', { name: enemy.updated_by }) }}</span>
    </div>

    <Section :title="t('hold.planetFleet')" :count="shipIds.length || null" :card="false" :default-open-mobile="false" store-key="hold.planet" class="planet">
      <template #hint><Hint>{{ t('hold.planetFleetHint') }}</Hint></template>
      <div class="planet-body">
        <span class="muted small">{{
          enemy.planet_ships ? t('hold.planetManual') : plan.spy ? t('hold.planetFrom', { time: timeWithAge(plan.spy.time) }) : t('hold.planetUnknown')
        }}</span>
        <span v-if="!shipIds.length" class="muted small">{{ t('hold.planetNoShips') }}</span>
        <div v-for="id in shipIds" :key="id" class="ship-row">
          <span class="ship-name" :title="name(id)">{{ name(id) }}</span>
          <input v-model.number="ships[id]" type="number" min="0" :disabled="!editable" :aria-label="name(id)" @input="shipsDirty = true" />
          <span v-if="(sourceShips[id] ?? 0) !== ships[id]" class="muted small">{{ t('hold.planetWas', { n: fmt(sourceShips[id] ?? 0) }) }}</span>
          <button v-if="editable" class="icon-btn" :title="t('plans.removeShip')" :aria-label="t('plans.removeShip')" @click="removeShip(id)"><Icon name="close" :size="14" /></button>
        </div>
        <div v-if="editable" class="row">
          <select v-if="addable.length" :aria-label="t('plans.addShip')" @change="addShip">
            <option value="">{{ t('plans.addShip') }} …</option>
            <option v-for="id in addable" :key="id" :value="id">{{ name(id) }}</option>
          </select>
          <template v-if="shipsDirty">
            <button class="primary" :disabled="!shipsValid" @click="saveShips(ships)">{{ t('plans.save') }}</button>
            <button @click="resetShips">{{ t('plans.cancelForm') }}</button>
          </template>
          <button v-else-if="enemy.planet_ships" @click="saveShips(null)">{{ t('hold.planetReset') }}</button>
        </div>
      </div>
    </Section>
  </div>
</template>

<style scoped>
.hold { display: flex; flex-direction: column; gap: 12px; }
.landing { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); }
.landing-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.landing-time { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.landing-time b { font-size: 18px; }
.badge.pos { color: var(--pos); }
.badge.warn { color: var(--warn); }
.field { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.field input[type='number'] { width: 80px; }
.planet :deep(.section-head) { margin: 0; min-height: 0; }
.planet-body { display: flex; flex-direction: column; gap: 6px; }
.ship-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ship-name { min-width: 150px; }
.ship-row input { width: 110px; }
@media (max-width: 800px) {
  .ship-name { flex: 1 1 100%; min-width: 0; }
}
</style>
