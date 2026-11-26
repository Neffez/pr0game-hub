// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Schema } from '../src/apiTypes';
import PlayerFleet from '../src/components/PlayerFleet.vue';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, loadLocale, setLocale } from '../src/i18n';

const now = Math.floor(Date.now() / 1000);
const ctx = {
  universe: { id: 1, slug: 'u8', name: 'U8', deck: [], settings: { galaxies: 9, systems: 400, positions: 15, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '' } },
  group: { id: 1, name: 'A', role: 'member' }, members: [], me: { id: 1, username: 'me', isAdmin: false },
  own: { research: {}, planets: [] },
} as unknown as UniContext;

const spy: Schema<'FleetSighting'> = {
  source: 'spy', time: now - 2 * 86400, units: { 205: 100, 206: 10 }, points: 1290, body: { g: 1, s: 2, p: 3, type: 'planet' }, count: null, reportId: null,
  lost: { 205: 80 }, lostPoints: 800, lostBattles: 1,
};

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
}

describe('player fleet', () => {
  let root: HTMLElement;

  beforeAll(async () => {
    await loadLocale('de');
    setLocale('de');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const body: unknown = String(input).includes('/players/7/fleet')
        ? ({ fleet: spy, sum: null, sightings: [spy], fleetPoints: { points: 100, time: now - 3600 }, shrunk: true } satisfies Schema<'PlayerFleet'>)
        : [];
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/players');
    root = document.createElement('div');
    document.body.append(root);
    createApp(defineComponent({ setup: () => { provideUni(ref(ctx)); return () => h(PlayerFleet, { player: 7 }); } })).use(router).use(i18n).mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('shows the ships left after the battles since, the destroyed ones struck', () => {
    const lines = [...root.querySelectorAll('.fleet-line')].map((l) => [...l.querySelectorAll('span, s, b')].filter((e) => !e.children.length).map((e) => e.textContent!.trim()).join(' '));
    expect(lines).toEqual(['Schwerer Jäger −80 20', 'Kreuzer 10']);
    expect(root.querySelector('[data-test="fleet-lost"]')!.textContent).toContain('1 Kampf zerstört');
    expect(root.textContent).toContain('490 Punkte');
  });

  it('warns when the statistics show fewer fleet points since', () => {
    expect(root.querySelector('[data-test="fleet-shrunk"]')!.textContent).toContain('100 Flottenpunkte');
  });
});
