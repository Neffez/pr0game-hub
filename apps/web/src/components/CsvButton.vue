<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { exportUrl } from '../api';
import { useUni } from '../composables';
import Icon from './Icon.vue';

/** Download of one dataset of the group as CSV (server: `/api/:uni/export/:dataset`), semicolons in German for spreadsheets with a decimal comma. */
const props = defineProps<{ dataset: 'players' | 'planets' | 'spy-reports' | 'battle-reports' | 'expeditions' | 'settlements'; days?: number }>();
const { t, locale } = useI18n();
const { uni } = useUni();
const href = computed(() => exportUrl(uni.value, props.dataset, { days: props.days, sep: locale.value === 'de' ? 'semicolon' : 'comma' }));
</script>

<template>
  <a class="btn small csv-btn" :href="href" download :title="t(`export.title.${dataset}`)"><Icon name="download" :size="13" /> CSV</a>
</template>

<style scoped>
.csv-btn { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
</style>
