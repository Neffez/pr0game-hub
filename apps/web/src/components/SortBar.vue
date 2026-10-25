<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Icon from './Icon.vue';

/**
 * Sort selection for lists without clickable column headers (mobile). `sortKey`: current key; picking another one
 * emits `sort` (useSort's sortBy). `v-model:desc`: the direction.
 */
defineProps<{ sortKey: string; options: { key: string; label: string }[] }>();
const emit = defineEmits<{ sort: [key: string] }>();
const desc = defineModel<boolean>('desc', { required: true });
const { t } = useI18n();
</script>

<template>
  <div class="sortbar">
    <label>
      {{ t('overview.sort') }}
      <select :value="sortKey" @change="emit('sort', ($event.target as HTMLSelectElement).value)">
        <option v-for="o in options" :key="o.key" :value="o.key">{{ o.label }}</option>
      </select>
    </label>
    <button
      type="button"
      class="icon-btn"
      :title="desc ? t('common.sortDesc') : t('common.sortAsc')"
      :aria-label="desc ? t('common.sortDesc') : t('common.sortAsc')"
      @click="desc = !desc"
    >
      <Icon :name="desc ? 'sortDesc' : 'sortAsc'" />
    </button>
  </div>
</template>

<style scoped>
.sortbar { display: flex; align-items: center; gap: 6px; min-width: 0; margin-bottom: 8px; font-size: 12px; }
.sortbar label { display: flex; align-items: center; gap: 6px; min-width: 0; }
.sortbar select { min-width: 0; max-width: 60vw; margin: 0; }
</style>
