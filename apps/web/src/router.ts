import { createRouter, createWebHistory } from 'vue-router';
import { loadMe, session } from './api';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/invite/:token', component: () => import('./views/InviteView.vue'), meta: { public: true } },
    { path: '/', component: () => import('./views/HomeView.vue') },
    { path: '/admin', component: () => import('./views/AdminView.vue') },
    { path: '/account', component: () => import('./views/AccountView.vue') },
    { path: '/changelog', component: () => import('./views/ChangelogView.vue') },
    {
      path: '/:uni',
      component: () => import('./views/UniverseLayout.vue'),
      children: [
        { path: '', redirect: (to) => `/${to.params.uni}/overview` },
        { path: 'paste', component: () => import('./views/PasteView.vue') },
        { path: 'universe-json', redirect: (to) => `/${to.params.uni}/paste` },
        { path: 'overview', component: () => import('./views/OverviewView.vue') },
        { path: 'imperium', component: () => import('./views/ImperiumView.vue') },
        { path: 'build', component: () => import('./views/BuildView.vue') },
        // older links (push notifications) to the buildings page
        { path: 'buildings', redirect: (to) => ({ path: `/${to.params.uni}/build`, query: { tab: 'buildings', ...to.query } }) },
        { path: 'stats', component: () => import('./views/StatsView.vue') },
        { path: 'browse', component: () => import('./views/UniverseBrowserView.vue') },
        { path: 'activity', component: () => import('./views/ActivityView.vue') },
        { path: 'battle-hall', component: () => import('./views/BattleHallView.vue') },
        { path: 'battle-hall/:id', component: () => import('./views/CombatReportView.vue') },
        { path: 'player/:id', component: () => import('./views/PlayerView.vue') },
        { path: 'spy', component: () => import('./views/SpyView.vue') },
        { path: 'planets', component: () => import('./views/AllianceView.vue'), meta: { page: 'planets' } },
        { path: 'fleet', component: () => import('./views/AllianceView.vue'), meta: { page: 'fleet' } },
        { path: 'research', component: () => import('./views/AllianceView.vue'), meta: { page: 'research' } },
        // freshness heat map is part of the galaxy page now
        { path: 'galaxy', redirect: (to) => `/${to.params.uni}/browse` },
        { path: 'raid-planner', component: () => import('./views/RaidPlannerView.vue') },
        { path: 'raid-planner/:id(\\d+)', component: () => import('./views/RaidPlanView.vue') },
        { path: 'raid-planner/:id/loot', component: () => import('./views/LootSettlementView.vue') },
        { path: 'raids', component: () => import('./views/RaidsView.vue') },
        { path: 'targets', component: () => import('./views/TargetsView.vue') },
        { path: 'expeditions', component: () => import('./views/ExpeditionsView.vue') },
        { path: 'deck', component: () => import('./views/DeckView.vue') },
        { path: 'alliance', redirect: (to) => `/${to.params.uni}/planets` },
        { path: 'hostile', component: () => import('./views/HostileView.vue') },
        { path: 'messages', component: () => import('./views/MessagesView.vue') },
        // also top level (start page); inside a universe they keep the sidebar
        { path: 'admin', component: () => import('./views/AdminView.vue') },
        { path: 'account', component: () => import('./views/AccountView.vue') },
        { path: 'changelog', component: () => import('./views/ChangelogView.vue') },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  if (!session.loaded) {
    try {
      await loadMe();
    } catch {
      session.loaded = true;
    }
  }
  if (!to.meta.public && !session.me?.user) return { path: '/login', query: { next: to.fullPath } };
});

// After a deploy an already open tab may reference asset chunks that no longer exist: reload once.
router.onError((err, to) => {
  const msg = String((err as Error)?.message ?? err);
  if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(msg)) {
    const key = 'hub.chunkReload';
    let last: string | null = null;
    try {
      last = sessionStorage.getItem(key);
      sessionStorage.setItem(key, to.fullPath);
    } catch {
      /* storage unavailable */
    }
    if (last !== to.fullPath) location.assign(import.meta.env.BASE_URL.replace(/\/$/, '') + to.fullPath);
  }
});
