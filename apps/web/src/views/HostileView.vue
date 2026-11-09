<script setup lang="ts">
import { useAutoTour } from '../tours';
import { nowSec } from '../clock';
import ShowMore from '../components/ShowMore.vue';
import PageHeader from '../components/PageHeader.vue';
import Hint from '../components/Hint.vue';
import PlayerLink from '../components/PlayerLink.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ThreatList from '../components/ThreatList.vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import RangePicker from '../components/RangePicker.vue';
import { useLoader, useStored, useUni, vStack, useLimit } from '../composables';
import { tables, useLiveReload } from '../live';
import { ago, coords, dateTime } from '../format';

const { t } = useI18n();
const { uni } = useUni();
const days = useStored('hostile.days', 7);

/**
 * Two tabs: who threatens me (A-5, the viewer's own attackers and spies) and the alliance's hostile spying. The tab
 * from the link (`?tab=`), else the last one.
 */
const TABS = ['me', 'alliance'] as const;
type Tab = (typeof TABS)[number];
const route = useRoute();
const router = useRouter();
const storedTab = useStored<Tab>('hostile.tab', 'me');
const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : TABS.includes(storedTab.value) ? storedTab.value : 'me'),
  set: (v) => {
    storedTab.value = v;
    router.replace({ query: { ...route.query, tab: v } });
  },
});
const threats = ref<{ ready: boolean }>();

const { data, error, load: loadSpying } = useLoader<any>(() => uniApi(uni.value, `/hostile?from=${nowSec() - days.value * 86400}`));
/** The alliance's spying loads when its tab is shown. */
const load = () => (tab.value === 'alliance' ? loadSpying() : Promise.resolve());
watch(tab, (v) => v === 'alliance' && !data.value && loadSpying());
/** The newest 20 spyings of the history first. */
const historyLimit = useLimit(computed<any[]>(() => data.value?.list ?? []));
onMounted(load);
useLiveReload(load, tables('hostile_spying'));
watch(days, load);
useAutoTour('hostile', () => (tab.value === 'me' ? !!threats.value?.ready : !!data.value), tab);
</script>

<template>
  <PageHeader :title="t('nav.hostile')" tour="hostile">
    <template #hint>
      <Hint>{{ t(tab === 'me' ? 'threats.hint' : 'hostile.hint') }}</Hint>
    </template>
    <div class="seg">
      <button data-tour="hostile-tab-me" :class="{ active: tab === 'me' }" @click="tab = 'me'">{{ t('threats.tab') }}</button>
      <button data-tour="hostile-tab-alliance" :class="{ active: tab === 'alliance' }" @click="tab = 'alliance'">{{ t('threats.tabAlliance') }}</button>
    </div>
  </PageHeader>
  <div class="card row" data-tour="hostile-range">
    <RangePicker v-model="days" />
  </div>
  <ThreatList v-if="tab === 'me'" ref="threats" :days="Math.min(days, 3650)" />
  <div v-if="tab === 'alliance' && error" class="error">{{ error }}</div>
  <template v-if="tab === 'alliance' && data">
    <h2>{{ t('hostile.whoSpies') }}</h2>
    <div class="table-wrap" data-tour="hostile-who" style="max-height: 40vh; margin-bottom: 14px">
      <table v-stack class="data">
        <thead><tr><th>{{ t('common.player') }}</th><th class="num">{{ t('hostile.count') }}</th><th class="num">{{ t('hostile.victims') }}</th><th>{{ t('hostile.last') }}</th></tr></thead>
        <tbody>
          <tr v-for="s in data.bySpy" :key="s.from_player">
            <td>
              <PlayerLink v-if="s.from_player_id" :id="s.from_player_id" :name="s.from_player" />
              <span v-else>{{ s.from_player }}</span>
            </td>
            <td class="num">{{ s.count }}</td>
            <td class="num">{{ s.victims }}</td>
            <td class="small">{{ ago(s.last) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <h2>{{ t('hostile.history') }}</h2>
    <div class="table-wrap" data-tour="hostile-history">
      <table v-stack class="data">
        <thead><tr><th>{{ t('common.time') }}</th><th>{{ t('hostile.spy') }}</th><th>{{ t('common.from') }}</th><th>{{ t('hostile.target') }}</th><th>{{ t('hostile.member') }}</th></tr></thead>
        <tbody>
          <tr v-for="h in historyLimit.shown.value" :key="h.id">
            <td class="small">{{ dateTime(h.time) }}</td>
            <td>
              <PlayerLink v-if="h.from_player_id" :id="h.from_player_id" :name="h.from_player" />
              <span v-else>{{ h.from_player }}</span>
            </td>
            <td class="mono">{{ coords(h.from_g, h.from_s, h.from_p) }}{{ h.from_type === 'moon' ? ' ' + t('game.moonShort') : '' }} <span class="muted">{{ h.from_planet }}</span></td>
            <td class="mono">{{ coords(h.target_g, h.target_s, h.target_p) }}{{ h.target_type === 'moon' ? ' ' + t('game.moonShort') : '' }} <span class="muted">{{ h.target_planet }}</span></td>
            <td>{{ h.username }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <ShowMore :limit="historyLimit" />
  </template>
</template>
