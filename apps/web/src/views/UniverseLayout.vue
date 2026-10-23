<script setup lang="ts">
import LiveToasts from '../components/LiveToasts.vue';
import NavIcon from '../components/NavIcon.vue';
import NotificationBell from '../components/NotificationBell.vue';
import PresenceList from '../components/PresenceList.vue';
import PlayerDialog from '../components/PlayerDialog.vue';
import SyncSheet from '../components/SyncSheet.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { selectGroup, selectedGroup, session, uniApi } from '../api';
import { provideUni, useLoader, useScrollLock, type UniContext } from '../composables';
import { clearClaims, loadClaims } from '../claims';
import { clearCommentCounts, loadCommentCounts } from '../comments';
import { attacks, clearNotifications, loadNotifications } from '../notifications';
import { planCounts, type AttackPlan } from '../plans';
import { startLive, stopLive, tables, useLiveReload, useWhereabouts } from '../live';

const { t } = useI18n();
const route = useRoute();
const uni = computed(() => String(route.params.uni));
const { data: ctx, error, load: fetchContext } = useLoader(() => uniApi<UniContext>(uni.value, '/context'));
const groups = computed(() => session.me?.groups.filter((g) => g.universe === uni.value) ?? []);
const group = ref<number | null>(null);
const reloadKey = ref(0);

provideUni(ctx);

function load() {
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
useLiveReload(() => loadNotifications(uni.value), tables('fleets'), 300);

/** Raid planner in the menu: current plans in planning (grey) and running (green); recounted every minute. */
const plans = ref<AttackPlan[]>([]);
const minute = ref(Math.floor(Date.now() / 1000));
const minuteTimer = setInterval(() => (minute.value = Math.floor(Date.now() / 1000)), 60_000);
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
// own research and planets for flight times come from the own empire page
useLiveReload(fetchContext, (e) => (tables('empire')(e) && e.userId === ctx.value?.me.id) || tables('group_members')(e));

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
  { to: 'imperium', label: 'imperium', icon: 'imperium' },
  { to: 'stats', label: 'stats', icon: 'stats' },
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
const tabs = [
  { to: 'overview', label: 'overview', icon: 'overview' },
  { to: 'imperium', label: 'imperiumShort', icon: 'imperium' },
  { to: 'activity', label: 'activity', icon: 'activity' },
];
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <span class="brand">pr0game <span>Hub</span></span>
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
        pr0game <span>Hub</span>
        <NotificationBell v-if="ctx" class="sidebar-bell" />
        <button class="nav-close" :title="t('nav.closeMenu')" :aria-label="t('nav.closeMenu')" @click="navOpen = false">✕</button>
      </div>
      <div class="section">{{ ctx?.universe.name ?? uni }}</div>
      <select v-if="groups.length > 1" v-model="group" @change="changeGroup">
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
      <div v-else-if="ctx" class="muted small" style="padding: 0 10px">{{ t('nav.allianceName', { name: ctx.group.name }) }}</div>
      <nav>
        <template v-for="l in links" :key="l.to ?? l.section">
          <div v-if="l.section" class="section">{{ t(`nav.${l.section}`) }}</div>
          <RouterLink v-else :to="`/${uni}/${l.to}`">
            <NavIcon :name="l.icon!" />{{ t(`nav.${l.label}`) }}
            <span v-if="l.to === 'fleet' && attacks" class="nav-alarm" :title="t('notify.attacks', { n: attacks }, attacks)">⚔ {{ attacks }}</span>
            <span v-if="l.to === 'raid-planner' && (planCount.planning || planCount.running)" class="nav-badges">
              <span v-if="planCount.planning" class="nav-count" :title="t('nav.plansPlanning', { n: planCount.planning }, planCount.planning)">{{ planCount.planning }}</span>
              <span v-if="planCount.running" class="nav-count running" :title="t('nav.plansRunning', { n: planCount.running }, planCount.running)">{{ planCount.running }}</span>
            </span>
          </RouterLink>
        </template>
        <div class="section">{{ t('nav.account') }}</div>
        <RouterLink :to="{ path: '/', query: { list: null } }"><NavIcon name="universes" />{{ t('nav.universes') }}</RouterLink>
        <RouterLink v-if="session.me?.user?.isAdmin || ctx?.group.role === 'admin'" :to="`/${uni}/admin`"><NavIcon name="admin" />{{ t('nav.admin') }}</RouterLink>
        <RouterLink :to="`/${uni}/account`"><NavIcon name="user" />{{ t('nav.user') }}</RouterLink>
        <RouterLink :to="`/${uni}/changelog`"><NavIcon name="changelog" />{{ t('nav.changelog') }}</RouterLink>
      </nav>
      <PresenceList v-if="ctx" :page-label="pageLabel" @navigate="navOpen = false" />
    </aside>
    <main class="main">
      <div v-if="error" class="error">{{ error }}</div>
      <template v-else-if="ctx">
        <RouterView :key="reloadKey" />
        <PlayerDialog />
        <SyncSheet v-model="syncOpen" />
        <LiveToasts />
      </template>
    </main>
    <nav class="tabbar" :aria-label="t('nav.menu')">
      <RouterLink v-for="tb in tabs.slice(0, 2)" :key="tb.to" :to="`/${uni}/${tb.to}`"><NavIcon :name="tb.icon" />{{ t(`nav.${tb.label}`) }}</RouterLink>
      <button class="tab-sync" :class="{ active: syncOpen }" :aria-label="t('nav.quickSync')" @click="syncOpen = !syncOpen">
        <span class="sync-dot"><NavIcon name="sync" /></span>{{ t('nav.syncShort') }}
      </button>
      <RouterLink v-for="tb in tabs.slice(2)" :key="tb.to" :to="`/${uni}/${tb.to}`"><NavIcon :name="tb.icon" />{{ t(`nav.${tb.label}`) }}</RouterLink>
      <button :class="{ active: navOpen }" aria-controls="sidebar" :aria-expanded="navOpen" @click="navOpen = !navOpen">
        <NavIcon name="menu" />{{ t('nav.more') }}
      </button>
    </nav>
  </div>
</template>
