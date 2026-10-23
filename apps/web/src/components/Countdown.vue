<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useClock } from '../clock';
import { duration } from '../format';

/**
 * "in 1:02:03" / "vor 5:00" / "in 3 Tagen", ticking every second. Only this element updates, so the page around it
 * (open dropdowns, inputs) is not rendered again every second.
 */
const props = defineProps<{ to: number }>();
const { t } = useI18n();
const tick = useClock();

const text = computed(() => {
  const s = props.to - tick.value;
  if (Math.abs(s) >= 2 * 86400) return t(s >= 0 ? 'plans.inDays' : 'plans.agoDays', { n: Math.floor(Math.abs(s) / 86400) });
  return s >= 0 ? t('plans.in', { t: duration(s) || '0:00:00' }) : t('plans.ago', { t: duration(-s) });
});
</script>

<template>
  <span>{{ text }}</span>
</template>
