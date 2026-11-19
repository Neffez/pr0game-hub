<script setup lang="ts">
/**
 * Page title with an optional hint next to it and the page's actions on the right (below the title on mobile).
 * `sync`: a "Sync now" button that opens the quick sync (desktop; a page with an overflow menu puts
 * `useQuickSyncItem` into that menu instead).
 */
import { useI18n } from 'vue-i18n';
import { useQuickSyncItem } from '../quickSync';
import { startTour, type TourId } from '../tours';
import Icon from './Icon.vue';

defineProps<{ title: string; tour?: TourId; sync?: boolean }>();
const { t } = useI18n();
const syncItem = useQuickSyncItem();
</script>

<template>
  <div class="page-head">
    <h1>{{ title }}<slot name="hint" /><button v-if="tour" type="button" class="tour-btn" :title="t('tours.start')" :aria-label="t('tours.start')" @click="startTour(tour)">?</button></h1>
    <slot name="extra" />
    <div v-if="$slots.default || (sync && syncItem)" class="page-actions">
      <slot />
      <button v-if="sync && syncItem" type="button" class="icon-btn" :title="syncItem.label" :aria-label="syncItem.label" @click="syncItem.onClick?.()">
        <Icon name="sync" />
      </button>
    </div>
  </div>
</template>
