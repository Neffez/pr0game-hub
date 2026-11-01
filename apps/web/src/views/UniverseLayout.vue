<script setup lang="ts">
import { nowSec } from '../clock';
import Loading from '../components/Loading.vue';
import LiveToasts from '../components/LiveToasts.vue';
import Icon from '../components/Icon.vue';
import NotificationBell from '../components/NotificationBell.vue';
import PresenceList from '../components/PresenceList.vue';
import PlayerDialog from '../components/PlayerDialog.vue';
import SyncSheet from '../components/SyncSheet.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { selectGroup, selectedGroup, session, uniApi } from '../api';
import { provideUni, useLoader, useScrollLock, type UniContext } from '../composables';
import { clearClaims, loadClaims } from '../claims';
import { dateTime, setMarketRate, setToolsUrl, toolsIndexUrl } from '../format';
import { freezeClock } from '../clock';
import { clearCommentCounts, loadCommentCounts } from '../comments';
import { attacks, clearNotifications, loadNotifications } from '../notifications';
import { planCounts, type AttackPlan } from '../plans';
import { startLive, stopLive, tables, useLiveReload, useWhereabouts } from '../live';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const uni = computed(() => String(route.params.uni));
const { data: ctx, error, load: fetchContext } = useLoader(() => uniApi<UniContext>(uni.value, '/context'));
const groups = computed(() => session.me?.groups.filter((g) => g.universe === uni.value) ?? []);
const group = ref<number | null>(null);
const reloadKey = ref(0);

provideUni(ctx);
// set before the children render their tool links (they only render once the context is there)
watch(ctx, (c) => setToolsUrl(c?.toolsUrl), { flush: 'sync', immediate: true });
const toolsUrl = computed(() => toolsIndexUrl(ctx.value?.universe.settings));
watch(() => ctx.value?.marketRate, setMarketRate, { flush: 'sync', immediate: true });
// an ended universe stands still at its end: resources, countdowns and "ago" times stop there
const endedAt = computed(() => ctx.value?.universe.endedAt ?? null);
watch(endedAt, freezeClock, { flush: 'sync', immediate: true });
onBeforeUnmount(() => freezeClock(null));

function load() {
  // a link with the group (push notification) opens that alliance
  const wanted = Number(route.query.group);
  if (wanted) {
    if (groups.value.some((g) => g.id === wanted)) selectGroup(uni.value, wanted);
    // once: a later switch of the group must not be undone by it
    router.replace({ query: { ...route.query, group: undefined } });
  }
  group.value = selectedGroup(uni.value);
  startLive(uni.value, group.value);
  clearClaims();
  loadClaims(uni.value);
  clearCommentCounts();
  loadCommentCounts(uni.value);
  clearNotifications();
  loadNotifications(uni.value);
  plans.value = [];
  loadPlans();
  return fetchContext();
}
useLiveReload(() => loadClaims(uni.value), tables('target_claims'));
useLiveReload(() => loadCommentCounts(uni.value), tables('comments'), 300);
useLiveReload(() => loadNotifications(uni.value), tables('fleets', 'attack_plans', 'comments', 'empire', 'overview', 'buildings', 'research', 'building_alerts', 'fleet_alerts'), 300);
// launches come up by the clock (an hour ahead), without any data event
const notifyTimer = setInterval(() => !document.hidden && loadNotifications(uni.value), 5 * 60_000);
onBeforeUnmount(() => clearInterval(notifyTimer));

/** Raid planner in the menu: current plans in planning (grey) and running (green); recounted every minute. */
const plans = ref<AttackPlan[]>([]);
const minute = ref(nowSec());
const minuteTimer = setInterval(() => (minute.value = nowSec()), 60_000);
onBeforeUnmount(() => clearInterval(minuteTimer));
async function loadPlans() {
  try {
    plans.value = await uniApi<AttackPlan[]>(uni.value, '/plans');
  } catch {
    /* kept until the next reload */
  }
}
const planCount = computed(() => planCounts(plans.value, minute.value));
useLiveReload(loadPlans, tables('attack_plans', 'fleets'), 300);
onBeforeUnmount(stopLive);
// own research and planets for flight times come from the own empire page, the own points (noob protection) from the statistics
useLiveReload(fetchContext, (e) => (tables('empire')(e) && e.userId === ctx.value?.me.id) || tables('group_members', 'player_scores', 'market_rates', 'universe')(e));

function changeGroup() {
  navOpen.value = false;
  if (group.value) selectGroup(uni.value, group.value);
  ctx.value = null;
  reloadKey.value++;
  load();
}

// the previous universe's context must never outlive the switch: views and the sync panel would act on it
watch(uni, (_, before) => {
  if (before !== undefined) {
    ctx.value = null;
    reloadKey.value++;
  }
  load();
}, { immediate: true });

/** Sidebar: `label`/`section` are message keys below nav.* */
const links = [
  { to: 'paste', label: 'sync', icon: 'sync' },
  { section: 'start' },
  { to: 'overview', label: 'overview', icon: 'overview' },
  { to: 'stats', label: 'stats', icon: 'stats' },
  { to: 'imperium', label: 'imperium', icon: 'imperium' },
  { to: 'build', label: 'build', icon: 'buildings' },
  { to: 'market', label: 'market', icon: 'market' },
  { section: 'recon' },
  { to: 'browse', label: 'galaxy', icon: 'galaxy' },
  { to: 'spy', label: 'spy', icon: 'spy' },
  { to: 'hostile', label: 'hostile', icon: 'hostile' },
  { to: 'activity', label: 'activity', icon: 'activity' },
  { to: 'messages', label: 'messages', icon: 'messages' },
  { section: 'alliance' },
  { to: 'planets', label: 'planets', icon: 'planets' },
  { to: 'fleet', label: 'fleet', icon: 'fleet' },
  { to: 'research', label: 'research', icon: 'research' },
  { section: 'combat' },
  { to: 'targets', label: 'targets', icon: 'targets' },
  { to: 'raid-planner', label: 'raidPlanner', icon: 'raidPlanner' },
  { to: 'raids', label: 'raids', icon: 'raids' },
  { to: 'battle-hall', label: 'battleHall', icon: 'battleHall' },
  { to: 'expeditions', label: 'expeditions', icon: 'expeditions' },
  { to: 'deck', label: 'deck', icon: 'deck' },
];

/** Tell the other members where this tab is: page, galaxy system, player (page or dialog). */
const num = (v: unknown) => (v != null && Number(v) > 0 ? Number(v) : undefined);
const reportWhereabouts = useWhereabouts(
  () => uni.value,
  () => {
    const [, , page, id] = route.path.split('/');
    const browse = page === 'browse';
    return {
      page: page ?? null,
      g: browse ? num(route.query.g) : undefined,
      s: browse ? num(route.query.s) : undefined,
      player: num(route.query.player) ?? (page === 'player' ? num(id) : undefined),
    };
  },
);
watch(() => route.fullPath, () => reportWhereabouts(), { immediate: true });
watch(group, () => reportWhereabouts(true));

/** Sidebar label of a page (message key below nav.*). */
const pageLabel = (page: string | null) => {
  const l = [...links, { to: 'admin', label: 'admin' }, { to: 'account', label: 'user' }, { to: 'changelog', label: 'changelog' }, { to: 'player', label: 'player' }].find((x) => x.to === page);
  return l?.label ? t(`nav.${l.label}`) : '';
};

/** Mobile: sidebar as flyout drawer ("More" in the tab bar), sync as bottom sheet. */
const navOpen = ref(false);
const syncOpen = ref(false);
useScrollLock(navOpen);
watch(() => route.path, () => {
  navOpen.value = false;
  syncOpen.value = false;
});
function onKey(e: KeyboardEvent) {
  if (navOpen.value && e.key === 'Escape') navOpen.value = false;
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

/** Swipe the open drawer to the left to close it. */
let touchX: number | null = null;
function onTouchEnd(e: TouchEvent) {
  if (touchX != null && touchX - e.changedTouches[0].clientX > 60) navOpen.value = false;
  touchX = null;
}

/** Page title in the mobile top bar. */
const pageTitle = computed(() => {
  const page = route.path.split('/')[2];
  const l = [...links, { to: 'admin', label: 'admin' }, { to: 'account', label: 'user' }, { to: 'changelog', label: 'changelog' }].find((x) => x.to === page);
  return l ? t(`nav.${l.label}`) : (ctx.value?.universe.name ?? uni.value);
});

/** Bottom tab bar: frequent pages around the sync button in the middle. */
/** The drawer holds pages with something waiting (attacks on members, raid plans): counted on "More". */
const moreTitle = computed(() =>
  [
    attacks.value ? t('notify.attacks', { n: attacks.value }, attacks.value) : '',
    planCount.value.running ? t('nav.plansRunning', { n: planCount.value.running }, planCount.value.running) : '',
    planCount.value.planning ? t('nav.plansPlanning', { n: planCount.value.planning }, planCount.value.planning) : '',
  ].filter(Boolean).join(' · ') || undefined,
);
const tabs = [
  { to: 'overview', label: 'overview', icon: 'overview' },
  { to: 'imperium', label: 'imperiumShort', icon: 'imperium' },
  { to: 'activity', label: 'activity', icon: 'activity' },
];
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <a class="brand" :href="toolsUrl" :title="t('nav.toolsLink')">pr0game <span>Hub</span></a>
      <span class="topbar-title">{{ pageTitle }}</span>
      <NotificationBell v-if="ctx" />
    </header>
    <div v-if="navOpen" class="nav-backdrop" @click="navOpen = false" />
    <aside
      id="sidebar"
      class="sidebar"
      :class="{ open: navOpen }"
      @touchstart.passive="touchX = $event.touches[0].clientX"
      @touchend="onTouchEnd"
    >
      <div class="brand">
        <a :href="toolsUrl" :title="t('nav.toolsLink')">pr0game <span>Hub</span></a>
        <NotificationBell v-if="ctx" class="sidebar-bell" />
        <button class="nav-close" :title="t('nav.closeMenu')" :aria-label="t('nav.closeMenu')" @click="navOpen = false"><Icon name="close" /></button>
      </div>
      <div class="section">{{ ctx?.universe.name ?? uni }}</div>
      <select v-if="groups.length > 1" v-model="group" @change="changeGroup">
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
      <div v-else-if="ctx" class="muted small" style="padding: 0 10px">{{ t('nav.allianceName', { name: ctx.group.name }) }}</div>
      <nav>
        <template v-for="l in links.filter((x) => endedAt == null || x.to !== 'paste')" :key="l.to ?? l.section">
          <div v-if="l.section" class="section">{{ t(`nav.${l.section}`) }}</div>
          <RouterLink v-else :to="`/${uni}/${l.to}`">
            <Icon :name="l.icon!" />{{ t(`nav.${l.label}`) }}
            <span v-if="l.to === 'fleet' && attacks" class="nav-alarm" :title="t('notify.attacks', { n: attacks }, attacks)"><Icon name="attack" :size="11" /> {{ attacks }}</span>
            <span v-if="l.to === 'raid-planner' && (planCount.planning || planCount.running)" class="nav-badges">
              <span v-if="planCount.planning" class="nav-count" :title="t('nav.plansPlanning', { n: planCount.planning }, planCount.planning)">{{ planCount.planning }}</span>
              <span v-if="planCount.running" class="nav-count running" :title="t('nav.plansRunning', { n: planCount.running }, planCount.running)">{{ planCount.running }}</span>
            </span>
          </RouterLink>
        </template>
        <div class="section">{{ t('nav.account') }}</div>
        <RouterLink :to="{ path: '/', query: { list: null } }"><Icon name="universes" />{{ t('nav.universes') }}</RouterLink>
        <RouterLink v-if="session.me?.user?.isAdmin || ctx?.group.role === 'admin'" :to="`/${uni}/admin`"><Icon name="admin" />{{ t('nav.admin') }}</RouterLink>
        <RouterLink :to="`/${uni}/account`"><Icon name="user" />{{ t('nav.user') }}</RouterLink>
        <RouterLink :to="`/${uni}/changelog`"><Icon name="changelog" />{{ t('nav.changelog') }}</RouterLink>
      </nav>
      <PresenceList v-if="ctx" :page-label="pageLabel" @navigate="navOpen = false" />
    </aside>
    <main class="main">
      <div v-if="error" class="error">{{ error }}</div>
      <template v-else-if="ctx">
        <div v-if="endedAt != null" class="warn ended-banner">{{ t('nav.universeEnded', { time: dateTime(endedAt) }) }}</div>
        <RouterView :key="reloadKey" />
        <PlayerDialog />
        <SyncSheet v-if="endedAt == null" v-model="syncOpen" />
        <LiveToasts />
      </template>
      <Loading v-else :lines="5" />
    </main>
    <nav class="tabbar" :aria-label="t('nav.menu')">
      <RouterLink v-for="tb in tabs.slice(0, 2)" :key="tb.to" :to="`/${uni}/${tb.to}`"><Icon :name="tb.icon" />{{ t(`nav.${tb.label}`) }}</RouterLink>
      <button v-if="endedAt == null" class="tab-sync" :class="{ active: syncOpen }" :aria-label="t('nav.quickSync')" @click="syncOpen = !syncOpen">
        <span class="sync-dot"><Icon name="sync" /></span>{{ t('nav.syncShort') }}
      </button>
      <RouterLink v-for="tb in tabs.slice(2)" :key="tb.to" :to="`/${uni}/${tb.to}`"><Icon :name="tb.icon" />{{ t(`nav.${tb.label}`) }}</RouterLink>
      <button :class="{ active: navOpen }" aria-controls="sidebar" :aria-expanded="navOpen" :title="moreTitle" @click="navOpen = !navOpen">
        <span class="tab-icon">
          <Icon name="menu" />
          <span v-if="attacks || planCount.running || planCount.planning" class="tab-badge" :class="{ alarm: attacks, running: !attacks && planCount.running }">
            {{ attacks || planCount.running + planCount.planning }}
          </span>
        </span>
        {{ t('nav.more') }}
      </button>
    </nav>
  </div>
</template>
