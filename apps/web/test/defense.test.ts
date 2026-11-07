// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import DefenseAdvisor from '../src/components/DefenseAdvisor.vue';
import { i18n, setLocale } from '../src/i18n';

// The defense advisor lists the attackers, calculates the chosen ones and puts the defense into the build order.
const KEY = '1:100:8:planet';
const hub = { planets: [{ key: KEY, type: 'planet', planet: { values: { 21: 8, 401: 20 } } }], research: { 113: 8 } };
const ctx = {
  universe: { id: 1, slug: 'u8', name: 'U8', deck: [], settings: { galaxies: 9, systems: 400, positions: 15, circularGalaxies: true, circularSystems: true, galaxyDistanceFactor: 20000, systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '' } },
  group: { id: 1, name: 'A', role: 'member' }, members: [], me: { id: 1, username: 'carol', isAdmin: false }, own: null,
} as unknown as UniContext;
const threat = (key: string, name: string, kind: string) => ({
  key, player: { id: Number(key.slice(1)), name, status: [], allyTag: null }, reasons: [{ kind, count: 2, last: 1000 }],
  fleet: { units: { 203: 300, 205: 100 }, points: 2500, source: 'spy', time: 1000, from: { g: 1, s: 150, p: 4 } },
  fleetPoints: { points: 9000, time: 1000 }, research: { values: { 109: 8 }, known: true, time: 1000 }, flight: { from: { g: 1, s: 150, p: 4 }, distance: 7000, duration: 3600, fuel: 1200 },
  heavy: key === 'p2' ? { units: { 207: 40 }, points: 2400, flight: { from: { g: 1, s: 150, p: 4 }, distance: 7000, duration: 3000, fuel: 600 } } : null,
});
const outcome = (key: string, profit: number) => ({ key, profit, loot: { metal: 1, crystal: 1, deuterium: 1 }, debris: { metal: 0, crystal: 0 }, lost: { metal: 0, crystal: 0, deuterium: 0 }, defenderLost: { metal: 0, crystal: 0, deuterium: 0 }, fuel: 1200, wins: 1 });
const base = {
  planet: { key: KEY, name: 'Home', coords: { g: 1, s: 100, p: 8 }, type: 'planet', time: 1000, units: { 401: 20 }, research: { 109: 6, 110: 6, 111: 6 }, resources: { metal: 2e6, crystal: 1e6, deuterium: 5e5 }, defenseValue: 13333 },
  rate: { m: 3, k: 2, source: 'default' }, candidates: [401, 402], threats: [threat('p1', 'Raider', 'spied'), threat('p2', 'Basher', 'attacked')], simulated: [], advice: null,
};
const advice = { error: null, status: 'found', before: [outcome('p2', 800_000), outcome('p2:heavy', 300_000)], after: [outcome('p2', -20_000), outcome('p2:heavy', -90_000)], add: { 402: 139, 403: 35 }, cost: { metal: 418_500, crystal: 139_500, deuterium: 0 }, costValue: 209_250, battles: 120, runs: 8 };
const calls: { url: string; method: string; body: any }[] = [];
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};

describe('defense advisor', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    setLocale('de');
    localStorage.clear();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = url.includes('/defense-risk')
        ? { planets: [
            { key: KEY, name: 'Home', coords: { g: 1, s: 100, p: 8 }, type: 'planet', threats: 2, skipped: 0, worst: { key: 'p2', player: { id: 2, name: 'Basher' }, heavy: true, profit: 812_000, wins: 1 } },
            { key: '1:140:6:planet', name: 'Colony', coords: { g: 1, s: 140, p: 6 }, type: 'planet', threats: 0, skipped: 0, worst: null },
          ], runs: 4, battles: 16, cached: false, error: null }
        : url.includes('/defense-advice')
        ? { ...base, ...(url.includes('sim=0') ? {} : { simulated: ['p2'], advice }) }
        : url.endsWith('/build-order') && method === 'GET' ? { buildOrder: null } : { buildOrder: {} };
      return new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } });
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/build');
    root = document.createElement('div');
    document.body.append(root);
    const Shell = defineComponent({ setup: () => { provideUni(ref(ctx)); return () => h(DefenseAdvisor, { hub, planetKey: KEY, mobile: false }); } });
    createApp(Shell).use(router).use(i18n).mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('shows the raid risk of every body, the riskiest first', () => {
    const rows = [...root.querySelectorAll('.risk-row')];
    expect(rows.map((r) => r.querySelector('b')!.textContent)).toEqual(['Home', 'Colony']);
    expect(rows[0].textContent).toContain('Basher');
    expect(rows[0].textContent).toContain('(schwer)');
    expect(rows[0].getAttribute('href')).toContain('tab=defense');
    expect(rows[1].textContent).toContain('keine bekannten Angreifer');
  });

  it('lists the attackers without simulating', () => {
    const list = calls.find((c) => c.url.includes('/defense-advice'))!;
    expect(list.url).toContain(`planet=${encodeURIComponent(KEY)}`);
    expect(list.url).toContain('sim=0');
    const rows = [...root.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.textContent!.includes('Raider') || r.textContent!.includes('Basher'))).toEqual([true, true]);
    expect(rows[0].textContent).toContain('2× spioniert');
    // more fleet points in the statistics than the fleet known
    expect(rows[0].textContent).toContain('Flottenpunkte jetzt');
  });

  it('calculates only the chosen attackers and shows the defense', async () => {
    (root.querySelector('tbody tr input[type=checkbox]') as HTMLInputElement).click();
    await settle();
    (root.querySelector('button.primary') as HTMLButtonElement).click();
    await settle();
    const sim = calls.find((c) => c.url.includes('/defense-advice') && !c.url.includes('sim=0'))!;
    expect(new URL(sim.url, 'http://x').searchParams.get('threats')).toBe('p2');
    expect(root.textContent).toContain('macht jeder gewählte Angriff Verlust');
    expect(root.textContent).toContain('139×');
    // full fleet and heavy ships only, before → after
    const basher = [...root.querySelectorAll('tbody tr')].find((r) => r.textContent!.includes('Basher'))!;
    expect(basher.textContent).toContain('nur schwere Schiffe');
    expect(basher.querySelectorAll('.def-profit')).toHaveLength(2);
    expect(root.querySelector('.def-result a')?.getAttribute('href')).toContain('battle-simulator');
  });

  it('puts the defense into a new build order as shipyard steps', async () => {
    const button = [...root.querySelectorAll('.def-result button')].find((b) => b.textContent!.includes('In Bauliste')) as HTMLButtonElement;
    button.click();
    await settle();
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body.meta).toEqual({ source: 'defense' });
    expect(put.body.order.planets[KEY].map((s: any) => [s.kind, s.element, s.count])).toEqual([['ship', 402, 139], ['ship', 403, 35]]);
    expect(put.body.order.base.planets[KEY]).toEqual({ 21: 8, 401: 20 });
    expect(root.textContent).toContain('in der Bauliste');
  });
});
