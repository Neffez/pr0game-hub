/**
 * Page tours: a short guided explanation of a page (driver.js), started automatically the first time a user opens
 * it and again from the "?" button in the page header. Which tours were seen and whether they start on their own
 * is stored on the account (`POST /api/auth/tours`).
 */
import { driver, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { computed, nextTick, onBeforeUnmount, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { api, session } from './api';
import { t } from './i18n';

/** One step: `el` is the value of a `data-tour` attribute (no element = centered popover). */
export interface TourStep {
  key: string;
  el?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** content of these tabs: in the whole tour only on them, else in the tab's own tour on its first visit */
  tabs?: string[];
  /** the button of this tab: also the first step of the tab's own tour */
  head?: string;
}
export interface Tour {
  steps: TourStep[];
}

/**
 * Registry; the texts are `tours.<id>.<key>.title` and `.text` in the locales. Steps whose element is not on the
 * page (other tab, empty list, no data yet) are skipped, so a step may point at something that only shows sometimes.
 */
export const TOURS = {
  overview: {
    steps: [
      { key: 'intro' },
      { key: 'syncHints', el: 'overview-sync-hints', side: 'bottom' },
      { key: 'planets', el: 'overview-planets', side: 'bottom' },
      { key: 'players', el: 'overview-players', side: 'bottom' },
      { key: 'search', el: 'overview-search', side: 'bottom' },
      { key: 'filter', el: 'overview-filter', side: 'bottom' },
      { key: 'list', el: 'overview-list', side: 'top' },
      { key: 'actions', el: 'overview-actions', side: 'left' },
      { key: 'globalSearch', el: 'global-search', side: 'right' },
      { key: 'outro' },
    ],
  },
  paste: {
    steps: [
      { key: 'intro' },
      { key: 'copy', el: 'paste-sync', side: 'bottom' },
      { key: 'pages', el: 'paste-sync', side: 'bottom' },
      { key: 'source', el: 'paste-sync', side: 'bottom' },
      { key: 'hints', el: 'paste-hints', side: 'top' },
      { key: 'json', el: 'paste-json', side: 'top' },
      { key: 'outro' },
    ],
  },
  build: {
    steps: [
      { key: 'intro' },
      { key: 'buildings', el: 'build-tab-buildings', side: 'bottom', head: 'buildings' },
      { key: 'research', el: 'build-tab-research', side: 'bottom', head: 'research' },
      { key: 'ships', el: 'build-tab-ships', side: 'bottom', head: 'ships' },
      { key: 'order', el: 'build-tab-order', side: 'bottom', head: 'order' },
      { key: 'advisor', el: 'build-tab-advisor', side: 'bottom', head: 'advisor' },
      { key: 'defense', el: 'build-tab-defense', side: 'bottom', head: 'defense' },
      { key: 'planet', el: 'build-planet', side: 'bottom' },
      { key: 'researchList', el: 'build-list', side: 'top', tabs: ['research'] },
      { key: 'amount', el: 'build-amount', side: 'left', tabs: ['ships'] },
      { key: 'orderHead', el: 'build-order-head', side: 'bottom', tabs: ['order'] },
      { key: 'orderList', el: 'build-order-list', side: 'top', tabs: ['order'] },
      { key: 'advisorList', el: 'build-advisor', side: 'top', tabs: ['advisor'] },
      { key: 'defenseRisk', el: 'build-defense-risk', side: 'bottom', tabs: ['defense'] },
      { key: 'defenseList', el: 'build-defense-threats', side: 'top', tabs: ['defense'] },
      { key: 'filter', el: 'build-filter', side: 'bottom', tabs: ['buildings', 'research', 'ships'] },
      { key: 'bell', el: 'build-bell', side: 'left', tabs: ['buildings', 'research'] },
      { key: 'hide', el: 'build-hide', side: 'left', tabs: ['buildings', 'research', 'ships'] },
      { key: 'outro' },
    ],
  },
  raids: {
    steps: [
      { key: 'intro' },
      { key: 'plans', el: 'raids-tab-plans', side: 'bottom', head: 'plans' },
      { key: 'settlements', el: 'raids-tab-settlements', side: 'bottom', head: 'settlements' },
      { key: 'stats', el: 'raids-tab-stats', side: 'bottom', head: 'stats' },
      { key: 'new', el: 'raids-new', side: 'bottom', tabs: ['plans'] },
      { key: 'phalanx', el: 'raids-phalanx', side: 'left', tabs: ['plans'] },
      { key: 'attacks', el: 'raids-attacks', side: 'top', tabs: ['plans'] },
      { key: 'own', el: 'raids-own', side: 'top', tabs: ['plans'] },
      { key: 'current', el: 'raids-current', side: 'top', tabs: ['plans'] },
      { key: 'targets', el: 'raids-targets', side: 'top', tabs: ['plans'] },
      { key: 'settleTools', el: 'raids-settle-tools', side: 'bottom', tabs: ['settlements'] },
      { key: 'settleList', el: 'raids-settle-list', side: 'top', tabs: ['settlements'] },
      { key: 'statsFilter', el: 'raids-stats-filter', side: 'bottom', tabs: ['stats'] },
      { key: 'statsPlayers', el: 'raids-stats-players', side: 'top', tabs: ['stats'] },
      { key: 'statsReports', el: 'raids-stats-reports', side: 'top', tabs: ['stats'] },
      { key: 'statsRecycling', el: 'raids-stats-recycling', side: 'top', tabs: ['stats'] },
      { key: 'statsMissiles', el: 'raids-stats-missiles', side: 'top', tabs: ['stats'] },
      { key: 'outro' },
    ],
  },
  loot: {
    steps: [
      { key: 'intro' },
      { key: 'status', el: 'loot-status', side: 'bottom' },
      { key: 'data', el: 'loot-data', side: 'bottom' },
      { key: 'mine', el: 'loot-mine', side: 'bottom' },
      { key: 'settings', el: 'loot-settings', side: 'right' },
      { key: 'participants', el: 'loot-participants', side: 'right' },
      { key: 'battles', el: 'loot-battles', side: 'right' },
      { key: 'recycling', el: 'loot-recycling', side: 'right' },
      { key: 'result', el: 'loot-result', side: 'left' },
      { key: 'transfers', el: 'loot-transfers', side: 'left' },
      { key: 'flow', el: 'loot-flow', side: 'top' },
      { key: 'comments', el: 'loot-comments', side: 'top' },
      { key: 'outro' },
    ],
  },
  stats: {
    steps: [
      { key: 'intro' },
      { key: 'who', el: 'stats-who', side: 'bottom' },
      { key: 'cats', el: 'stats-cats', side: 'bottom' },
      { key: 'table', el: 'stats-table', side: 'top' },
    ],
  },
  imperium: {
    steps: [
      { key: 'intro' },
      { key: 'member', el: 'imperium-member', side: 'bottom' },
      { key: 'points', el: 'imperium-points', side: 'bottom' },
      { key: 'phalanx', el: 'imperium-phalanx', side: 'top' },
      { key: 'fleets', el: 'imperium-fleets', side: 'top' },
      { key: 'planets', el: 'imperium-planets', side: 'top' },
    ],
  },
  market: {
    steps: [
      { key: 'intro' },
      { key: 'rate', el: 'market-rate', side: 'bottom' },
      { key: 'set', el: 'market-set', side: 'bottom' },
      { key: 'offers', el: 'market-offers', side: 'top' },
      { key: 'trades', el: 'market-trades', side: 'top' },
    ],
  },
  browse: {
    steps: [
      { key: 'intro' },
      { key: 'nav', el: 'browse-nav', side: 'bottom' },
      { key: 'strip', el: 'browse-strip', side: 'bottom' },
      { key: 'system', el: 'browse-system', side: 'top' },
      { key: 'phalanx', el: 'browse-phalanx', side: 'top' },
      { key: 'json', el: 'browse-json', side: 'left' },
    ],
  },
  spy: {
    steps: [
      { key: 'intro' },
      { key: 'form', el: 'spy-form', side: 'bottom' },
      { key: 'recent', el: 'spy-recent', side: 'top' },
    ],
  },
  hostile: {
    steps: [
      { key: 'intro' },
      { key: 'range', el: 'hostile-range', side: 'bottom' },
      { key: 'who', el: 'hostile-who', side: 'top' },
      { key: 'history', el: 'hostile-history', side: 'top' },
    ],
  },
  activity: {
    steps: [
      { key: 'intro' },
      { key: 'range', el: 'activity-range', side: 'bottom' },
      { key: 'kinds', el: 'activity-kinds', side: 'bottom' },
      { key: 'days', el: 'activity-days', side: 'top' },
    ],
  },
  messages: {
    steps: [
      { key: 'intro' },
      { key: 'mode', el: 'messages-mode', side: 'bottom' },
      { key: 'filter', el: 'messages-filter', side: 'bottom' },
      { key: 'list', el: 'messages-list', side: 'top' },
    ],
  },
  planets: {
    steps: [
      { key: 'intro' },
      { key: 'toolbar', el: 'alliance-toolbar', side: 'bottom' },
      { key: 'freshness', el: 'alliance-freshness', side: 'bottom' },
      { key: 'list', el: 'alliance-list', side: 'top' },
    ],
  },
  fleet: {
    steps: [
      { key: 'intro' },
      { key: 'tabs', el: 'alliance-fleet-tabs', side: 'bottom' },
      { key: 'freshness', el: 'alliance-freshness', side: 'bottom' },
      { key: 'list', el: 'alliance-list', side: 'top', tabs: ['movements'] },
      { key: 'units', el: 'alliance-list', side: 'top', tabs: ['ships', 'defense'] },
    ],
  },
  research: {
    steps: [
      { key: 'intro' },
      { key: 'toolbar', el: 'alliance-toolbar', side: 'bottom' },
      { key: 'freshness', el: 'alliance-freshness', side: 'bottom' },
      { key: 'list', el: 'alliance-list', side: 'top' },
    ],
  },
  battlehall: {
    steps: [
      { key: 'intro' },
      { key: 'sort', el: 'battlehall-sort', side: 'bottom' },
      { key: 'search', el: 'battlehall-search', side: 'bottom' },
      { key: 'memorial', el: 'battlehall-memorial', side: 'bottom' },
      { key: 'list', el: 'battlehall-list', side: 'top' },
    ],
  },
  health: {
    steps: [
      { key: 'intro' },
      { key: 'summary', el: 'health-summary', side: 'bottom' },
      { key: 'list', el: 'health-list', side: 'top' },
    ],
  },
  attack: {
    steps: [
      { key: 'intro' },
      { key: 'head', el: 'attack-head', side: 'bottom' },
      { key: 'sim', el: 'attack-sim', side: 'top' },
      { key: 'loot', el: 'attack-loot', side: 'top' },
      { key: 'save', el: 'attack-save', side: 'top' },
      { key: 'help', el: 'attack-help', side: 'top' },
    ],
  },
  fleetsave: {
    steps: [
      { key: 'intro' },
      { key: 'window', el: 'fleetsave-window', side: 'bottom' },
      { key: 'presets', el: 'fleetsave-presets', side: 'bottom' },
      { key: 'body', el: 'fleetsave-body', side: 'top' },
      { key: 'phalanx', el: 'fleetsave-phalanx', side: 'bottom' },
      { key: 'remind', el: 'fleetsave-remind', side: 'top' },
    ],
  },
  farm: {
    steps: [
      { key: 'intro' },
      { key: 'tabs', el: 'farm-tabs', side: 'bottom' },
      { key: 'flight', el: 'farm-flight', side: 'bottom' },
      { key: 'days', el: 'farm-days', side: 'bottom' },
      { key: 'filter', el: 'farm-filter', side: 'bottom' },
      { key: 'loot', el: 'farm-loot', side: 'bottom' },
      { key: 'rank', el: 'farm-rank', side: 'bottom' },
      { key: 'inactivity', el: 'farm-inactivity', side: 'bottom' },
      { key: 'risk', el: 'farm-risk', side: 'left' },
      { key: 'list', el: 'farm-list', side: 'top' },
    ],
  },
  expeditions: {
    steps: [
      { key: 'intro' },
      { key: 'stats', el: 'expo-tab-stats', side: 'bottom', head: 'stats' },
      { key: 'deck', el: 'expo-tab-deck', side: 'bottom', head: 'deck' },
      { key: 'yields', el: 'expo-yields', side: 'top', tabs: ['stats'] },
      { key: 'distribution', el: 'expo-distribution', side: 'top', tabs: ['stats'] },
      { key: 'recent', el: 'expo-recent', side: 'top', tabs: ['stats'] },
      { key: 'deckSummary', el: 'expo-deck-summary', side: 'bottom', tabs: ['deck'] },
      { key: 'deckCards', el: 'expo-deck-cards', side: 'top', tabs: ['deck'] },
      { key: 'deckAdd', el: 'expo-deck-add', side: 'top', tabs: ['deck'] },
    ],
  },
  account: {
    steps: [
      { key: 'intro' },
      { key: 'general', el: 'account-general', side: 'right' },
      { key: 'push', el: 'account-push', side: 'left' },
      { key: 'discord', el: 'account-discord', side: 'top' },
      { key: 'sharing', el: 'account-sharing', side: 'top' },
      { key: 'login', el: 'account-login', side: 'top' },
      { key: 'tokens', el: 'account-tokens', side: 'top' },
    ],
  },
  admin: {
    steps: [
      { key: 'intro' },
      { key: 'universes', el: 'admin-universes', side: 'top' },
      { key: 'access', el: 'admin-access', side: 'top' },
      { key: 'groups', el: 'admin-groups', side: 'top' },
      { key: 'members', el: 'admin-members', side: 'top' },
      { key: 'discord', el: 'admin-discord', side: 'top' },
      { key: 'fleetAttacks', el: 'admin-fleet-attacks', side: 'top' },
      { key: 'inactivity', el: 'admin-inactivity', side: 'top' },
      { key: 'crawler', el: 'admin-crawler', side: 'top' },
      { key: 'system', el: 'admin-system', side: 'top' },
      { key: 'backfill', el: 'admin-backfill', side: 'top' },
      { key: 'merge', el: 'admin-merge', side: 'top' },
      { key: 'ingests', el: 'admin-ingests', side: 'top' },
    ],
  },
} satisfies Record<string, Tour>;
export type TourId = keyof typeof TOURS;

type ToursState = { enabled: boolean; seen: string[] };

/** Tour state of the logged-in user (defaults while the session is not loaded). */
export const tours = computed<ToursState>(() => session.me?.user?.tours ?? { enabled: true, seen: [] });

/** Seen id of a tab's content: a tour seen on one tab doesn't cover the others. */
const tabSeenId = (id: TourId, tab: string) => `${id}-${tab}`;
const isSeen = (seenId: string) => tours.value.seen.includes(seenId);

let active: Driver | null = null;
/** The open tab of each page with tabs, set by the view (`useAutoTour`), for the "?" button. */
const openTab = new Map<TourId, () => string | undefined>();

/** The first visible element of a `data-tour` attribute (desktop and mobile variants may both exist). */
function findEl(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find((e) => e.offsetParent !== null || e.getClientRects().length > 0);
}

/** Stores a change and takes the server's state; throws on failure. */
async function post(body: { seen?: string; enabled?: boolean; reset?: true }) {
  const res = await api<ToursState>('/auth/tours', { body });
  if (session.me?.user) session.me.user.tours = res;
}
/**
 * Marks a tour (and the tab whose content it showed) as seen; with `never` also switches the automatic start off,
 * in the first request so the state can't race.
 */
async function finishTour(seen: string[], never: boolean) {
  // right away, so a tab switch just after closing doesn't start the same tour again
  const user = session.me?.user;
  if (user?.tours) user.tours = { enabled: never ? false : user.tours.enabled, seen: [...new Set([...user.tours.seen, ...seen])] };
  try {
    for (const [i, s] of seen.entries()) await post(never && i === 0 ? { seen: s, enabled: false } : { seen: s });
  } catch (e) {
    console.warn('tours: could not be saved', e);
  }
}
export const setToursEnabled = (enabled: boolean) => post({ enabled });
export const resetTours = () => post({ reset: true });

/** Ends the running tour without marking it as seen (page change: it comes back on the next visit). */
export function stopTour() {
  const d = active;
  active = null;
  // destroy() from code skips onDestroyStarted, so the tour is not marked as seen
  d?.destroy();
}

/**
 * The steps of a run. The whole tour: the general steps plus the content of the open tab. A tab's own tour
 * (`tabOnly`): its tab button, then its content that no tour of another tab has shown yet.
 */
function pickSteps(id: TourId, tab: string | undefined, tabOnly: boolean): TourStep[] {
  const steps = TOURS[id].steps as TourStep[];
  if (!tabOnly) return steps.filter((s) => !s.tabs || (tab != null && s.tabs.includes(tab)));
  if (tab == null) return [];
  return steps.filter((s) => s.head === tab || (s.tabs?.includes(tab) && !s.tabs.some((x) => x !== tab && isSeen(tabSeenId(id, x)))));
}

/**
 * Starts the tour; steps whose element is not on the page are dropped, and without any element left (or, for a tab's
 * own tour, without new content) nothing starts: returns whether it started. `auto: false` (the "?" button) runs it
 * even when tours are switched off. Closing or finishing marks it as seen, leaving the page does not.
 */
export function startTour(id: TourId, opts: { auto?: boolean; tabOnly?: boolean; waitForTab?: boolean } = {}): boolean {
  if (opts.auto && !tours.value.enabled) return false;
  const tab = openTab.get(id)?.();
  const steps: DriveStep[] = [];
  let content = false;
  let tabContent = false;
  const picked = pickSteps(id, tab, !!opts.tabOnly);
  for (const s of picked) {
    const popover = { title: t(`tours.${id}.${s.key}.title`), description: t(`tours.${id}.${s.key}.text`), side: s.side };
    if (!s.el) {
      steps.push({ popover });
      continue;
    }
    const el = findEl(s.el);
    if (!el) continue;
    steps.push({ element: el, popover });
    if (!opts.tabOnly || s.head !== tab) content = true;
    if (s.tabs) tabContent = true;
  }
  if (!content) return false;
  // the open tab's content may still be loading: `waitForTab` holds the start until some of it is there
  if (opts.waitForTab && !tabContent && picked.some((s) => s.tabs)) return false;
  stopTour();
  const seen: string[] = opts.tabOnly ? [] : [id];
  if (tab != null) seen.push(tabSeenId(id, tab));
  let ended = false;
  const finish = (never: boolean) => {
    if (!ended) void finishTour(seen, never);
    ended = true;
    if (active === drv) active = null;
    drv.destroy();
  };
  const drv: Driver = driver({
    steps,
    showProgress: true,
    progressText: t('tours.progress', { current: '{{current}}', total: '{{total}}' }),
    nextBtnText: t('tours.next'),
    prevBtnText: t('tours.prev'),
    doneBtnText: t('tours.done'),
    allowClose: true,
    smoothScroll: true,
    popoverClass: 'hub-tour',
    onPopoverRender: (popover) => {
      const never = document.createElement('button');
      never.type = 'button';
      never.className = 'hub-tour-never';
      never.textContent = t('tours.never');
      never.addEventListener('click', () => finish(true));
      popover.footerButtons.prepend(never);
    },
    // the user ends the tour (close button, Escape, overlay click, done); onDestroyed would miss a close during the
    // highlight animation, and also runs for destroy() from code
    onDestroyStarted: () => finish(false),
  });
  active = drv;
  drv.drive();
  return true;
}

/**
 * In a view: starts the tour the first time `ready` is true if tours are on and this one is unseen; leaving the view
 * cancels a pending start and ends a running tour. `id` may change while the view stays (one view for several menu
 * pages): the running tour then ends and the new page's tour gets its own first start. With `tab` (the open tab of a
 * page with tabs), the first visit of another tab after the tour starts that tab's own tour with what is new there.
 */
export function useAutoTour(id: MaybeRefOrGetter<TourId>, ready: MaybeRefOrGetter<boolean>, tab?: MaybeRefOrGetter<string | undefined>) {
  const done = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  const tabOf = () => (tab == null ? undefined : toValue(tab));
  const where = () => (alive ? `${toValue(id)}|${tabOf() ?? ''}` : '');
  const registered: TourId[] = [];
  watch(
    () => [toValue(id), tabOf(), toValue(ready) && !!session.me?.user] as const,
    async ([tid, tb, ok], old) => {
      if (tab != null && !openTab.has(tid)) {
        openTab.set(tid, tabOf);
        registered.push(tid);
      }
      if (old && (old[0] !== tid || old[1] !== tb)) {
        clearTimeout(timer);
        if (old[0] !== tid) stopTour();
      }
      const key = `${tid}|${tb ?? ''}`;
      if (!ok || done.has(key)) return;
      done.add(key);
      if (!tours.value.enabled) return;
      const tabOnly = isSeen(tid);
      if (tabOnly && (tb == null || isSeen(tabSeenId(tid, tb)))) return;
      await nextTick();
      // lists and sections (tabs load their own data) render a moment later: try for up to 3 seconds
      let tries = 0;
      const attempt = () => {
        if (where() !== key) return;
        if (startTour(tid, { auto: true, tabOnly, waitForTab: tries < 9 }) || ++tries >= 10) return;
        timer = setTimeout(attempt, 300);
      };
      timer = setTimeout(attempt, 300);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    alive = false;
    clearTimeout(timer);
    for (const tid of registered) if (openTab.get(tid) === tabOf) openTab.delete(tid);
    stopTour();
  });
}
