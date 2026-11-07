// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type Component } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, setLocale } from '../src/i18n';
import AttackView from '../src/views/AttackView.vue';
import FleetSaveView from '../src/views/FleetSaveView.vue';

// Smoke tests of the fleet save planner (A-2) and the incoming attack assistant (A-1) with server answers as data.
const now = Math.floor(Date.now() / 1000);
const research = { 115: 10, 117: 8, 118: 6 };
const empire = {
  time: now - 600,
  data: {
    research,
    planets: [
      { name: 'Ares', coords: { g: 1, s: 100, p: 12 }, type: 'planet', values: { 202: 50, 203: 20, 401: 10 }, resources: { 903: 50_000 }, perHour: { 903: 0 } },
      { name: 'Ares', coords: { g: 1, s: 100, p: 12 }, type: 'moon', values: {} },
      { name: 'Zeus', coords: { g: 1, s: 180, p: 4 }, type: 'planet', values: {} },
    ],
  },
};
const imperium = {
  empire,
  phalanx: [{ planet: { g: 1, s: 100, p: 12, name: 'Ares' }, threats: [{ moon: { g: 1, s: 104, p: 3 }, level: 3, player: { name: 'Enemy', ally: 'FEI' } }] }],
};
const arrival = now + 2 * 3600;
const assist = {
  attack: {
    key: 'k', arrival, from: { g: 1, s: 104, p: 3, type: 'planet' }, to: { g: 1, s: 100, p: 12, type: 'planet' }, source: 'overview',
    fleets: [{ mission: 1, ships: { 207: 100 } }], player: { id: 7, name: 'Enemy' }, member: 'Carol',
  },
  member: { id: 1, name: 'Carol' },
  target: { g: 1, s: 100, p: 12, type: 'planet', name: 'Ares', values: empire.data.planets[0].values, resources: { metal: 100_000, crystal: 50_000, deuterium: 50_000 }, empireTime: now - 600, deuterium: 50_000, perHour: null },
  bodies: empire.data.planets.map((p) => ({ ...p.coords, type: p.type, name: p.name })),
  research,
  attacker: { player: { id: 7, name: 'Enemy' }, research: { values: { 109: 10, 110: 10, 111: 10 }, time: now - 3600 }, ships: { 207: 100 } },
  loot: { metal: 50_000, crystal: 25_000, deuterium: 10_000 },
  helpers: [{ userId: 2, member: 'Dave', from: { g: 1, s: 102, p: 3, type: 'planet', name: 'Near' }, ships: { 204: 300 }, points: 1200, duration: 1800, launch: arrival - 1801 }],
  holdPlan: null,
  holds: [{ member: 'Erin', player: null, from: { g: 1, s: 101, p: 1, type: 'planet' }, ships: { 206: 40 }, research: {}, arrival: arrival - 300 }],
  phalanx: [],
  simulated: true,
  sim: {
    error: null, runs: 20, wins: { attacker: 1, defender: 0, draw: 0 }, rounds: 2, loot: { metal: 50_000, crystal: 25_000, deuterium: 10_000 },
    debris: { metal: { avg: 1000, min: 0, max: 0 }, crystal: { avg: 500, min: 0, max: 0 } },
    lostResources: { attacker: { metal: 0, crystal: 0, deuterium: 0 }, defender: { metal: 200_000, crystal: 50_000, deuterium: 0 } },
  },
  now,
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
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
async function mount(view: Component, path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
  await router.push(path);
  const root = document.createElement('div');
  document.body.append(root);
  const Shell = defineComponent({
    setup() {
      provideUni(ref(ctx));
      return () => h(view);
    },
  });
  createApp(Shell).use(router).use(i18n).mount(root);
  await settle();
  return root;
}

describe('fleet save and attack assistant', () => {
  beforeAll(() => {
    setLocale('de');
    localStorage.clear();
    vi.stubGlobal('fetch', async (url: string) => {
      const body = url.includes('/attack-assist') ? assist : url.includes('/imperium') ? imperium : [];
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('suggests fleet saves per body with ships and warns about a phalanx', async () => {
    const root = await mount(FleetSaveView, '/u8/fleetsave');
    const bodies = root.querySelectorAll('.fs-body');
    // only the planet has ships
    expect(bodies).toHaveLength(1);
    expect(bodies[0].querySelector('.fs-phalanx')!.textContent).toBe(' Phalanx: Enemy 1:104:3');
    expect(bodies[0].querySelectorAll('.fso-table tbody tr').length).toBeGreaterThan(0);
    expect(bodies[0].querySelector('.fso-table tbody td b')!.textContent).toMatch(/Stationieren|Transport/);
  });

  it('shows the verdict, the loot, fleet saves before the impact and the helpers', async () => {
    const root = await mount(AttackView, `/u8/attack?member=1&arrival=${arrival}&from=1:104:3`);
    const text = root.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Angriff auf Carol');
    expect(text).toContain('Voraussichtliches Kampfergebnis');
    expect(root.querySelector('[data-tour="attack-sim"] .at-stats b.neg')!.textContent).toBe('Angreifer gewinnt');
    expect(text).toContain('Angreifer 100 %');
    expect(text).toContain('Mit Halteflotten: Erin (40)');
    expect(text).toContain('Beute, falls der Angreifer gewinnt: 85');
    expect(root.querySelectorAll('.fso-table tbody tr').length).toBeGreaterThan(0);
    const helper = [...root.querySelectorAll('table.data tbody tr')].find((r) => r.textContent!.includes('Dave'))!;
    expect(helper.textContent).toContain('Near');
    expect(helper.querySelector('button')!.textContent).toContain('Einladen');
  });
});
