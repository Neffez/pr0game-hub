<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { PROD_PERCENTS, PRODUCERS, type ProdDraft } from '../buildOrderProd';
import { name } from '../format';
import Hint from './Hint.vue';

/** Fields of a production step of the build order (percent per mine, wait for the build slot), adding or editing one. */
const d = defineModel<ProdDraft>({ required: true });
const { t } = useI18n();
/** an imported step may have a value between the game's steps: keep it selectable */
const choices = (id: number) => (PROD_PERCENTS.includes(d.value.percent[id]) ? PROD_PERCENTS : [...PROD_PERCENTS, d.value.percent[id]].sort((a, b) => b - a));
</script>

<template>
  <div class="row bo-add-row">
    <label v-for="p in PRODUCERS" :key="p.id">{{ name(p.res) }}
      <select v-model.number="d.percent[p.id]">
        <option v-for="v in choices(p.id)" :key="v" :value="v">{{ v }} %</option>
      </select>
    </label>
    <label><input v-model="d.awaitBuilding" type="checkbox" /> {{ t('buildOrder.prodAwaitBuilding') }}</label>
    <Hint>{{ t('buildOrder.prodHint') }}</Hint>
  </div>
</template>

<style scoped>
.bo-add-row { gap: 6px 10px; flex-wrap: wrap; }
</style>
