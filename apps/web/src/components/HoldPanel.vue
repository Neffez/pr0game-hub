<script setup lang="ts">
import Hint from './Hint.vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import { useUni } from '../composables';
import { coords, duration } from '../format';
import { intlLocale } from '../i18n';
import { holdRating, type AttackPlan, type PlanEnemy } from '../plans';

/**
 * Hold against a hostile attack: the own fleets land on the attacked planet `hold_offset` seconds from the impact,
 * each on its own (holds cannot be delayed). The target time follows the impact, also after a delay of the enemy.
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
  </div>
</template>

<style scoped>
.hold { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
.field { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.lbl { min-width: 110px; color: var(--muted); font-size: 12px; }
.field input[type='number'] { width: 80px; }
@media (max-width: 800px) {
  .lbl { flex-basis: 100%; }
}
</style>
