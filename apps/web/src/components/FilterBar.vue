<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMobile, useStored } from '../composables';
import Icon from './Icon.vue';
import Sheet from './Sheet.vue';

export interface FilterChip {
  key: string;
  label: string;
  clear: () => void;
}

/**
 * Toolbar with filters: the `toolbar` slot (search, mode) stays visible, the filters (default slot, grouped with
 * `.filter-group`) open in a panel below it on desktop (remembered) and in a bottom sheet on mobile. Active filters
 * show as chips that clear them one by one; `reset` restores the defaults.
 */
const props = defineProps<{ storeKey: string; chips: FilterChip[] }>();
const emit = defineEmits<{ reset: [] }>();
const { t } = useI18n();
const mobile = useMobile();
const panelOpen = useStored(`filters.${props.storeKey}`, false);
const sheetOpen = ref(false);
const toggle = () => (mobile.value ? (sheetOpen.value = true) : (panelOpen.value = !panelOpen.value));
</script>

<template>
  <div class="filterbar card">
    <div class="filterbar-row">
      <slot name="toolbar" />
      <button type="button" class="filter-btn" :class="{ active: chips.length || (panelOpen && !mobile) }" :aria-expanded="mobile ? sheetOpen : panelOpen" @click="toggle">
        <Icon name="filter" />
        {{ t('common.filters') }}
        <span v-if="chips.length" class="badge filter-count">{{ chips.length }}</span>
      </button>
      <slot name="end" />
    </div>
    <div v-if="panelOpen && !mobile" class="filter-panel"><slot /></div>
    <div v-if="chips.length" class="filter-chips">
      <button v-for="c in chips" :key="c.key" type="button" class="chip" :title="t('common.removeFilter')" @click="c.clear()">
        {{ c.label }} <Icon name="close" :size="12" />
      </button>
      <button type="button" class="link small" @click="emit('reset')">{{ t('common.reset') }}</button>
    </div>
    <slot name="status" />
  </div>
  <Sheet v-if="mobile" v-model="sheetOpen" :title="t('common.filters')">
    <div class="filter-panel"><slot /></div>
    <template #footer>
      <button type="button" @click="emit('reset')">{{ t('common.reset') }}</button>
      <button type="button" class="primary" @click="sheetOpen = false">{{ t('common.done') }}</button>
    </template>
  </Sheet>
</template>

<style scoped>
.filterbar { display: flex; flex-direction: column; gap: 8px; }
.filterbar-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.filter-btn { display: inline-flex; align-items: center; gap: 6px; }
.filter-btn.active { border-color: var(--accent); color: var(--accent); }
.filter-count { margin: 0; color: #fff; background: var(--accent); }
.filter-panel { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px 20px; padding-top: 4px; }
.filter-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
@media (max-width: 800px) {
  .filter-panel { grid-template-columns: 1fr; gap: 16px; }
}
</style>
