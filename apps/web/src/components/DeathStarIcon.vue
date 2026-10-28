<script setup lang="ts">
/** Small Death Star (moon-destruction battle reports), 16×16 grid. */
defineProps<{ title?: string }>();
</script>

<template>
  <svg
    class="death-star"
    viewBox="0 0 16 16"
    width="14"
    height="14"
    role="img"
    :aria-label="title"
  >
    <title v-if="title">{{ title }}</title>
    <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.35" />
    <ellipse cx="8" cy="9" rx="5.2" ry="1.15" fill="none" stroke="currentColor" stroke-width="0.75" opacity="0.55" />
    <circle cx="10.2" cy="7.4" r="2.15" fill="none" stroke="currentColor" stroke-width="1.05" />
  </svg>
</template>

<style scoped>
.death-star {
  flex-shrink: 0;
  opacity: 0.82;
  vertical-align: -2px;
}
</style>
