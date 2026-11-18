<script setup lang="ts">
import Icon from './Icon.vue';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUni } from '../composables';
import { nowSec } from '../clock';
import { ago } from '../format';
import { tables, useLiveReload } from '../live';
import { quickSyncAvailable, quickSyncOpen } from '../quickSync';
import { loadSyncHints, messagesDays, refreshSyncHints, syncTimes, type OwnSyncTimes } from '../syncHints';

/**
 * "This page calculates with outdated data": the member's own pages a page needs, each with the age the page still
 * takes (`maxAge`, seconds), and a button that opens the quick sync over the page. Nothing while all are fresh enough,
 * before the hub knows the times, or when the universe isn't running.
 */
const props = defineProps<{ checks: { key: keyof OwnSyncTimes; maxAge: number }[] }>();
const { t } = useI18n();
const { uni } = useUni();

onMounted(() => loadSyncHints(uni.value));
// syncs from another tab or device
useLiveReload(() => refreshSyncHints(uni.value), tables('empire', 'overview', 'fleets', 'spy_reports', 'battle_reports', 'expeditions'), 2000);

const outdated = computed(() => {
  const times = syncTimes.value;
  if (!times || !quickSyncAvailable.value) return [];
  const now = nowSec();
  return props.checks.filter((c) => times[c.key] == null || now - times[c.key]! > c.maxAge).map((c) => ({ key: c.key, time: times[c.key] }));
});

/** The state in the words of the sync hints ("Empire is 3 d old"). */
function text(x: { key: keyof OwnSyncTimes; time: number | null }) {
  const k = `syncHints.${x.key}`;
  return x.time == null ? t(`${k}.never`, { days: messagesDays.value }) : t(`${k}.old`, { age: ago(x.time) });
}
const where = computed(() => outdated.value.map((x) => t(`syncHints.${x.key}.where`)).join('\n'));
</script>

<template>
  <div v-if="outdated.length" class="card stale-data" role="status">
    <Icon name="warning" :size="16" class="stale-icon" />
    <div class="grow">
      <b>{{ t('stale.title') }}</b>
      {{ outdated.map(text).join(' · ') }}
    </div>
    <button class="primary" :title="where" @click="quickSyncOpen = true"><Icon name="sync" :size="14" /> {{ t('stale.sync') }}</button>
  </div>
</template>

<style scoped>
.stale-data { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border-left: 3px solid var(--warn); }
.stale-icon { flex: none; color: var(--warn); }
.stale-data .grow { min-width: 200px; }
.stale-data button { display: inline-flex; align-items: center; gap: 6px; }
@media (max-width: 800px) {
  .stale-data button { width: 100%; justify-content: center; }
}
</style>
