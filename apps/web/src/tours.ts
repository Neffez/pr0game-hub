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

/** Registry; the texts are `tours.<id>.<key>.title` and `.text` in the locales. */
export const TOURS = {
  overview: { steps: [{ key: 'intro' }, { key: 'mode', el: 'overview-mode', side: 'bottom' }, { key: 'search', el: 'overview-search', side: 'bottom' }, { key: 'filter', el: 'overview-filter', side: 'bottom' }, { key: 'outro' }] },
  paste: { steps: [{ key: 'intro' }, { key: 'sync', el: 'paste-sync', side: 'bottom' }, { key: 'json', el: 'paste-json', side: 'top' }, { key: 'outro' }] },
  build: { steps: [{ key: 'intro' }, { key: 'tabs', el: 'build-tabs', side: 'bottom' }, { key: 'planet', el: 'build-planet', side: 'bottom' }, { key: 'outro' }] },
  raids: { steps: [{ key: 'intro' }, { key: 'tabs', el: 'raids-tabs', side: 'bottom' }, { key: 'new', el: 'raids-new', side: 'bottom' }, { key: 'outro' }] },
} satisfies Record<string, Tour>;
export type TourId = keyof typeof TOURS;

/** Tour state of the logged-in user (defaults while the session is not loaded). */
export const tours = computed(() => session.me?.user?.tours ?? { enabled: true, seen: [] as string[] });

let active: Driver | null = null;

/** The first visible element of a `data-tour` attribute (desktop and mobile variants may both exist). */
function findEl(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find((e) => e.offsetParent !== null || e.getClientRects().length > 0);
}

async function post(body: object) {
  try {
    const res = await api<{ enabled: boolean; seen: string[] }>('/auth/tours', { body });
    if (session.me?.user) session.me.user.tours = res;
  } catch (e) {
    console.warn('tours: could not be saved', e);
  }
}
export const markSeen = (id: TourId) => post({ seen: id });
export const setToursEnabled = (enabled: boolean) => post({ enabled });
export const resetTours = () => post({ reset: true });

/** Destroys the running tour, if any (page change). */
export function stopTour() {
  const d = active;
  active = null;
  d?.destroy();
}

/**
 * Starts the tour; steps whose element is not on the page are dropped. `auto: false` (the "?" button) runs it even
 * when tours are switched off. Closing or finishing marks the tour as seen.
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
  if (!steps.some((s) => s.element) && steps.length < 2) return;
  let ended = false;
  const finish = (never: boolean) => {
    if (ended) return;
    ended = true;
    void markSeen(id);
    if (never) void setToursEnabled(false);
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
      never.addEventListener('click', () => {
        finish(true);
        drv.destroy();
      });
      popover.footerButtons.prepend(never);
    },
    onDestroyed: () => {
      finish(false);
      if (active === drv) active = null;
    },
  });
  active = drv;
  drv.drive();
}

/**
 * In a view: starts the tour the first time `ready` is true if tours are on and this one is unseen; a running tour
 * ends with the view.
 */
export function useAutoTour(id: TourId, ready: MaybeRefOrGetter<boolean>) {
  let done = false;
  watch(
    () => toValue(ready) && !!session.me?.user,
    async (ok) => {
      if (!ok || done) return;
      done = true;
      if (!tours.value.enabled || tours.value.seen.includes(id)) return;
      await nextTick();
      setTimeout(() => startTour(id, { auto: true }), 300);
    },
    { immediate: true },
  );
  onBeforeUnmount(stopTour);
}
