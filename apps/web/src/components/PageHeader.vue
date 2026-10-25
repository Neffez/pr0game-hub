<script setup lang="ts">
/** Page title with an optional hint next to it and the page's actions on the right (below the title on mobile). */
defineProps<{ title: string }>();
</script>

<template>
  <div class="page-head">
    <h1>{{ title }}<slot name="hint" /></h1>
    <slot name="extra" />
    <div v-if="$slots.default" class="page-actions"><slot /></div>
  </div>
</template>
