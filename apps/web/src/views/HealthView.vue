<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import type { AllianceHealth, HealthMember } from '../apiTypes';
import Hint from '../components/Hint.vue';
import Loading from '../components/Loading.vue';
import PageHeader from '../components/PageHeader.vue';
import PlayerLink from '../components/PlayerLink.vue';
import FreshnessScore from '../components/FreshnessScore.vue';
import AllianceGoals from '../components/AllianceGoals.vue';
import HealthBadges from '../components/HealthBadges.vue';
import HealthRanking from '../components/HealthRanking.vue';
import HealthRecap from '../components/HealthRecap.vue';
import { loadAchievements } from '../achievements';
import { useClock } from '../clock';
import { useLoader, useMobile, useStored, useUni } from '../composables';
import { ago, dateTime, fmt, fmtSigned, freshnessColor, short } from '../format';
import { tables, useLiveReload } from '../live';
import { useAutoTour } from '../tours';

/**
 * Alliance health for every member (server: repo/health.ts): who grows, who falls behind, who still syncs and
 * visits the hub, raids and expeditions of the week and open loot deliveries.
 */
type Member = HealthMember;

const { t } = useI18n();
const { uni } = useUni();
const mobile = useMobile();
const now = useClock();
const { data, error, load } = useLoader(() => uniApi<AllianceHealth>(uni.value, '/alliance-health'));
onMounted(load);
useLiveReload(load, tables('empire', 'player_scores', 'overview', 'fleets', 'galaxy_systems'));
/** Tabs: the members' health, streaks & badges, the ranking, the recap; from the link (`?tab=`), else the last one. */
type Tab = 'members' | 'badges' | 'ranking' | 'recap';
const TABS: Tab[] = ['members', 'badges', 'ranking', 'recap'];
const route = useRoute();
const router = useRouter();
const storedTab = useStored<Tab>('health.tab', 'members');
const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : TABS.includes(storedTab.value) ? storedTab.value : 'members'),
  set: (v) => {
    storedTab.value = v;
    router.replace({ query: { ...route.query, tab: v } });
  },
});
watch(tab, (v) => v === 'badges' && loadAchievements(uni.value, true), { immediate: true });
useAutoTour('health', () => !!data.value, tab);
const onlyFlagged = useStored('health.onlyFlagged', false);

/** the page types shown, several types in one column */
const COLUMNS: { key: string; types: string[] }[] = [
  { key: 'empire', types: ['empire'] },
  { key: 'fleets', types: ['overview', 'fleets'] },
  { key: 'buildings', types: ['buildings', 'research'] },
  { key: 'galaxy', types: ['galaxy'] },
  { key: 'stats', types: ['stats'] },
  { key: 'messages', types: ['messages'] },
];
const syncOf = (m: Member, types: string[]) => Math.max(0, ...types.map((x) => m.syncs[x] ?? 0)) || null;
const rows = computed(() =>
  [...(data.value?.members ?? [])]
    .filter((m) => !onlyFlagged.value || m.flags.length)
    .sort((a, b) => b.flags.length - a.flags.length || (b.points ?? -1) - (a.points ?? -1)),
);
/** growth as a share of the alliance median */
const share = (m: Member) => (m.growth != null && data.value?.medianGrowth ? m.growth / data.value.medianGrowth : null);
const growthClass = (m: Member) => (m.flags.includes('behind') ? 'neg' : (share(m) ?? 0) >= 1 ? 'pos' : '');
const age = (time: number | null) => (time ? { text: ago(time), color: freshnessColor(now.value - time), title: dateTime(time) } : null);
const flagged = computed(() => (data.value?.members ?? []).filter((m) => m.flags.length).length);
</script>

<template>
  <PageHeader :title="t('health.title')" tour="health">
    <template #hint>
      <Hint>
        <p>{{ t('health.hint1') }}</p>
        <p>{{ t('health.hint2') }}</p>
      </Hint>
    </template>
    <div class="seg">
      <button v-for="x in TABS" :key="x" :data-tour="`health-tab-${x}`" :class="{ active: tab === x }" @click="tab = x">{{ t(`health.tab.${x}`) }}</button>
    </div>
  </PageHeader>

  <HealthBadges v-if="tab === 'badges'" />
  <HealthRanking v-else-if="tab === 'ranking'" />
  <HealthRecap v-else-if="tab === 'recap'" />
  <template v-else>
    <AllianceGoals data-tour="health-goals" store-key="goals.health" />
    <div v-if="error" class="error">{{ error }}</div>
    <Loading v-else-if="!data" :lines="6" />
    <template v-else-if="data">
      <div class="card row small" data-tour="health-summary">
        <span>{{ t('health.members', { n: data.members.length }) }}</span>
        <span :class="flagged ? 'warn' : 'pos'">{{ t('health.flagged', { n: flagged }) }}</span>
        <span v-if="data.medianGrowth != null" class="muted">{{ t('health.median', { n: fmtSigned(Math.round(data.medianGrowth)) }) }}</span>
        <span class="grow" />
        <label class="check"><input v-model="onlyFlagged" type="checkbox" /> {{ t('health.onlyFlagged') }}</label>
      </div>

      <div v-if="mobile" class="hl-cards" data-tour="health-list">
        <div v-for="m in rows" :key="m.userId" class="card hl-card small">
          <div class="row">
            <b>{{ m.name }}</b>
            <span v-if="m.ingameName" class="muted small">{{ m.ingameName }}</span>
            <span class="grow" />
            <FreshnessScore :freshness="m.freshness" />
            <span v-for="f in m.flags" :key="f" class="badge" :class="f === 'behind' ? 'neg' : 'warn'">{{ t(`health.flag.${f}`) }}</span>
          </div>
          <div>
            <template v-if="m.points != null">{{ fmt(m.points) }} <span class="muted">#{{ m.rank }}</span> · </template>
            <span :class="growthClass(m)">{{ m.growth != null ? fmtSigned(m.growth) : '–' }}</span> <span class="muted">{{ t('health.perWeek') }}</span>
          </div>
          <div class="hl-syncs">
            <span v-for="c in COLUMNS" :key="c.key">
              <span class="muted">{{ t(`health.col.${c.key}`) }}</span>
              <span v-if="age(syncOf(m, c.types))" :style="{ color: age(syncOf(m, c.types))!.color }">{{ age(syncOf(m, c.types))!.text }}</span>
              <span v-else class="faint">–</span>
            </span>
          </div>
          <div class="muted">
            <span :title="m.onlineHidden ? t('health.hidden') : undefined">{{ t('health.hub') }} {{ m.lastSeen ? ago(m.lastSeen) : '–' }}</span> · {{ t('health.battlesShort', { n: m.battles }) }} · {{ t('health.expeditionsShort', { n: m.expeditions }) }}
            <span v-if="m.openDeliveries" class="warn"> · {{ t('health.deliveries', { n: m.openDeliveries }) }}</span>
          </div>
        </div>
      </div>
      <div v-else class="card scroll-x" data-tour="health-list">
        <table class="data">
          <thead>
            <tr>
              <th>{{ t('health.member') }}</th>
              <th class="num">{{ t('health.points') }}</th>
              <th class="num" :title="t('health.growthTitle')">{{ t('health.growth') }}</th>
              <th>{{ t('health.hub') }}</th>
              <th class="num" :title="t('ownFresh.columnTitle')" data-tour="health-freshness">{{ t('ownFresh.label') }}</th>
              <th v-for="c in COLUMNS" :key="c.key">{{ t(`health.col.${c.key}`) }}</th>
              <th class="num" :title="t('health.battlesTitle')">{{ t('health.battles') }}</th>
              <th class="num">{{ t('health.expeditions') }}</th>
              <th class="num" :title="t('health.deliveriesTitle')">{{ t('health.open') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in rows" :key="m.userId">
              <td>
                <PlayerLink v-if="m.player" :id="m.player.id" :name="m.name" />
                <span v-else>{{ m.name }}</span>
                <span v-if="m.role === 'admin'" class="faint small"> · {{ t('health.admin') }}</span>
                <div v-if="m.ingameName" class="muted small">{{ m.ingameName }}</div>
                <div v-if="m.flags.length" class="hl-flags">
                  <span v-for="f in m.flags" :key="f" class="badge" :class="f === 'behind' ? 'neg' : 'warn'" :title="t(`health.flagTitle.${f}`)">{{ t(`health.flag.${f}`) }}</span>
                </div>
              </td>
              <td class="num">{{ m.points != null ? short(m.points) : '–' }}<span v-if="m.rank" class="faint small"> #{{ m.rank }}</span></td>
              <td class="num" :class="growthClass(m)" :title="m.partial ? t('health.partial') : undefined">
                {{ m.growth != null ? fmtSigned(m.growth) : '–' }}<span v-if="m.partial" class="faint">*</span>
              </td>
              <td class="small" :style="age(m.lastSeen) ? { color: age(m.lastSeen)!.color } : undefined" :title="m.onlineHidden ? t('health.hidden') : age(m.lastSeen)?.title">{{ age(m.lastSeen)?.text ?? '–' }}</td>
              <td class="num"><FreshnessScore :freshness="m.freshness" /></td>
              <td v-for="c in COLUMNS" :key="c.key" class="small" :title="age(syncOf(m, c.types))?.title">
                <span v-if="age(syncOf(m, c.types))" :style="{ color: age(syncOf(m, c.types))!.color }">{{ age(syncOf(m, c.types))!.text }}</span>
                <span v-else class="faint">–</span>
              </td>
              <td class="num" :title="t('health.lootTitle', { n: fmt(m.loot) })">{{ m.battles }}</td>
              <td class="num">{{ m.expeditions }}</td>
              <td class="num" :class="{ warn: m.openDeliveries }">{{ m.openDeliveries || '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>
</template>

<style scoped>
.hl-cards { display: flex; flex-direction: column; gap: 8px; }
.hl-card { display: flex; flex-direction: column; gap: 4px; margin: 0; }
.hl-syncs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px 10px; }
.hl-syncs > span { display: flex; justify-content: space-between; gap: 4px; }
.badge.neg { color: var(--neg); }
.badge.warn { color: var(--warn); }
.hl-flags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.row .badge + .badge { margin-left: 4px; }
</style>
