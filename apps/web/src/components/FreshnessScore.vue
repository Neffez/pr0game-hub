<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Freshness } from '../apiTypes';
import { ago } from '../format';

/**
 * Freshness of a member's own pages (server: repo/freshness.ts): a ring with the score (`ring`) or the score alone,
 * coloured; the tooltip lists each page with its points and age.
 */
const props = defineProps<{ freshness: Freshness | null | undefined; ring?: boolean }>();
const { t } = useI18n();

const score = computed(() => props.freshness?.score ?? 0);
const tone = computed(() => (score.value >= 75 ? 'var(--pos)' : score.value >= 40 ? 'var(--warn)' : 'var(--neg)'));
const title = computed(() => {
  const f = props.freshness;
  if (!f) return '';
  const lines = f.parts.map(
    (p) => `${t(`ownFresh.parts.${p.key}`)}: ${Math.round(p.weight * p.value)}/${p.weight} · ${p.time != null ? ago(p.time) : t('ownFresh.never')}`,
  );
  return [t('ownFresh.title', { n: f.score }), ...lines].join('\n');
});
const R = 15;
const C = 2 * Math.PI * R;
</script>

<template>
  <span v-if="freshness" class="freshness" :class="{ ring }" :title="title" :aria-label="title" role="img">
    <svg v-if="ring" viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
      <circle cx="18" cy="18" :r="R" fill="none" stroke="var(--border)" stroke-width="3.5" />
      <circle
        cx="18" cy="18" :r="R" fill="none" :stroke="tone" stroke-width="3.5" stroke-linecap="round"
        :stroke-dasharray="`${(C * score) / 100} ${C}`" transform="rotate(-90 18 18)"
      />
      <text x="18" y="22" text-anchor="middle" :fill="tone" font-size="11" font-weight="700">{{ score }}</text>
    </svg>
    <span v-else class="freshness-num" :style="{ color: tone }">{{ score }} %</span>
  </span>
</template>

<style scoped>
.freshness { display: inline-flex; align-items: center; cursor: help; flex: none; }
.freshness-num { font-weight: 600; }
</style>
