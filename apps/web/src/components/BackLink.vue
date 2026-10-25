<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';
import Icon from './Icon.vue';

/** Link back to the page above (arrow and label), above a page title. */
defineProps<{ to: RouteLocationRaw; label: string }>();
</script>

<template>
  <p class="back-link"><RouterLink :to="to"><Icon name="arrowLeft" :size="14" /> {{ label }}</RouterLink></p>
</template>

<style scoped>
.back-link { margin: 0 0 8px; }
.back-link a { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; }
</style>
