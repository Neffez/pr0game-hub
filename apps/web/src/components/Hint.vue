<script setup lang="ts">
/** Info icon with the explanation as tooltip (hover, or tap/focus on touch devices). */
defineProps<{ warn?: boolean }>();
</script>

<template>
  <span class="hint" :class="{ warn }" tabindex="0" role="note">
    {{ warn ? '!' : 'i' }}
    <span class="hint-body"><slot /></span>
  </span>
</template>
