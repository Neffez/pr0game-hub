// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import DefenseAdvisor from '../src/components/DefenseAdvisor.vue';
import { i18n, loadLocale, setLocale } from '../src/i18n';

// The defense advisor drops the answer of a calculation that was overtaken by another planet (review B-4) and shows
// the time left of an attack on its way (B-8).
const A = '1:100:8:planet';
const B = '1:140:6:planet';
const now = Math.floor(Date.now() / 1000);
const hub = { planets: [A, B].map((key) => ({ key, type: 'planet', planet: { values: {} } })), research: {} };
const ctx = {
  universe: { id: 1, slug: 'u8', name: 'U8', deck: [], settings: { galaxies: 9, systems: 400, positions: 15, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '' } },
  group: { id: 1, name: 'A', role: 'member' }, members: [], me: { id: 1, username: 'carol', isAdmin: false }, own: null,
} as unknown as UniContext;
const answer = (key: string, attacker: string, advice: unknown = null) => ({
  planet: { key, name: key === A ? 'Home' : 'Colony', coords: { g: 1, s: 100, p: 8 }, type: 'planet', time: now, units: {}, research: {}, resources: { metal: 0, crystal: 0, deuterium: 0 }, defenseValue: 0 },
  rate: { m: 3, k: 2, source: 'default' }, candidates: [], simulated: [], advice,
  threats: [{
    key: 'p1', player: { id: 1, name: attacker, status: [], allyTag: null }, reasons: [{ kind: 'incoming', count: 1, last: now + 2 * 3600 + 30 }],
    fleet: { units: { 207: 10 }, points: 600, source: 'incoming', time: now - 60, from: null }, fleetPoints: null, research: { values: {}, known: true, time: now }, flight: null, heavy: null,
  }],
});
const advice = { error: null, status: 'safe', before: [], after: null, add: {}, cost: { metal: 0, crystal: 0, deuterium: 0 }, costValue: 0, battles: 4, runs: 4 };
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};

describe('defense advisor: outdated answers and attacks on their way', () => {
  let root: HTMLElement;
  const planetKey = ref(A);
  let finishSim: () => void = () => {};
  beforeAll(async () => {
    await loadLocale('de');
    setLocale('de');
    localStorage.clear();
    vi.stubGlobal('fetch', async (url: string) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/defense-risk')) return json({ planets: [], runs: 4, battles: 0, cached: false, error: null });
      const key = new URL(url, 'http://x').searchParams.get('planet')!;
      if (url.includes('sim=0')) return json(answer(key, key === A ? 'Xerxes' : 'Basher'));
      // the calculation answers when the test lets it
      await new Promise<void>((resolve) => (finishSim = resolve));
      return json(answer(key, 'Xerxes', advice));
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/build');
    root = document.createElement('div');
    document.body.append(root);
    const Shell = defineComponent({ setup: () => { provideUni(ref(ctx)); return () => h(DefenseAdvisor, { hub, planetKey: planetKey.value, mobile: false }); } });
    createApp(Shell).use(router).use(i18n).mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('shows the time left until an attack on its way lands', () => {
    const row = root.querySelector('tbody tr')!.textContent!;
    expect(row).toMatch(/im Anflug · trifft in 2:00:\d\d ein/);
    expect(row).not.toContain('gerade eben');
  });

  it('locks the options during a calculation and drops its answer after a planet change', async () => {
    (root.querySelector('button.primary') as HTMLButtonElement).click();
    await settle();
    expect(root.querySelector<HTMLSelectElement>('.def-head select')!.disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('tbody tr input[type=checkbox]')!.disabled).toBe(true);

    planetKey.value = B;
    await settle();
    expect(root.textContent).toContain('Basher');
    // the new planet is not calculating
    expect(root.querySelector<HTMLSelectElement>('.def-head select')!.disabled).toBe(false);

    finishSim();
    await settle();
    expect(root.textContent).toContain('Basher');
    expect(root.textContent).not.toContain('Xerxes');
    expect(root.querySelector('.def-result')).toBeNull();
  });
});
