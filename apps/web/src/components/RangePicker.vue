<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const model = defineModel<number>({ required: true });
</script>

<template>
  <label>
    {{ t('time.range') }}
    <select v-model.number="model">
      <option :value="1">{{ t('time.h24') }}</option>
      <option :value="3">{{ t('time.days', { n: 3 }) }}</option>
      <option :value="7">{{ t('time.days', { n: 7 }) }}</option>
      <option :value="30">{{ t('time.days', { n: 30 }) }}</option>
      <option :value="3650">{{ t('time.everything') }}</option>
    </select>
  </label>
</template>
