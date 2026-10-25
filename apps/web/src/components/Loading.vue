<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/** Placeholder while a page loads its data: a few shimmering lines (`lines`), announced to screen readers. */
withDefaults(defineProps<{ lines?: number }>(), { lines: 3 });
const { t } = useI18n();
</script>

<template>
  <div class="loading card" role="status" :aria-label="t('common.loading')">
    <div v-for="i in lines" :key="i" class="bar" :style="{ width: `${90 - ((i * 17) % 40)}%` }" />
  </div>
</template>

<style scoped>
.loading { display: flex; flex-direction: column; gap: 10px; }
.bar { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--border) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite linear; }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .bar { animation: none; } }
</style>
