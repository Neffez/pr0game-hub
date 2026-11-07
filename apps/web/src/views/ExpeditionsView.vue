<script setup lang="ts">
import CsvButton from '../components/CsvButton.vue';
import ExpeditionDeck from '../components/ExpeditionDeck.vue';
import ExpeditionStats from '../components/ExpeditionStats.vue';
import Hint from '../components/Hint.vue';
import PageHeader from '../components/PageHeader.vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useStored, useUni } from '../composables';

/** Expeditions: the alliance's statistics and the own card-counting deck as tabs (link: ?tab=stats / deck). */
const { t } = useI18n();
const { ctx } = useUni();
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
</script>

<template>
  <PageHeader :title="t('nav.expeditions')" tour="expeditions">
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
