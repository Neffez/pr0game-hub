// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, setLocale } from '../src/i18n';
import RaidPlannerView from '../src/views/RaidPlannerView.vue';

// Smoke test of the raid planner page: real components, texts and router; the API answers from fixtures.
const target = 2_000_000_000;
const plans = [
  {
    id: 7, user_id: 1, creator: 'Carol', g: 1, s: 41, p: 1, planet_type: 'moon', target_time: target, time_precision: 'exact', note: 'Konter', status: 'planning',
    created_at: 0, updated_at: 0, claim_user_id: 1, player_id: 5, player_name: 'Gegner', planet_name: 'Mond',
    fleets: [
      { id: 1, user_id: 1, member: 'Carol', g: 1, s: 40, p: 5, planet_type: 'planet', ships: { 207: 1773, 215: 2 }, speed: 90, status: 'ready', updated_at: 0,
        drives: { time: Math.floor(Date.now() / 1000), research: { 115: 10, 117: 8, 118: 6, 134: 0 } } },
      { id: 2, user_id: 2, member: 'Dave', g: 1, s: 42, p: 7, planet_type: 'planet', ships: { 204: 100 }, speed: 100, status: 'ready', updated_at: 0, drives: null },
      { id: 3, user_id: 3, member: 'Erin', g: null, s: null, p: null, planet_type: null, ships: {}, speed: 100, status: 'invited', updated_at: 0, drives: null },
    ],
  },
  {
    id: 8, user_id: 1, creator: 'Carol', g: null, s: null, p: null, planet_type: 'planet', target_time: target + 86400, time_precision: 'hour', note: null,
    status: 'planning', created_at: 0, updated_at: 0, claim_user_id: null, player_id: 6, player_name: 'Zweiter', planet_name: null, fleets: [],
  },
];
const empire = { empire: { time: 0, data: { planets: [{ name: 'Ares', coords: { g: 1, s: 100, p: 12 }, type: 'planet', values: { 204: 50, 207: 3, 1: 30 } }] } } };
const ctx: UniContext = {
  universe: {
    id: 1, slug: 'u8', name: 'U8', deck: [],
    settings: {
      galaxies: 9, systems: 400, positions: 15, circularGalaxies: true, circularSystems: true, galaxyDistanceFactor: 20000,
      systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '',
    },
  },
  group: { id: 1, name: 'A', role: 'member' },
  members: [],
  me: { id: 1, username: 'carol', isAdmin: false },
  own: null,
};

let root: HTMLElement;
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};

describe('raid planner page', () => {
  beforeAll(async () => {
    setLocale('de');
    vi.stubGlobal('confirm', () => true);
    vi.stubGlobal('fetch', async (url: string) => {
      const body = url.includes('/imperium') ? empire : url.includes('/plans') ? plans : [];
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:uni/:page', component: { render: () => null } }] });
    await router.push('/u8/raid-planner?new=3:115:8&type=moon');
    const Shell = defineComponent({
      setup() {
        provideUni(ref(ctx));
        return () => h(RaidPlannerView);
      },
    });
    root = document.createElement('div');
    document.body.append(root);
    createApp(Shell).use(router).use(i18n).mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('opens the form prefilled from the action menu link', () => {
    expect(root.querySelector<HTMLInputElement>('.plan-form input.mono')!.value).toBe('3:115:8');
    expect(root.querySelector<HTMLSelectElement>('.plan-form select')!.value).toBe('moon');
  });

  it('lists the plan with lead, launch times and the fleets of all members', () => {
    const text = root.querySelector('.plan')!.textContent!;
    expect(text).toContain('[1:41:1]');
    expect(text).toContain('Konter');
    // Dave's light fighters without known drives are the slowest: he launches first
    expect(text).toContain('Anführer: Dave');
    expect(text).toContain('1.773 SS');
    expect(text).toContain('Start und Schiffe fehlen');
    const rows = root.querySelectorAll('.plan tbody tr');
    expect(rows).toHaveLength(3);
    // launch times as clocks, Dave's drives unknown
    expect(rows[0].textContent).toMatch(/\d\d:\d\d:\d\d/);
    expect(rows[1].querySelector('.warn')).not.toBeNull();
  });

  it('shows a plan against a player without coordinates and with a rough time', () => {
    const text = root.querySelectorAll('.plan')[1].textContent!;
    expect(text).toContain('Koordinaten noch offen');
    expect(text).toContain('Zweiter');
    expect(text).toContain('ca.');
    expect(text).toContain('Ohne Koordinaten gibt es noch keine Flugzeiten.');
  });

  it('offers only the ships on the start planet and adds all of a type with "max"', async () => {
    const add = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Eigene Flotte hinzufügen')!;
    add.click();
    await settle();
    const select = root.querySelector<HTMLSelectElement>('.fleet-form select')!;
    select.value = '1:100:12:planet';
    select.dispatchEvent(new Event('change'));
    await settle();
    // nothing added yet; the list holds the ships on Ares with their amounts
    expect(root.querySelectorAll('.ship-row')).toHaveLength(0);
    const pick = root.querySelectorAll<HTMLSelectElement>('.fleet-form select')[2];
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Schiff …', 'Leichter Jäger (50)', 'Schlachtschiff (3)']);
    pick.value = '207';
    pick.dispatchEvent(new Event('change'));
    await settle();
    [...root.querySelectorAll<HTMLButtonElement>('.fleet-form button')].find((b) => b.textContent!.trim() === 'max')!.click();
    await settle();
    const row = root.querySelector('.ship-row')!;
    expect(row.textContent).toContain('Schlachtschiff');
    expect(row.querySelector<HTMLInputElement>('input')!.value).toBe('3');
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Schiff …', 'Leichter Jäger (50)']);
  });
});
