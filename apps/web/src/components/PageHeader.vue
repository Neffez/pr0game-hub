<script setup lang="ts">
/** Page title with an optional hint next to it and the page's actions on the right (below the title on mobile). */
import { useI18n } from 'vue-i18n';
import { startTour, type TourId } from '../tours';

defineProps<{ title: string; tour?: TourId }>();
const { t } = useI18n();
</script>

<template>
  <div class="page-head">
    <h1>{{ title }}<slot name="hint" /><button v-if="tour" type="button" class="tour-btn" :title="t('tours.start')" :aria-label="t('tours.start')" @click="startTour(tour)">?</button></h1>
    <slot name="extra" />
    <div v-if="$slots.default" class="page-actions"><slot /></div>
  </div>
</template>
