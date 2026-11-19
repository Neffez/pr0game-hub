<script setup lang="ts">
import CsvButton from '../components/CsvButton.vue';
import FleetSlots from '../components/FleetSlots.vue';
import ExpeditionDeck from '../components/ExpeditionDeck.vue';
import ExpeditionStats from '../components/ExpeditionStats.vue';
import Hint from '../components/Hint.vue';
import PageHeader from '../components/PageHeader.vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { uniApi } from '../api';
import type { ApiResponse } from '../apiTypes';
import { useStored, useUni } from '../composables';
import { tables, useLiveReload } from '../live';

/** Expeditions: the alliance's statistics and the own card-counting deck as tabs (link: ?tab=stats / deck). */
const { t } = useI18n();
const { ctx, uni } = useUni();
const route = useRoute();
const router = useRouter();

const TABS = ['stats', 'deck'] as const;
type ExpoTab = (typeof TABS)[number];
const storedTab = useStored<ExpoTab>('expeditions.tab', 'stats');
const tab = computed<ExpoTab>({
  get: () => {
    const q = route.query.tab as ExpoTab;
    if (TABS.includes(q)) return q;
    return TABS.includes(storedTab.value) ? storedTab.value : 'stats';
  },
  set: (v) => {
    storedTab.value = v;
    router.replace({ query: { ...route.query, tab: v } });
  },
});

/** The own expedition slots: taken, free and when the next one is free (by the newest fleet list). */
const slots = ref<ApiResponse<'/api/{uni}/fleets/slots'>['slots']>(null);
async function loadSlots() {
  try {
    slots.value = (await uniApi<ApiResponse<'/api/{uni}/fleets/slots'>>(uni.value, '/fleets/slots')).slots;
  } catch {
    /* kept until the next reload */
  }
}
onMounted(loadSlots);
useLiveReload(loadSlots, tables('fleets', 'expeditions', 'empire', 'research'));
</script>

<template>
  <PageHeader :title="t('nav.expeditions')" tour="expeditions" sync>
    <template #hint>
      <Hint v-if="tab === 'deck'">
        <p>{{ t('deck.hint1', { n: ctx!.universe.deck.reduce((s, c) => s + c.count, 0) || 1000 }) }}</p>
        <p>{{ t('deck.hint2') }}</p>
      </Hint>
      <Hint v-else>
        <p>{{ t('expeditions.hint1') }}</p>
        <p>{{ t('expeditions.hint2') }}</p>
        <p>{{ t('expeditions.hint3') }}</p>
      </Hint>
    </template>
    <CsvButton v-if="tab !== 'deck'" dataset="expeditions" />
  </PageHeader>
  <FleetSlots v-if="slots" :slots="slots" expeditions-only />
  <div class="seg tab-seg">
    <button :class="{ active: tab === 'stats' }" data-tour="expo-tab-stats" @click="tab = 'stats'">{{ t('expeditions.tabStats') }}</button>
    <button :class="{ active: tab === 'deck' }" data-tour="expo-tab-deck" @click="tab = 'deck'">{{ t('expeditions.tabDeck') }}</button>
  </div>
  <ExpeditionDeck v-if="tab === 'deck'" @show-stats="tab = 'stats'" />
  <ExpeditionStats v-else />
</template>

<style scoped>
.tab-seg { margin-bottom: 14px; }
</style>
