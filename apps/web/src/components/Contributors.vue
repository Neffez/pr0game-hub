<script setup lang="ts">
import Icon from './Icon.vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import type { Contributors } from '../apiTypes';
import { useUni } from '../composables';

/**
 * "You use data that 6 other members pasted": who of the alliance synced the data of a page (server: `contributors`).
 * Names (of those who show their syncs) in the tooltip. Nothing while nobody synced any.
 */
const props = defineProps<{ scope: 'farm' | 'galaxy' | 'stats'; days?: number }>();
const { t } = useI18n();
const { uni } = useUni();
const data = ref<Contributors | null>(null);

watch(
  () => [uni.value, props.scope, props.days],
  async () => {
    try {
      data.value = await uniApi<Contributors>(uni.value, `/contributors?scope=${props.scope}${props.days ? `&days=${props.days}` : ''}`);
    } catch {
      data.value = null; // a note only
    }
  },
  { immediate: true },
);

const others = computed(() => (data.value ? data.value.names.length + data.value.hidden : 0));
const text = computed(() => {
  const d = data.value;
  if (!d || !d.members) return '';
  const window = d.days != null ? ` (${t('contributors.days', { n: d.days }, d.days)})` : '';
  if (!others.value) return t('contributors.onlyMe') + window;
  return t('contributors.others', { n: others.value }, others.value) + (d.me ? t('contributors.andMe') : '') + window;
});
const title = computed(() => {
  const d = data.value;
  if (!d?.names.length) return undefined;
  return [...d.names, ...(d.hidden ? [t('contributors.more', { n: d.hidden }, d.hidden)] : [])].join(', ');
});
</script>

<template>
  <p v-if="text" class="small muted contributors" :title="title"><Icon name="user" :size="13" /> {{ text }}</p>
</template>

<style scoped>
.contributors { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; }
</style>
