// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { FarmTarget } from '../src/apiTypes';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, loadLocale, setLocale } from '../src/i18n';
import FarmView from '../src/views/FarmView.vue';

const now = Math.floor(Date.now() / 1000);
const ctx = {
  universe: { id: 1, slug: 'u8', name: 'U8', deck: [], settings: { galaxies: 9, systems: 400, positions: 15, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '' } },
  group: { id: 1, name: 'A', role: 'member' }, members: [], me: { id: 1, username: 'me', isAdmin: false },
  own: { research: {}, planets: [{ name: 'Ares', type: 'planet', coords: { g: 1, s: 100, p: 12 } }] },
} as unknown as UniContext;

const inactivity = (level: 'likely' | 'active', hours: number) => ({ score: level === 'likely' ? 70 : 0, level, since: level === 'likely' ? now - hours * 3600 : null, atLeast: false, status: null, stall: null, lastActive: null, reasons: [] });
function target(s: number, name: string, loot: number, strength: FarmTarget['strength'], inact: FarmTarget['inactivity'], fleetDebris: FarmTarget['fleetDebris'] = null): FarmTarget {
  return {
    g: 1, s, p: 8, type: 'planet', name: null,
    player: { id: s, name, status: [], ally_tag: null, points: 1000 },
    report: { time: now - 600, resources: { 901: loot, 902: 0, 903: 0 }, count: 1 },
    levels: null, projected: { 901: loot, 902: 0, 903: 0 }, perHour: { 901: 0, 902: 0, 903: 0 }, full: { 901: false, 902: false, 903: false },
    loot: { 901: loot / 2, 902: 0, 903: 0 },
    fleet: { time: now - 600, points: strength.fleet, units: strength.fleet ? 10 : 0 },
    defense: { time: now - 600, points: strength.defense, units: strength.defense ? 10 : 0 },
    lastBattle: null, inactivity: inact, changes: { 1: null, 2: null, 5: null }, espionage: null, strength, fleetDebris,
  };
}
const report = (fleet: number, defense: number): FarmTarget['strength'] => ({ fleet, fleetFrom: 'report', defense, defenseFrom: 'report', grown: false });

async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
}

describe('farm finder ranking (view)', () => {
  let root: HTMLElement;
  const names = () => [...root.querySelectorAll('[data-tour="farm-list"] tbody tr')].map((tr) => tr.querySelector('.farm-player')!.textContent!.trim());

  beforeAll(async () => {
    await loadLocale('de');
    setLocale('de');
    localStorage.clear();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      if (/\/farm\?days=/.test(url)) {
        return json({
          targets: [
            // a top player: much loot, far too strong, active
            target(101, 'Top', 5_000_000, report(50_000, 20_000), inactivity('active', 0)),
            // inactive and weak against the own 10,000 points
            target(102, 'Sleepy', 200_000, report(0, 1_000), inactivity('likely', 30)),
            // inactive with a big fleet standing around
            target(103, 'Parked', 300_000, report(40_000, 0), inactivity('likely', 30), { 901: 1_000_000, 902: 500_000 }),
          ],
          resourceSpeed: 1, speedSource: 'settings', storageFactor: 1, own: { points: 10_000, from: 'empire', time: now - 60 }, days: 7, now,
        });
      }
      return json([]);
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/farm?tab=targets');
    root = document.createElement('div');
    document.body.append(root);
    createApp(defineComponent({ setup: () => { provideUni(ref(ctx)); return () => h(FarmView); } })).use(router).use(i18n).mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('puts inactive weak targets first and the strong top player last', () => {
    expect(names()).toEqual(['Sleepy', 'Parked', 'Top']);
    const rows = [...root.querySelectorAll('[data-tour="farm-list"] tbody tr')];
    // 2 × 1,000 defense points of 10,000 own fleet points
    expect(rows[0].textContent).toContain('schwach · 20 %');
    expect(rows[1].textContent).toContain('stark');
    expect(rows[1].textContent).toContain('Flotte steht');
    expect(rows[2].textContent).not.toContain('Flotte steht');
  });

  it('sorts by the strength when the risk column is clicked', async () => {
    root.querySelector<HTMLElement>('[data-tour="farm-risk"]')!.click();
    await settle();
    expect(names()).toEqual(['Sleepy', 'Parked', 'Top']);
    root.querySelector<HTMLElement>('[data-tour="farm-risk"]')!.click();
    await settle();
    expect(names()).toEqual(['Top', 'Parked', 'Sleepy']);
  });
});
