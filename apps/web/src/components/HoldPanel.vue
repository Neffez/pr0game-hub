<script setup lang="ts">
import Hint from './Hint.vue';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { coords, duration, fmt, name, timeWithAge } from '../format';
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
const delay = computed(() => enemy.value.arrival - enemy.value.first_seen);
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
    <div class="head">
      <b>{{ t('hold.title') }} <Hint>{{ t('hold.hint') }}</Hint></b>
      <span>{{ t('retime.onMember', { member: enemy.member ?? coords(enemy.to.g, enemy.to.s, enemy.to.p) }) }}</span>
      <span class="mono">{{ coords(enemy.from.g, enemy.from.s, enemy.from.p) }} → {{ coords(enemy.to.g, enemy.to.s, enemy.to.p) }}</span>
      <span>{{ t('retime.impact') }} <b class="mono">{{ clock(enemy.arrival) }}</b></span>
      <span v-if="delay > 0" class="warn small">{{ t('retime.delayed', { t: duration(delay), first: clock(enemy.first_seen) }) }}</span>
    </div>
    <div class="field">
      <span class="lbl">{{ t('hold.offset') }}</span>
      <input v-model.number="offset" type="number" min="-3600" max="3600" step="1" :disabled="!editable" @input="dirty = true" /> s
      <span class="small" :class="rating === 'safe' ? 'pos' : 'warn'">{{ t(`hold.rating.${rating}`) }}</span>
    </div>
    <div class="row">
      <span class="small">{{ t('hold.lands', { t: clock(enemy.arrival + offset), offset: signed(offset) }) }}</span>
      <template v-if="editable">
        <button class="primary" :disabled="!dirty || !Number.isInteger(offset)" @click="save">{{ t('plans.save') }}</button>
        <button v-if="dirty" @click="(offset = enemy.hold_offset), (dirty = false)">{{ t('plans.cancelForm') }}</button>
      </template>
      <span v-if="enemy.updated_by" class="muted small">{{ t('retime.updatedBy', { name: enemy.updated_by }) }}</span>
    </div>
    <div class="planet">
      <div class="row">
        <b>{{ t('hold.planetFleet') }} <Hint>{{ t('hold.planetFleetHint') }}</Hint></b>
        <span class="muted small">{{
          enemy.planet_ships ? t('hold.planetManual') : plan.spy ? t('hold.planetFrom', { time: timeWithAge(plan.spy.time) }) : t('hold.planetUnknown')
        }}</span>
      </div>
      <span v-if="!shipIds.length" class="muted small">{{ t('hold.planetNoShips') }}</span>
      <div v-for="id in shipIds" :key="id" class="ship-row">
        <span class="ship-name" :title="name(id)">{{ name(id) }}</span>
        <input v-model.number="ships[id]" type="number" min="0" :disabled="!editable" :aria-label="name(id)" @input="shipsDirty = true" />
        <span v-if="(sourceShips[id] ?? 0) !== ships[id]" class="muted small">{{ t('hold.planetWas', { n: fmt(sourceShips[id] ?? 0) }) }}</span>
        <button v-if="editable" :title="t('plans.removeShip')" @click="removeShip(id)">✕</button>
      </div>
      <div v-if="editable" class="row">
        <select v-if="addable.length" :aria-label="t('plans.addShip')" @change="addShip">
          <option value="">{{ t('plans.addShip') }} …</option>
          <option v-for="id in addable" :key="id" :value="id">{{ name(id) }}</option>
        </select>
        <button class="primary" :disabled="!shipsDirty || !shipsValid" @click="saveShips(ships)">{{ t('plans.save') }}</button>
        <button v-if="shipsDirty" @click="resetShips">{{ t('plans.cancelForm') }}</button>
        <button v-if="enemy.planet_ships && !shipsDirty" @click="saveShips(null)">{{ t('hold.planetReset') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hold { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
.field { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.lbl { min-width: 110px; color: var(--muted); font-size: 12px; }
.field input[type='number'] { width: 80px; }
.planet { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); padding-top: 8px; }
.ship-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ship-name { min-width: 150px; }
.ship-row input { width: 110px; }
@media (max-width: 800px) {
  .lbl { flex-basis: 100%; }
  .ship-name { flex: 1 1 100%; min-width: 0; }
}
</style>
