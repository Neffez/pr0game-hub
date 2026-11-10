// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { provideUni, type UniContext } from '../src/composables';
import FleetSaveOptions from '../src/components/FleetSaveOptions.vue';
import { i18n, loadLocale, setLocale } from '../src/i18n';

// A colony save is always offered; what is said about it follows the planet limit of the universe (settings an admin
// entered) and the astrophysics and planets of the empire page.
const now = Math.floor(Date.now() / 1000);
const base = {
  galaxies: 9, systems: 400, positions: 15, circularGalaxies: true, circularSystems: true, galaxyDistanceFactor: 20000,
  systemDistanceFactor: 95, systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 2500, timezone: 'Europe/Berlin', gameUrl: '',
};
const LIMIT = { maxInitialPlanets: 1, maxAdditionalPlanets: 11, planetsPerTech: 0.5 };

async function mount(settings: object, planets: number | null, research: Record<string, number>) {
  const ctx = {
    universe: { id: 1, slug: 'u8', name: 'U8', deck: [], settings: { ...base, ...settings } },
    group: { id: 1, name: 'A', role: 'member' }, members: [], me: { id: 1, username: 'carol', isAdmin: false }, own: null,
  } as unknown as UniContext;
  const root = document.createElement('div');
  document.body.append(root);
  const Shell = defineComponent({
    setup() {
      provideUni(ref(ctx));
      return () =>
        h(FleetSaveOptions, {
          from: { coords: [1, 100, 12], type: 'planet', name: 'Ares' }, values: { 202: 50, 208: 1 }, research, deuterium: 1e9, targets: [],
          free: { 1: [{ s: 101, free: [4], seen: now - 600 }] }, now, latest: now + 3600, back: now + 9 * 3600, kinds: ['colonize'], planets,
        });
    },
  });
  createApp(Shell).use(i18n).mount(root);
  await nextTick();
  return root;
}
const drives = { 115: 10, 117: 8, 118: 6 };

describe('colony save and the planet limit', () => {
  beforeAll(async () => {
    await loadLocale('de');
    setLocale('de');
  });

  it('warns in general while the universe has no planet limit values', async () => {
    const root = await mount({}, 4, { ...drives, 124: 6 });
    expect(root.textContent).toContain('Kolo-Save');
    expect(root.querySelector('.fso-colonize')!.className).toContain('warn');
    expect(root.querySelector('.fso-colonize')!.textContent).toContain('Unter dem Maximum gründet das Kolonieschiff dort eine Kolonie');
  });

  it('offers it below the limit too, with a clear warning', async () => {
    // astrophysics 8: ceil(1 + 4) = 5 planets
    const root = await mount(LIMIT, 4, { ...drives, 124: 8 });
    expect(root.querySelectorAll('.fso-table tbody tr').length).toBeGreaterThan(0);
    const note = root.querySelector('.fso-colonize')!;
    expect(note.className).toContain('neg');
    expect(note.textContent).toContain('4 von 5 möglichen Planeten (Astrophysik 8)');
  });

  it('says that the fleet comes back at the limit', async () => {
    const root = await mount(LIMIT, 5, { ...drives, 124: 8 });
    const note = root.querySelector('.fso-colonize')!;
    expect(note.className).toContain('muted');
    expect(note.textContent).toContain('Planetenmaximum erreicht (5 von 5, Astrophysik 8)');
  });

  it('falls back to the general warning without planets or research', async () => {
    expect((await mount(LIMIT, null, { ...drives, 124: 8 })).querySelector('.fso-colonize')!.className).toContain('warn');
  });
});
