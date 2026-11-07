// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, setLocale } from '../src/i18n';
import HealthView from '../src/views/HealthView.vue';

const now = Math.floor(Date.now() / 1000);
const health = {
  medianGrowth: 400,
  window: 604800,
  members: [
    { userId: 1, name: 'Busy', role: 'admin', lastSeen: now - 60, player: { id: 1, name: 'Busy' }, points: 5000, rank: 1, growth: 600, partial: false, syncs: { empire: now - 3600 }, battles: 2, loot: 900, expeditions: 1, openDeliveries: 0, flags: [] },
    { userId: 2, name: 'Slow', role: 'member', lastSeen: now - 5 * 86400, player: { id: 2, name: 'Slow' }, points: 2000, rank: 2, growth: 50, partial: false, syncs: {}, battles: 0, loot: 0, expeditions: 0, openDeliveries: 1, flags: ['behind', 'noEmpire', 'away'] },
  ],
};
const ctx = {
  universe: { id: 1, slug: 'u8', name: 'U8', deck: [], settings: { galaxies: 9, systems: 400, positions: 15, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '' } },
  group: { id: 1, name: 'A', role: 'admin' }, members: [], me: { id: 1, username: 'busy', isAdmin: false }, own: null,
} as unknown as UniContext;

describe('alliance health page', () => {
  let root: HTMLElement;
  beforeAll(async () => {
    setLocale('de');
    localStorage.clear();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(health), { headers: { 'content-type': 'application/json' } }));
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/health');
    root = document.createElement('div');
    document.body.append(root);
    createApp(defineComponent({ setup: () => { provideUni(ref(ctx)); return () => h(HealthView); } })).use(router).use(i18n).mount(root);
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await nextTick();
    }
  });
  afterAll(() => vi.unstubAllGlobals());

  it('lists flagged members first with their flags', () => {
    const rows = [...root.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.querySelector('td a, td span')!.textContent)).toEqual(['Slow', 'Busy']);
    expect([...rows[0].querySelectorAll('.badge')].map((b) => b.textContent)).toEqual(['fällt zurück', 'kein Imperium', 'nicht im Hub']);
    expect(root.textContent).toContain('1 auffällig');
  });
});
