// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { FarmSimulation, FarmTarget } from '../src/apiTypes';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, loadLocale, setLocale } from '../src/i18n';
import FarmView from '../src/views/FarmView.vue';

const now = Math.floor(Date.now() / 1000);
const ctx = {
  universe: { id: 1, slug: 'u8', name: 'U8', deck: [], settings: { galaxies: 9, systems: 400, positions: 15, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '' } },
  group: { id: 1, name: 'A', role: 'member' }, members: [], me: { id: 1, username: 'me', isAdmin: false },
  own: { research: {}, planets: [{ name: 'Ares', type: 'planet', coords: { g: 1, s: 100, p: 12 } }] },
} as unknown as UniContext;

const active = { score: 0, level: 'active' as const, since: null, atLeast: false, status: null, stall: null, lastActive: null, reasons: [] };
/** A target with `fleet` combat points seen `age` seconds ago and a debris field of `debris` metal. */
function target(s: number, name: string, fleet: number, debris: number, age = 600): FarmTarget {
  return {
    g: 1, s, p: 8, type: 'planet', name: null,
    player: { id: s, name, status: [], ally_tag: null, points: 1000 },
    report: { time: now - 600, resources: { 901: 0, 902: 0, 903: 0 }, count: 1 },
    levels: null, projected: { 901: 0, 902: 0, 903: 0 }, perHour: { 901: 0, 902: 0, 903: 0 }, full: { 901: false, 902: false, 903: false },
    loot: { 901: 0, 902: 0, 903: 0 },
    fleet: { time: now - age, points: fleet, units: fleet ? 10 : 0 },
    defense: { time: now - 600, points: null, units: 0 },
    lastBattle: null, inactivity: active, changes: { 1: null, 2: null, 5: null }, espionage: null,
    strength: { fleet, fleetFrom: 'report', defense: 0, defenseFrom: 'report', grown: false },
    fleetDebris: debris ? { 901: debris, 902: 0 } : null,
  };
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
}

describe('fleet finder tab', () => {
  let root: HTMLElement;
  const simulated: unknown[] = [];
  const names = () => [...root.querySelectorAll('[data-tour="farm-fleets-list"] tbody tr')].map((tr) => tr.querySelector('.farm-player')!.textContent!.trim());

  beforeAll(async () => {
    await loadLocale('de');
    setLocale('de');
    localStorage.clear();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      if (/\/farm\?days=/.test(url)) {
        return json({
          targets: [
            // no fleet: not listed
            target(101, 'Empty', 0, 0),
            // 10 % of the own fleet, small field
            target(102, 'Small', 1_000, 300_000),
            // 30 % of the own fleet: the sweet spot
            target(103, 'Sweet', 3_000, 900_000),
            // 80 % of the own fleet: big field, too strong
            target(104, 'Huge', 8_000, 2_400_000),
            // like Sweet but the report is two days old: the fleet is probably gone
            target(105, 'Gone', 3_000, 900_000, 2 * 86400),
          ],
          resourceSpeed: 1, speedSource: 'settings', storageFactor: 1, own: { points: 10_000, from: 'empire', time: now - 60, ships: { 204: 100, 207: 10 } },
          rate: { m: 3, k: 2, source: 'default' }, days: 7, now,
        });
      }
      if (url.includes('/farm/simulate')) {
        const body = JSON.parse(String(init?.body)) as { combatOnly: boolean; targets: { g: number; s: number; p: number; type: 'planet' | 'moon' }[] };
        simulated.push({ combatOnly: body.combatOnly, targets: body.targets.map((x) => x.s) });
        const zero = { metal: 0, crystal: 0, deuterium: 0 };
        const res: FarmSimulation = {
          fleet: { units: { 207: 10 }, research: {}, time: now - 60, cost: 1_000_000 },
          runs: 6,
          results: body.targets.map((x) => ({
            ...x,
            reason: null,
            // the simulation finds the small fleet the best deal, the sweet one costs too much
            outcome: { wins: 1, profit: x.s === 102 ? 500_000 : x.s === 103 ? -10_000 : 1_000, loot: zero, debris: { metal: 0, crystal: 0 }, lost: zero, lostShare: 0, defenderLost: zero },
          })),
        };
        return json(res);
      }
      return json([]);
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/farm?tab=fleets');
    root = document.createElement('div');
    document.body.append(root);
    createApp(defineComponent({ setup: () => { provideUni(ref(ctx)); return () => h(FarmView); } })).use(router).use(i18n).mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('lists only spied fleets, the one near 30 % of the own fleet first, an old report last', () => {
    expect(names()).toEqual(['Sweet', 'Small', 'Huge', 'Gone']);
  });

  it('flies the own combat fleet at the speed of its slowest ship', () => {
    const cell = root.querySelectorAll('[data-tour="farm-fleets-list"] tbody tr')[0].querySelectorAll('td')[6] as HTMLElement;
    expect(cell.title).toContain('langsamstes: Schlachtschiff');
    // no cargo to choose in the fleet finder
    expect(root.querySelector('[data-tour="farm-flight"]')!.textContent).toContain('Kampfflotte');
  });

  it('simulates the list on demand and ranks by the simulated profit', async () => {
    const button = root.querySelector<HTMLButtonElement>('[data-tour="farm-sim"] button')!;
    button.click();
    await settle();
    expect(simulated).toEqual([{ combatOnly: true, targets: [103, 102, 104, 105] }]);
    expect(names()).toEqual(['Small', 'Huge', 'Gone', 'Sweet']);
  });
});
