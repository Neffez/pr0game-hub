// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, setLocale } from '../src/i18n';
import ImperiumView from '../src/views/ImperiumView.vue';

// Smoke test of the empire page: resources, queues and fleets tick without the page being rendered again.
const now = Math.floor(Date.now() / 1000);
const imperium = {
  empire: {
    time: now - 600,
    data: {
      planets: [
        {
          name: 'Ares', coords: { g: 1, s: 100, p: 12 }, type: 'planet', values: { 1: 20, 22: 5 },
          resources: { 901: 100_000, 902: 50_000, 903: 10_000, 911: 120 }, perHour: { 901: 36_000, 902: 18_000, 903: 3_600 },
        },
      ],
      research: {},
    },
  },
  overview: { time: now - 600, data: { queues: [{ kind: 'building', coords: { g: 1, s: 100, p: 12 }, type: 'planet', id: 1, level: 21, destroy: false, seconds: 4000 }] } },
  fleets: {
    time: now - 600,
    data: [
      {
        owner: 'own', player: null, mission: 1, missionName: 'Angreifen', phase: 'out', from: { coords: { g: 1, s: 100, p: 12 }, type: 'planet', name: 'Ares' },
        to: { coords: { g: 1, s: 101, p: 3 }, type: 'planet', name: 'Ziel' }, ships: { 202: 10 }, resources: null, arrival: now + 900,
      },
    ],
  },
  player: null,
  fleetBase: null,
  leader: null,
};
const ctx: UniContext = {
  universe: {
    id: 1, slug: 'u8', name: 'U8', deck: [],
    settings: {
      galaxies: 9, systems: 400, positions: 15, circularGalaxies: true, circularSystems: true, galaxyDistanceFactor: 20000,
      systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '',
    },
  },
  group: { id: 1, name: 'A', role: 'member' },
  members: [{ id: 1, username: 'carol', name: 'Carol', role: 'member', ingame_name: null, last_seen_at: null }],
  me: { id: 1, username: 'carol', isAdmin: false },
  own: null,
};

let root: HTMLElement;
/** renders of the page component itself (not of its ticking parts) */
let pageUpdates = 0;
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};

describe('empire page', () => {
  beforeAll(async () => {
    setLocale('de');
    vi.stubGlobal('fetch', async (url: string) => {
      const body = url.includes('/imperium') ? imperium : [];
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/imperium');
    const Shell = defineComponent({
      setup() {
        provideUni(ref(ctx));
        return () => h(ImperiumView);
      },
    });
    root = document.createElement('div');
    document.body.append(root);
    const app = createApp(Shell).use(router).use(i18n);
    app.mixin({
      updated(this: { $: { type: { __name?: string } } }) {
        if (this.$.type.__name === 'ImperiumView') pageUpdates++;
      },
    });
    app.mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('ticks resources, queues and fleets every second without rendering the page again', async () => {
    const texts = () => ({
      metal: root.querySelector('.table-wrap td.num')!.getAttribute('title'),
      building: root.querySelector('.table-wrap td.small .mono')!.textContent,
      fleet: root.querySelector('.fl-table td.mono.muted')!.textContent,
    });
    const before = texts();
    expect(before.metal).toMatch(/^106\.\d{3} \//);
    expect(before.building).toMatch(/^00:5\d:\d\d$/);
    // under load the initial loads may still render: count from the moment the page is quiet
    for (let n = -1; n !== pageUpdates; ) {
      n = pageUpdates;
      await new Promise((r) => setTimeout(r, 100));
      await settle();
    }
    pageUpdates = 0;
    await new Promise((r) => setTimeout(r, 2200));
    const after = texts();
    expect(after.metal).not.toBe(before.metal);
    expect(after.building).not.toBe(before.building);
    expect(after.fleet).not.toBe(before.fleet);
    expect(pageUpdates).toBe(0);
  });
});
