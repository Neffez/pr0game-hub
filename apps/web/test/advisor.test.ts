// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import UpgradeAdvisor from '../src/components/UpgradeAdvisor.vue';
import { i18n, setLocale } from '../src/i18n';

// The upgrade advisor ranks steps and puts one into the build order (a new one when there is none).
const planet = (key: string, values: Record<string, number>) => ({
  key, name: key.split(':')[1], coords: { g: 1, s: Number(key.split(':')[1]), p: 8 }, type: 'planet', temp: 40, factors: null,
  planet: { type: 'planet', values, resources: {}, perHour: {}, time: 0, queue: [{ id: 2, level: values[2] + 1, destroy: false }] },
});
const hub = {
  planets: [planet('1:100:8:planet', { 1: 20, 2: 18, 3: 15, 4: 30, 21: 2, 31: 4 }), planet('1:120:8:planet', { 1: 18, 2: 16, 3: 12, 4: 28, 31: 1 })],
  research: { 113: 8 }, researchQueue: [], resourceSpeed: 2500, catchUp: 0,
};
const ctx = {
  universe: { id: 1, slug: 'u8', name: 'U8', deck: [], settings: { galaxies: 9, systems: 400, positions: 15, circularGalaxies: true, circularSystems: true, galaxyDistanceFactor: 20000, systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '' } },
  group: { id: 1, name: 'A', role: 'member' }, members: [], me: { id: 1, username: 'carol', isAdmin: false }, own: null,
} as unknown as UniContext;
const calls: { url: string; method: string; body: any }[] = [];
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};

describe('upgrade advisor', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    setLocale('de');
    localStorage.clear();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(url.endsWith('/build-order') && (init?.method ?? 'GET') === 'GET' ? { buildOrder: null } : { buildOrder: {} }), { headers: { 'content-type': 'application/json' } });
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/build');
    root = document.createElement('div');
    document.body.append(root);
    const Shell = defineComponent({ setup: () => { provideUni(ref(ctx)); return () => h(UpgradeAdvisor, { hub, planetKey: '1:100:8:planet', mobile: false }); } });
    createApp(Shell).use(router).use(i18n).mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('lists steps by payback and starts a build order with the chosen one', async () => {
    const rows = [...root.querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(3);
    // the crystal mine starts after the queued level
    expect(rows.some((r) => r.textContent!.includes('Kristallmine 20'))).toBe(true);
    (rows[0].querySelector('button') as HTMLButtonElement).click();
    await settle();
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body.meta).toEqual({ source: 'advisor' });
    expect(put.body.order.base.planets['1:100:8:planet'][2]).toBe(19);
    const steps = Object.values(put.body.order.planets as Record<string, { id: string; kind: string }[]>).flat();
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => /^adv-/.test(s.id))).toBe(true);
    expect(rows[0].textContent).toContain('in der Bauliste');
  });
});
