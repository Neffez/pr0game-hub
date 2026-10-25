<script setup lang="ts">
import Icon from './Icon.vue';

/** Sort direction in a column header: shown only for the column the table is sorted by. */
defineProps<{ dir: 'asc' | 'desc' | null }>();
</script>

<template>
  <Icon v-if="dir" :name="dir === 'desc' ? 'arrowDown' : 'arrowUp'" :size="12" class="sort-mark" />
</template>

<style scoped>
.sort-mark { margin-left: 3px; color: var(--accent); vertical-align: -2px; }
</style>
