// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, setLocale } from '../src/i18n';
import { toLocalInput } from '../src/plans';
import RaidPlannerView from '../src/views/RaidPlannerView.vue';

// Smoke test of the raid planner page: real components, texts and router; the API answers from fixtures.
const target = Math.floor(Date.now() / 1000) + 3600;
const plans = [
  {
    id: 7, user_id: 1, creator: 'Carol', g: 1, s: 41, p: 1, planet_type: 'moon', target_time: target, time_precision: 'exact', note: 'Konter', status: 'planning',
    created_at: 0, updated_at: 0, claim_user_id: 1, player_id: 5, player_name: 'Gegner', planet_name: 'Mond',
    fleets: [
      { id: 1, user_id: 1, member: 'Carol', g: 1, s: 40, p: 5, planet_type: 'planet', ships: { 207: 1773, 215: 2 }, speed: 90, status: 'ready', updated_at: 0,
        drives: { time: Math.floor(Date.now() / 1000), research: { 115: 10, 117: 8, 118: 6, 134: 0 } }, seen: null },
      { id: 2, user_id: 2, member: 'Dave', g: 1, s: 42, p: 7, planet_type: 'planet', ships: { 204: 100 }, speed: 100, status: 'launched', updated_at: 0, drives: null,
        seen: { arrival: target + 3, time: 0, ships: { 204: 90, 222: 5 } } },
      { id: 3, user_id: 3, member: 'Erin', g: null, s: null, p: null, planet_type: null, ships: {}, speed: 100, status: 'invited', updated_at: 0, drives: null, seen: null },
    ],
  },
  {
    id: 8, user_id: 1, creator: 'Carol', g: null, s: null, p: null, planet_type: 'planet', target_time: target + 86400, time_precision: 'hour', note: null,
    status: 'planning', created_at: 0, updated_at: 0, claim_user_id: null, player_id: 6, player_name: 'Zweiter', planet_name: null, fleets: [],
  },
  {
    id: 9, user_id: 1, creator: 'Carol', g: 1, s: 41, p: 1, planet_type: 'moon', target_time: target + 7200, time_precision: 'exact', note: null,
    status: 'planning', created_at: 0, updated_at: 0, claim_user_id: 1, player_id: 5, player_name: 'Gegner', planet_name: 'Mond', fleets: [],
    enemy: {
      member_id: 2, member: 'Dave', from: { g: 1, s: 41, p: 1, type: 'moon' }, to: { g: 1, s: 100, p: 12, type: 'planet' },
      fleets: [{ mission: 1, ships: { 210: 1 } }, { mission: 2, ships: { 207: 1773, 215: 2 } }], follow: 1,
      arrival: target, first_seen: target - 600, drives: { 115: 10, 117: 8, 118: 6 }, drives_source: 'spy', drives_time: Math.floor(Date.now() / 1000),
      departure: null, recall: null, recall_lead: true, recall_seen: { from: target - 3000, to: target - 2400 }, percent: null, buffer: 5,
      hold_offset: -1, phalanx: null, updated_at: 0, updated_by: null,
    },
  },
  {
    id: 10, user_id: 1, creator: 'Carol', g: 1, s: 100, p: 12, planet_type: 'planet', target_time: target + 299, time_precision: 'exact', note: null,
    status: 'planning', mission: 'hold', created_at: 0, updated_at: 0, claim_user_id: null, player_id: null, player_name: null, planet_name: 'Ares',
    fleets: [
      { id: 11, user_id: 1, member: 'Carol', g: 1, s: 40, p: 5, planet_type: 'planet', ships: { 204: 10 }, speed: 100, status: 'ready', updated_at: 0,
        drives: { time: Math.floor(Date.now() / 1000), research: { 115: 10 } }, seen: null },
      { id: 12, user_id: 2, member: 'Dave', g: 2, s: 100, p: 3, planet_type: 'planet', ships: { 207: 10 }, speed: 100, status: 'ready', updated_at: 0,
        drives: { time: Math.floor(Date.now() / 1000), research: { 118: 6 } }, seen: null },
    ],
    enemy: {
      member_id: 1, member: 'Carol', from: { g: 2, s: 5, p: 5, type: 'planet' }, to: { g: 1, s: 100, p: 12, type: 'planet' },
      fleets: [{ mission: 1, ships: { 206: 40 } }], follow: 0, arrival: target + 300, first_seen: target + 300, drives: {}, drives_source: null, drives_time: null,
      departure: null, recall: null, recall_lead: true, recall_seen: null, percent: null, buffer: 1, hold_offset: -1, phalanx: null, updated_at: 0, updated_by: null,
    },
  },
];
const attacks = [
  { key: 'k1', memberId: 2, member: 'Dave', seen: 0, arrival: target + 300, from: { g: 2, s: 5, p: 5, type: 'planet' }, to: { g: 1, s: 42, p: 7, type: 'planet' },
    fleets: [{ mission: 1, ships: { 206: 40 } }], player: null, drives: null, until: target + 9999, planId: null, holdPlanId: 10,
    source: 'overview', reporter: null, home: null },
  { key: 'k2', memberId: null, member: 'Opfer', seen: 0, arrival: target + 600, from: { g: 5, s: 50, p: 5, type: 'planet' }, to: { g: 5, s: 60, p: 6, type: 'planet' },
    fleets: [{ mission: 1, ships: { 206: 12 } }], player: null, drives: null, until: target + 9999, planId: null, holdPlanId: null,
    source: 'phalanx', reporter: 'Dave', home: target + 1800 },
];
const empire = {
  empire: {
    time: 0,
    data: {
      planets: [
        { name: 'Ares', coords: { g: 1, s: 100, p: 12 }, type: 'planet', values: { 204: 50, 207: 3, 1: 30 } },
        { name: 'Whorus', coords: { g: 2, s: 100, p: 15 }, type: 'moon', values: { 215: 7 } },
      ],
      flyingShips: { 207: 2 },
    },
  },
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
  members: [],
  me: { id: 1, username: 'carol', isAdmin: false },
  own: null,
};

let root: HTMLElement;
/** renders of the page component itself (not of its countdowns) */
let pageUpdates = 0;
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};

describe('raid planner page', () => {
  beforeAll(async () => {
    setLocale('de');
    // four current plans are closed by default: open them for the checks below (the collapsing has its own test)
    localStorage.setItem('raidPlanner.open.u8', JSON.stringify({ 7: true, 8: true, 9: true, 10: true }));
    vi.stubGlobal('confirm', () => true);
    vi.stubGlobal('fetch', async (url: string) => {
      const body = url.includes('/imperium') ? empire : url.includes('/hostile-attacks') ? attacks : url.includes('/plans') ? plans : [];
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
    const app = createApp(Shell).use(router).use(i18n);
    app.mixin({
      updated(this: { $: { type: { __name?: string } } }) {
        if (this.$.type.__name === 'RaidPlannerView') pageUpdates++;
      },
    });
    app.mount(root);
    await settle();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('changes the speed of a fleet right in the table', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return fetchMock(url, init);
    });
    const select = root.querySelector<HTMLSelectElement>('.plan tbody tr select.speed')!;
    expect(select.value).toBe('90');
    select.value = '60';
    select.dispatchEvent(new Event('change'));
    await settle();
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toMatch(/\/plans\/7\/fleets\/1$/);
    expect(JSON.parse(String(put.init!.body))).toEqual({ speed: 60 });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('offers the ships the overview shows flying for the plan', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return fetchMock(url, init);
    });
    const row = [...root.querySelectorAll('.plan tbody tr')].find((tr) => tr.textContent!.includes('Dave'))!;
    expect(row.textContent).toContain('fliegt mit');
    [...row.querySelectorAll('button')].find((b) => b.textContent === 'In den Plan übernehmen')!.click();
    await settle();
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toMatch(/\/plans\/7\/fleets\/2$/);
    expect(JSON.parse(String(put.init!.body))).toEqual({ ships: { 204: 90, 222: 5 } });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('only updates the countdowns every second, not the page (open dropdowns keep their highlight)', async () => {
    const countdown = () => root.querySelector('.plan .time .muted')!.textContent;
    const before = countdown();
    pageUpdates = 0;
    await new Promise((r) => setTimeout(r, 2200));
    expect(countdown()).not.toBe(before);
    expect(pageUpdates).toBe(0);
  });

  it('collapses a plan to a summary line and opens it again', async () => {
    const plan = root.querySelector('.plan')!;
    const toggle = plan.querySelector<HTMLButtonElement>('.plan-head .toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    await settle();
    expect(plan.querySelector('tbody')).toBeNull();
    const summary = plan.querySelector('.summary')!;
    expect(summary.textContent).toContain('3 Flotten');
    // Carol's own fleet can no longer make it: the summary warns instead of showing her launch
    expect(summary.textContent).toContain('zu spät');
    expect(summary.textContent).not.toContain('Dein Start');
    expect(JSON.parse(localStorage.getItem('raidPlanner.open.u8')!)[7]).toBe(false);
    (summary as HTMLElement).click();
    await settle();
    expect(plan.querySelector('tbody')).not.toBeNull();
  });

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
    const rows = root.querySelector('.plan')!.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    // launch times as clocks, Dave's drives unknown
    expect(rows[0].textContent).toMatch(/\d\d:\d\d:\d\d/);
    expect(rows[1].querySelector('.warn')).not.toBeNull();
    // Dave's fleet is in flight per his overview: real arrival against the target time
    expect(rows[1].textContent).toContain('gestartet laut Übersicht');
    expect(rows[1].textContent).toContain('+3 s');
  });

  it('shows a plan against a player without coordinates and with a rough time', () => {
    const text = root.querySelectorAll('.plan')[1].textContent!;
    expect(text).toContain('Koordinaten noch offen');
    expect(text).toContain('Zweiter');
    expect(text).toContain('ca.');
    expect(text).toContain('Ohne Koordinaten gibt es noch keine Flugzeiten.');
  });

  it('fills in open coordinates right from the plan', async () => {
    const plan = root.querySelectorAll('.plan')[1];
    plan.querySelector<HTMLButtonElement>('button.link')!.click();
    await settle();
    const form = plan.querySelector('.edit-box')!;
    // only the target: no player search, time or note
    expect(form.querySelectorAll('.field')).toHaveLength(1);
    expect(form.querySelector('input.mono')).not.toBeNull();
    [...form.querySelectorAll('button')].find((b) => b.textContent === 'Abbrechen')!.click();
    await settle();
    expect(plan.querySelector('.edit-box')).toBeNull();
  });

  it('lists hostile attacks and shows the retime candidates of a plan', async () => {
    const list = root.querySelector('.attacks')!;
    expect(list.textContent).toContain('Angriff auf Dave');
    expect(list.textContent).toContain('Retime planen');
    const panel = root.querySelector('.retime')!;
    expect(panel.textContent).toContain('verzögert um 0:10:00');
    expect(panel.querySelectorAll('.cands tbody tr')).toHaveLength(10);
    expect(panel.textContent).toContain('Geschwindigkeit wählen');
    const radio = panel.querySelectorAll<HTMLInputElement>('.cands input[type=radio]')[3];
    radio.click();
    await settle();
    expect(panel.textContent).toMatch(/Zielzeit des Plans: \d\d:\d\d:\d\d/);
    expect(panel.querySelector<HTMLButtonElement>('button.primary')!.disabled).toBe(false);
  });

  it('plans holds next to retimes: every fleet lands on its own 1 s before the impact', () => {
    expect(root.querySelector('.attacks')!.textContent).toContain('Halten geplant');
    const plan = [...root.querySelectorAll('.plan')].find((p) => p.querySelector('div.hold'))!;
    expect(plan.querySelector('.badge.mission-hold')!.textContent).toBe('Halten');
    expect(plan.querySelector('div.hold')!.textContent).toContain('rechtzeitig vor dem Einschlag');
    expect(plan.querySelector('div.hold')!.textContent).toContain('(−1 s)');
    // no ACS: no lead, both launch times shown
    expect(plan.textContent).not.toContain('Anführer');
    expect(plan.querySelectorAll('tbody tr')).toHaveLength(2);
    expect([...plan.querySelectorAll('tbody tr')].every((r) => /\d\d:\d\d:\d\d/.test(r.textContent!))).toBe(true);
  });

  it('takes attacks from a pasted phalanx, with the return when the phalanx shows it', async () => {
    const row = [...root.querySelectorAll('.attacks .attack')].find((r) => r.textContent!.includes('Opfer'))!;
    expect(row.querySelector('.badge')!.textContent).toBe('Phalanx');
    expect(row.textContent).toMatch(/Rückkehr \d\d:\d\d:\d\d/);
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Phalanx einfügen')!.click();
    await settle();
    expect(root.querySelector('.phalanx-form textarea')).not.toBeNull();
    [...root.querySelectorAll('.phalanx-form button')].find((b) => b.textContent === 'Abbrechen')!.click();
    await settle();
    expect(root.querySelector('.phalanx-form')).toBeNull();
  });

  it('offers the recall seen in the overview pastes and links into the flight calculator', async () => {
    const panel = root.querySelector('.retime')!;
    expect(panel.textContent).toContain('wohl zurückgerufen');
    const link = panel.querySelector<HTMLAnchorElement>('a[href*="flight-calculator"]')!;
    expect(link.href).toContain('m=retime');
    const apply = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Als Rückruf übernehmen')!;
    apply.click();
    await settle();
    // desktop: the date picker shows the hub's date format (de: 23.10.2026 19:12:22)
    const [from, to] = [...panel.querySelectorAll<HTMLInputElement>('.dt-input input')].slice(2).map((i) => i.value);
    const shown = (epoch: number) => toLocalInput(epoch).replace(/^(\d+)-(\d+)-(\d+)T/, '$3.$2.$1 ');
    expect([from, to]).toEqual([shown(target - 3000), shown(target - 2400)]);
    expect(panel.textContent).not.toContain('wohl zurückgerufen');
    expect(panel.querySelector<HTMLAnchorElement>('a[href*="flight-calculator"]')!.href).toContain('eout=recall');
    // every fleet of an exact plan with a start links its launch times
    expect(root.querySelector('.plan tbody tr a.calc')!.getAttribute('href')).toContain('m=timing');
  });

  it('adds ships from the start planet or from all own ones, each with its maximum', async () => {
    const add = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Eigene Flotte hinzufügen')!;
    add.click();
    await settle();
    const start = root.querySelector<HTMLSelectElement>('.fleet-form select')!;
    start.value = '1:100:12:planet';
    start.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelectorAll('.ship-row')).toHaveLength(0);
    const pick = () => root.querySelectorAll<HTMLSelectElement>('.fleet-form select')[2];
    const groups = () => [...pick().querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]);
    expect(groups()).toEqual([
      ['Am Startplanet Ares', ['Leichter Jäger (50)', 'Schlachtschiff (3)']],
      ['Alle Schiffe (Planeten, Monde, im Flug)', ['Leichter Jäger (50)', 'Schlachtschiff (5)', 'Schlachtkreuzer (7)']],
    ]);
    const choose = async (value: string) => {
      pick().value = value;
      pick().dispatchEvent(new Event('change'));
      await settle();
    };
    // battlecruisers still to be moved to the start: all own ones
    await choose('all:215');
    await choose('start:207');
    const rows = [...root.querySelectorAll('.ship-row')];
    expect(rows.map((r) => [r.querySelector('.ship-name')!.textContent, r.querySelector('input')!.value])).toEqual([
      ['Schlachtschiff', '3'],
      ['Schlachtkreuzer', '7'],
    ]);
    expect(rows[0].textContent).toContain('am Startplanet');
    expect(rows[1].textContent).toContain('gesamt');
    expect(groups().map((g) => g[1])).toEqual([['Leichter Jäger (50)'], ['Leichter Jäger (50)']]);
    // the amount stays editable, "max" restores it
    const input = rows[0].querySelector('input')!;
    input.value = '1';
    input.dispatchEvent(new Event('input'));
    await settle();
    [...rows[0].querySelectorAll('button')].find((b) => b.textContent!.trim() === 'max')!.click();
    await settle();
    expect(root.querySelector<HTMLInputElement>('.ship-row input')!.value).toBe('3');
  });

  it("edits another member's fleet from that member's empire page, the start typed in without one", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/imperium?user=3')) return new Response(JSON.stringify({ empire: null }), { headers: { 'content-type': 'application/json' } });
      return fetchMock(url, init);
    });
    const erin = [...root.querySelectorAll('.plan tbody tr')].find((r) => r.textContent!.includes('Erin'))!;
    [...erin.querySelectorAll('button')].find((b) => b.textContent === 'Bearbeiten')!.click();
    await settle();
    expect(calls.map((c) => c.url)).toContainEqual(expect.stringContaining('/imperium?user=3'));
    const form = root.querySelector('.fleet-form')!;
    expect(form.querySelector('h4')!.textContent).toBe('Flotte von Erin');
    const manual = form.querySelector<HTMLInputElement>('input.mono')!;
    manual.value = '2:50:4';
    manual.dispatchEvent(new Event('input'));
    const moon = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    moon.checked = true;
    moon.dispatchEvent(new Event('change'));
    // drives unknown: entered by hand
    expect(form.querySelector('.drives')!.textContent).toContain('unbekannt');
    const drives = [...form.querySelectorAll<HTMLInputElement>('.drives input')];
    expect(drives.map((i) => i.value)).toEqual(['0', '0', '0']);
    drives[1].value = '6';
    drives[1].dispatchEvent(new Event('input'));
    await settle();
    expect(form.querySelector('.drives')!.textContent).toContain('von Hand');
    [...form.querySelectorAll('button')].find((b) => b.textContent === 'Speichern')!.click();
    await settle();
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toContain('/plans/7/fleets/3');
    expect(JSON.parse(put.init!.body as string)).toMatchObject({ g: 2, s: 50, p: 4, type: 'moon', drives: { 115: 0, 117: 6, 118: 0 } });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('offers the planets from the spy reports without an empire page, and other coordinates', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = globalThis.fetch;
    const spy = { time: 1893456000, research: {}, researchTime: null, planets: [{ name: 'Basis', coords: { g: 1, s: 42, p: 7 }, type: 'planet', values: { 204: 300 }, time: 1893456000 }] };
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/imperium?user=2')) return new Response(JSON.stringify({ empire: null, spy }), { headers: { 'content-type': 'application/json' } });
      return fetchMock(url, init);
    });
    const dave = [...root.querySelectorAll('.plan')][0].querySelectorAll('tbody tr')[1];
    [...dave.querySelectorAll('button')].find((b) => b.textContent === 'Bearbeiten')!.click();
    await settle();
    const form = root.querySelector('.fleet-form')!;
    expect(form.textContent).toContain('aus Spionageberichten');
    const start = form.querySelector<HTMLSelectElement>('select')!;
    expect([...start.options].map((o) => o.textContent!.trim())).toEqual(['–', 'Basis [1:42:7]', 'Andere Koordinaten …']);
    expect(start.value).toBe('1:42:7:planet');
    expect(form.querySelector('.start-input')).toBeNull();
    // ships the reports miss can be added by hand
    const groups = [...form.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toContain('Schiffe (keine Imperium-Seite)');
    start.value = 'manual';
    start.dispatchEvent(new Event('change'));
    await settle();
    const manual = form.querySelector<HTMLInputElement>('.start-input')!;
    expect(manual.value).toBe('1:42:7');
    manual.value = '1:42:9';
    manual.dispatchEvent(new Event('input'));
    await settle();
    [...form.querySelectorAll('button')].find((b) => b.textContent === 'Speichern')!.click();
    await settle();
    const body = JSON.parse(calls.find((c) => c.init?.method === 'PUT')!.init!.body as string);
    expect(body).toMatchObject({ g: 1, s: 42, p: 9, type: 'planet' });
    expect(body.drives).toBeUndefined();
    vi.stubGlobal('fetch', fetchMock);
  });
});
