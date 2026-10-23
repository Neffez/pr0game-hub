// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import FleetList, { type Fleet } from '../src/components/FleetList.vue';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, setLocale } from '../src/i18n';

const body = (g: number, s: number, p: number, type: 'planet' | 'moon', name: string) => ({ coords: { g, s, p }, type, name });
const fleet = (mission: number, ships: Record<string, number>, extra: Partial<Fleet> = {}): Fleet => ({
  owner: 'hostile', player: null, mission, missionName: mission === 1 ? 'Angreifen' : 'Verbandsangriff', phase: 'out',
  from: body(3, 192, 15, 'moon', 'SuperMarioLand'), to: body(1, 100, 12, 'planet', 'Ares'), ships, resources: null, arrival: 2_000_000_000,
  acs: 0, fromPlayer: { id: 50, name: 'Hustensaftdealer' }, ...extra,
});

describe('fleet list', () => {
  it('shows an ACS as one row with all ships in full numbers, the owner from the galaxy data, opening to the fleets', async () => {
    setLocale('de');
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] });
    const root = document.createElement('div');
    const fleets = [fleet(1, { 210: 1 }), fleet(2, { 204: 16283, 207: 1773 }), fleet(1, { 206: 2500 }, { acs: null, arrival: 2_000_000_100 })];
    const ctx = { universe: { slug: 'u7' }, members: [], me: { id: 1 }, group: { role: 'member' }, own: null } as unknown as UniContext;
    const Shell = defineComponent({
      setup() {
        provideUni(ref(ctx));
        return () => h(FleetList, { fleets });
      },
    });
    createApp(Shell).use(router).use(i18n).mount(root);
    await nextTick();
    const rows = root.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Verbandsangriff (2 Flotten)');
    expect(rows[0].textContent).toContain('16.283 LJ');
    expect(rows[0].textContent).toContain('1 Spy');
    expect(rows[0].textContent).toContain('Hustensaftdealer');
    root.querySelector<HTMLButtonElement>('.fl-toggle')!.click();
    await nextTick();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(4);
  });
});
