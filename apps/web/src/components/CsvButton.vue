<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { exportUrl } from '../api';
import { useUni } from '../composables';
import Icon from './Icon.vue';

/** Download of one dataset of the group as CSV (server: `/api/:uni/export/:dataset`), semicolons in German for spreadsheets with a decimal comma. */
const props = defineProps<{
  dataset: 'players' | 'planets' | 'spy-reports' | 'battle-reports' | 'expeditions' | 'settlements';
  days?: number;
  /** filters of the view for the players and planets tables (server: `ExportFilter`); the title then says so */
  filter?: Record<string, string | number | null | undefined>;
}>();
const { t, locale } = useI18n();
const { uni } = useUni();
const href = computed(() => exportUrl(uni.value, props.dataset, { days: props.days, sep: locale.value === 'de' ? 'semicolon' : 'comma', filter: props.filter }));
const filtered = computed(() => Object.values(props.filter ?? {}).some((v) => v != null && v !== ''));
</script>

<template>
  <a class="btn small csv-btn" :href="href" download :title="t(`export.title.${dataset}`) + (filtered ? ` · ${t('export.filtered')}` : '')">
    <Icon name="download" :size="13" /> CSV<span v-if="filtered" class="csv-filtered" aria-hidden="true">*</span>
  </a>
</template>

<style scoped>
.csv-btn { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
.csv-filtered { color: var(--accent); margin-left: -2px; }
</style>
