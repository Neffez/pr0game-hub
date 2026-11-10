// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, loadLocale, setLocale } from '../src/i18n';
import FarmView from '../src/views/FarmView.vue';

const now = Math.floor(Date.now() / 1000);
const ctx = {
  universe: { id: 1, slug: 'u8', name: 'U8', deck: [], settings: { galaxies: 9, systems: 400, positions: 15, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '' } },
  group: { id: 1, name: 'A', role: 'member' }, members: [], me: { id: 1, username: 'me', isAdmin: false },
  own: { research: {}, planets: [{ name: 'Ares', type: 'planet', coords: { g: 1, s: 100, p: 12 } }] },
} as unknown as UniContext;

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
}

describe('farm finder tabs (B-2 of the review)', () => {
  let root: HTMLElement;
  const farmCalls: number[] = [];
  const tabButton = (id: string) => root.querySelector<HTMLButtonElement>(`[data-tour="farm-tab-${id}"]`)!;

  beforeAll(async () => {
    await loadLocale('de');
    setLocale('de');
    localStorage.clear();
    localStorage.setItem('hub.farm.filter', JSON.stringify({ from: '4:20:7', galaxy: 12 }));
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      const farm = /\/farm\?days=(\d+)/.exec(url);
      if (farm) {
        farmCalls.push(Number(farm[1]));
        return json({ targets: [], resourceSpeed: 1, speedSource: 'settings', storageFactor: 1, days: Number(farm[1]), now });
      }
      if (url.includes('/debris')) return json({ fields: [], recyclers: [], capacity: null, days: 7, now });
      return json([]);
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/farm?tab=spy');
    root = document.createElement('div');
    document.body.append(root);
    createApp(defineComponent({ setup: () => { provideUni(ref(ctx)); return () => h(FarmView); } })).use(router).use(i18n).mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('loads the chosen period again when the targets follow the spy and debris tabs', async () => {
    expect(farmCalls).toEqual([30]);
    tabButton('debris').click();
    await settle();
    expect(farmCalls).toEqual([30]);
    tabButton('targets').click();
    await settle();
    expect(farmCalls).toEqual([30, 7]);
    // the empty text names the period of the data shown
    expect(root.textContent).toContain('in den letzten 7 Tagen');
  });

  it('ignores a stored start planet that is not an own planet here (another universe)', async () => {
    // set before the page was mounted: see beforeAll
    const stored = JSON.parse(localStorage.getItem('hub.farm.filter')!);
    expect(stored.from).toBe('');
    // a galaxy the universe does not have (9 galaxies)
    expect(stored.galaxy).toBeNull();
    const select = [...root.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.textContent!.includes('Ares')))!;
    expect(select.value).toBe('');
  });

  it('does not load again when the data already fits', async () => {
    tabButton('debris').click();
    await settle();
    tabButton('targets').click();
    await settle();
    expect(farmCalls).toEqual([30, 7]);
  });
});
