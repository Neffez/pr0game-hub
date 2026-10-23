<script lang="ts">
import { ref } from 'vue';

/** One shared second clock for all countdowns; runs while at least one is shown. */
const tick = ref(Math.floor(Date.now() / 1000));
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
function start() {
  if (users++ === 0) {
    tick.value = Math.floor(Date.now() / 1000);
    timer = setInterval(() => (tick.value = Math.floor(Date.now() / 1000)), 1000);
  }
}
function stop() {
  if (--users === 0) clearInterval(timer);
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { duration } from '../format';

/**
 * "in 1:02:03" / "vor 5:00" / "in 3 Tagen", ticking every second. Only this element updates, so the page around it
 * (open dropdowns, inputs) is not rendered again every second.
 */
const props = defineProps<{ to: number }>();
const { t } = useI18n();
start();
onBeforeUnmount(stop);

const text = computed(() => {
  const s = props.to - tick.value;
  if (Math.abs(s) >= 2 * 86400) return t(s >= 0 ? 'plans.inDays' : 'plans.agoDays', { n: Math.floor(Math.abs(s) / 86400) });
  return s >= 0 ? t('plans.in', { t: duration(s) || '0:00:00' }) : t('plans.ago', { t: duration(-s) });
});
</script>

<template>
  <span>{{ text }}</span>
</template>
