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
      { key: 'planets', el: 'overview-planets', side: 'bottom' },
      { key: 'players', el: 'overview-players', side: 'bottom' },
      { key: 'search', el: 'overview-search', side: 'bottom' },
      { key: 'filter', el: 'overview-filter', side: 'bottom' },
      { key: 'list', el: 'overview-list', side: 'top' },
      { key: 'actions', el: 'overview-actions', side: 'left' },
      { key: 'outro' },
    ],
  },
  paste: {
    steps: [
      { key: 'intro' },
      { key: 'copy', el: 'paste-sync', side: 'bottom' },
      { key: 'pages', el: 'paste-sync', side: 'bottom' },
      { key: 'source', el: 'paste-sync', side: 'bottom' },
      { key: 'json', el: 'paste-json', side: 'top' },
      { key: 'outro' },
    ],
  },
  build: {
    steps: [
      { key: 'intro' },
      { key: 'buildings', el: 'build-tab-buildings', side: 'bottom' },
      { key: 'research', el: 'build-tab-research', side: 'bottom' },
      { key: 'ships', el: 'build-tab-ships', side: 'bottom' },
      { key: 'order', el: 'build-tab-order', side: 'bottom' },
      { key: 'planet', el: 'build-planet', side: 'bottom' },
      { key: 'filter', el: 'build-filter', side: 'bottom' },
      { key: 'bell', el: 'build-bell', side: 'left' },
      { key: 'hide', el: 'build-hide', side: 'left' },
      { key: 'outro' },
    ],
  },
  raids: {
    steps: [
      { key: 'intro' },
      { key: 'plans', el: 'raids-tab-plans', side: 'bottom' },
      { key: 'settlements', el: 'raids-tab-settlements', side: 'bottom' },
      { key: 'stats', el: 'raids-tab-stats', side: 'bottom' },
      { key: 'new', el: 'raids-new', side: 'bottom' },
      { key: 'phalanx', el: 'raids-phalanx', side: 'left' },
      { key: 'attacks', el: 'raids-attacks', side: 'top' },
      { key: 'own', el: 'raids-own', side: 'top' },
      { key: 'current', el: 'raids-current', side: 'top' },
      { key: 'targets', el: 'raids-targets', side: 'top' },
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
      { key: 'list', el: 'alliance-list', side: 'top' },
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
  expeditions: {
    steps: [
      { key: 'intro' },
      { key: 'stats', el: 'expo-tab-stats', side: 'bottom' },
      { key: 'yields', el: 'expo-yields', side: 'top' },
      { key: 'distribution', el: 'expo-distribution', side: 'top' },
      { key: 'recent', el: 'expo-recent', side: 'top' },
      { key: 'deck', el: 'expo-tab-deck', side: 'bottom' },
      { key: 'deckSummary', el: 'expo-deck-summary', side: 'bottom' },
      { key: 'deckCards', el: 'expo-deck-cards', side: 'top' },
      { key: 'deckAdd', el: 'expo-deck-add', side: 'top' },
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
} satisfies Record<string, Tour>;
export type TourId = keyof typeof TOURS;

type ToursState = { enabled: boolean; seen: string[] };

/** Tour state of the logged-in user (defaults while the session is not loaded). */
export const tours = computed<ToursState>(() => session.me?.user?.tours ?? { enabled: true, seen: [] });

let active: Driver | null = null;

/** The first visible element of a `data-tour` attribute (desktop and mobile variants may both exist). */
function findEl(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find((e) => e.offsetParent !== null || e.getClientRects().length > 0);
}

/** Stores a change and takes the server's state; throws on failure. */
async function post(body: { seen?: string; enabled?: boolean; reset?: true }) {
  const res = await api<ToursState>('/auth/tours', { body });
  if (session.me?.user) session.me.user.tours = res;
}
/** Marks a tour as seen, and with `never` switches the automatic start off (one request, so the state can't race). */
async function finishTour(id: TourId, never: boolean) {
  try {
    await post(never ? { seen: id, enabled: false } : { seen: id });
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
 * Starts the tour; steps whose element is not on the page are dropped, and without any element left nothing starts.
 * `auto: false` (the "?" button) runs it even when tours are switched off. Closing or finishing marks it as seen,
 * leaving the page does not.
 */
export function startTour(id: TourId, opts: { auto?: boolean } = {}) {
  if (opts.auto && !tours.value.enabled) return;
  stopTour();
  const steps: DriveStep[] = [];
  for (const s of TOURS[id].steps as TourStep[]) {
    const popover = { title: t(`tours.${id}.${s.key}.title`), description: t(`tours.${id}.${s.key}.text`), side: s.side };
    if (!s.el) {
      steps.push({ popover });
      continue;
    }
    const el = findEl(s.el);
    if (el) steps.push({ element: el, popover });
  }
  if (!steps.some((s) => s.element)) return;
  let ended = false;
  const finish = (never: boolean) => {
    if (!ended) void finishTour(id, never);
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
}

/**
 * In a view: starts the tour the first time `ready` is true if tours are on and this one is unseen; leaving the view
 * cancels a pending start and ends a running tour. `id` may change while the view stays (one view for several menu
 * pages): the running tour then ends and the new page's tour gets its own first start.
 */
export function useAutoTour(id: MaybeRefOrGetter<TourId>, ready: MaybeRefOrGetter<boolean>) {
  const done = new Set<TourId>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  const current = () => alive && toValue(id);
  watch(
    () => [toValue(id), toValue(ready) && !!session.me?.user] as const,
    async ([tid, ok], old) => {
      if (old && old[0] !== tid) {
        clearTimeout(timer);
        stopTour();
      }
      if (!ok || done.has(tid)) return;
      done.add(tid);
      if (!tours.value.enabled || tours.value.seen.includes(tid)) return;
      await nextTick();
      if (current() !== tid) return;
      // let lists and sections render before the elements are looked up
      timer = setTimeout(() => current() === tid && startTour(tid, { auto: true }), 300);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    alive = false;
    clearTimeout(timer);
    stopTour();
  });
}
