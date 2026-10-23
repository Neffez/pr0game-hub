<script setup lang="ts">
import { useClock } from '../clock';

/**
 * Renders its slot with the current second (`v-slot="{ now }"`), without an element of its own. Only the slot
 * content is rendered again every second, not the page around it.
 */
const now = useClock();
</script>

<template>
  <slot :now="now" />
</template>
