// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { provideUni, type UniContext } from '../src/composables';
import { i18n, setLocale } from '../src/i18n';
import { toLocalInput } from '../src/plans';
import RaidPlannerView from '../src/views/RaidPlannerView.vue';
import RaidPlanView from '../src/views/RaidPlanView.vue';

// Smoke test of the raid planner (plan list and a plan's page): real components, texts and router; the API answers from fixtures.
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
let router: Router;
/** renders of the plan page component itself (not of its countdowns) */
let pageUpdates = 0;
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const go = async (path: string) => {
  await router.push(path);
  await settle();
};
/** A button by its text (icons have none), in the page or a sheet/menu teleported to the body. */
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === text)!;
/** Opens the action menu (three dots) in `scope` and picks an item. */
async function menuItem(scope: ParentNode, label: string) {
  scope.querySelector<HTMLButtonElement>('.menu-btn')!.click();
  await settle();
  const item = [...document.body.querySelectorAll<HTMLElement>('.menu [role=menuitem]')].find((b) => b.textContent!.includes(label))!;
  item.click();
  await settle();
}
const fleetRows = () => [...root.querySelectorAll<HTMLTableRowElement>('.fleet-table tbody tr')];
/** Records the requests of a test and gives them back. */
function recordCalls(answer?: (url: string) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = answer?.(url);
    return body !== undefined ? new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }) : fetchMock(url, init);
  });
  return { calls, restore: () => vi.stubGlobal('fetch', fetchMock) };
}

beforeAll(async () => {
  setLocale('de');
  vi.stubGlobal('confirm', () => true);
  vi.stubGlobal('fetch', async (url: string) => {
    const body = url.includes('/imperium') ? empire : url.includes('/hostile-attacks') ? attacks : url.includes('/plans') ? plans : [];
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  });
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/:uni/raid-planner', component: RaidPlannerView },
      { path: '/:uni/raid-planner/:id(\\d+)', component: RaidPlanView },
      { path: '/:uni/:page/:rest(.*)*', component: { render: () => null } },
    ],
  });
  await router.push('/u8/raid-planner?new=3:115:8&type=moon');
  const Shell = defineComponent({
    setup() {
      provideUni(ref(ctx));
      return () => h(RouterView);
    },
  });
  root = document.createElement('div');
  document.body.append(root);
  const app = createApp(Shell).use(router).use(i18n);
  app.mixin({
    updated(this: { $: { type: { __name?: string } } }) {
      if (this.$.type.__name === 'RaidPlanView') pageUpdates++;
    },
  });
  app.mount(root);
  await settle();
});
afterAll(() => vi.unstubAllGlobals());

describe('raid planner: plan list', () => {
  it('opens the new plan sheet prefilled from the action menu link', async () => {
    expect(document.body.querySelector<HTMLInputElement>('.plan-form input.mono')!.value).toBe('3:115:8');
    expect(document.body.querySelector<HTMLSelectElement>('.plan-form select')!.value).toBe('moon');
    button(document.body.querySelector('.sheet')!, 'Abbrechen').click();
    await settle();
    expect(document.body.querySelector('.plan-form')).toBeNull();
    expect(router.currentRoute.value.query.new).toBeUndefined();
  });

  it('lists the current plans as rows opening their page, with fleets and warnings', () => {
    const rows = [...root.querySelectorAll<HTMLAnchorElement>('.plan-row')];
    expect(rows).toHaveLength(4);
    const first = rows.find((r) => r.getAttribute('href')!.endsWith('/raid-planner/7'))!;
    expect(first.textContent).toContain('[1:41:1]');
    expect(first.textContent).toContain('3 Flotten');
    // Carol's own fleet can no longer make it
    expect(first.textContent).toContain('zu spät');
    const second = rows.find((r) => r.getAttribute('href')!.endsWith('/raid-planner/8'))!;
    expect(second.textContent).toContain('Koordinaten noch offen');
    expect(second.textContent).toContain('Zweiter');
    expect(rows.find((r) => r.getAttribute('href')!.endsWith('/raid-planner/10'))!.querySelector('.badge.mission-hold')!.textContent).toBe('Halten');
  });

  it('lists hostile attacks: retime as the main action, hold planned, phalanx attacks with their return', () => {
    const list = root.querySelector('.attacks')!;
    expect(list.textContent).toContain('Angriff auf Dave');
    expect(button(list, 'Retime planen')).toBeTruthy();
    expect(list.textContent).toContain('Halten geplant');
    const row = [...list.querySelectorAll('.attack')].find((r) => r.textContent!.includes('Opfer'))!;
    expect(row.querySelector('.badge')!.textContent).toBe('Phalanx');
    expect(row.textContent).toMatch(/Rückkehr \d\d:\d\d:\d\d/);
  });

  it('takes attacks from a pasted phalanx in a sheet', async () => {
    await menuItem(root.querySelector('.page-head')!, 'Phalanx einfügen');
    expect(document.body.querySelector('.phalanx-form textarea')).not.toBeNull();
    button(document.body.querySelector('.sheet')!, 'Abbrechen').click();
    await settle();
    expect(document.body.querySelector('.phalanx-form')).toBeNull();
  });

  it('sends links with ?plan= on to the plan page', async () => {
    await go('/u8/raid-planner?plan=7');
    expect(router.currentRoute.value.path).toBe('/u8/raid-planner/7');
  });
});

describe('raid planner: a plan', () => {
  beforeAll(() => go('/u8/raid-planner/7'));

  it('shows the plan with lead, launch times and the fleets of all members', () => {
    const text = root.querySelector('.plan-card')!.textContent!;
    expect(text).toContain('[1:41:1]');
    expect(text).toContain('Konter');
    // Dave's light fighters without known drives are the slowest: he launches first
    expect(text).toMatch(/Anführer\s*Dave/);
    const rows = fleetRows();
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('1.773 SS');
    expect(rows[2].textContent).toContain('Start und Schiffe fehlen');
    // launch times as clocks, Dave's drives unknown
    expect(rows[0].textContent).toMatch(/\d\d:\d\d:\d\d/);
    expect(rows[1].querySelector('.warn')).not.toBeNull();
    // Dave's fleet is in flight per his overview: real arrival against the target time
    expect(rows[1].textContent).toContain('gestartet laut Übersicht');
    expect(rows[1].textContent).toContain('+3 s');
    // every fleet of an exact plan with a start links its launch times in its menu
    expect(rows[0].querySelector('.menu-btn')).not.toBeNull();
  });

  it('puts the own launch first as the next step, here too late', () => {
    const next = root.querySelector('.next-step')!;
    expect(next.textContent).toContain('Dein Start');
    expect(next.textContent).toContain('zu spät');
    expect(button(next, 'Als gestartet markieren')).toBeTruthy();
  });

  it('changes the speed of a fleet right in the table', async () => {
    const { calls, restore } = recordCalls();
    const select = fleetRows()[0].querySelector<HTMLSelectElement>('select.speed')!;
    expect(select.value).toBe('90');
    select.value = '60';
    select.dispatchEvent(new Event('change'));
    await settle();
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toMatch(/\/plans\/7\/fleets\/1$/);
    expect(JSON.parse(String(put.init!.body))).toEqual({ speed: 60 });
    restore();
  });

  it('offers the ships the overview shows flying for the plan', async () => {
    const { calls, restore } = recordCalls();
    const row = fleetRows().find((tr) => tr.textContent!.includes('Dave'))!;
    expect(row.textContent).toContain('fliegt mit');
    button(row, 'In den Plan übernehmen').click();
    await settle();
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toMatch(/\/plans\/7\/fleets\/2$/);
    expect(JSON.parse(String(put.init!.body))).toEqual({ ships: { 204: 90, 222: 5 } });
    restore();
  });

  it('only updates the countdowns every second, not the page (open dropdowns keep their highlight)', async () => {
    const countdown = () => root.querySelector('.plan-card .time .muted')!.textContent;
    const before = countdown();
    pageUpdates = 0;
    await new Promise((r) => setTimeout(r, 2200));
    expect(countdown()).not.toBe(before);
    expect(pageUpdates).toBe(0);
  });

  it('adds ships from the start planet or from all own ones, each with its maximum', async () => {
    button(root.querySelector('.fleets .section-actions')!, 'Eigene Flotte hinzufügen').click();
    await settle();
    const form = document.body.querySelector('.fleet-form')!;
    const start = form.querySelector<HTMLSelectElement>('select')!;
    start.value = '1:100:12:planet';
    start.dispatchEvent(new Event('change'));
    await settle();
    expect(form.querySelectorAll('.ship-row')).toHaveLength(0);
    const pick = () => form.querySelector<HTMLSelectElement>('select.add-ship')!;
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
    const rows = [...form.querySelectorAll('.ship-row')];
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
    button(rows[0], 'max').click();
    await settle();
    expect(form.querySelector<HTMLInputElement>('.ship-row input')!.value).toBe('3');
    button(document.body.querySelector('.sheet-footer')!, 'Abbrechen').click();
    await settle();
    expect(document.body.querySelector('.fleet-form')).toBeNull();
  });

  it("edits another member's fleet from that member's empire page, the start typed in without one", async () => {
    const { calls, restore } = recordCalls((url) => (url.includes('/imperium?user=3') ? { empire: null } : undefined));
    await menuItem(fleetRows().find((r) => r.textContent!.includes('Erin'))!, 'Bearbeiten');
    expect(calls.map((c) => c.url)).toContainEqual(expect.stringContaining('/imperium?user=3'));
    expect(document.body.querySelector('.sheet-title')!.textContent).toBe('Flotte von Erin');
    const form = document.body.querySelector('.fleet-form')!;
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
    button(document.body.querySelector('.sheet-footer')!, 'Speichern').click();
    await settle();
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toContain('/plans/7/fleets/3');
    expect(JSON.parse(put.init!.body as string)).toMatchObject({ g: 2, s: 50, p: 4, type: 'moon', drives: { 115: 0, 117: 6, 118: 0 } });
    expect(document.body.querySelector('.fleet-form')).toBeNull();
    restore();
  });

  it('offers the planets from the spy reports without an empire page, and other coordinates', async () => {
    const spy = { time: 1893456000, research: {}, researchTime: null, planets: [{ name: 'Basis', coords: { g: 1, s: 42, p: 7 }, type: 'planet', values: { 204: 300 }, time: 1893456000 }] };
    const { calls, restore } = recordCalls((url) => (url.includes('/imperium?user=2') ? { empire: null, spy } : undefined));
    await menuItem(fleetRows().find((r) => r.textContent!.includes('Dave'))!, 'Bearbeiten');
    const form = document.body.querySelector('.fleet-form')!;
    expect(form.textContent).toContain('aus Spionageberichten');
    const start = form.querySelector<HTMLSelectElement>('select')!;
    expect([...start.options].map((o) => o.textContent!.trim())).toEqual(['–', 'Basis [1:42:7]', 'Andere Koordinaten …']);
    expect(start.value).toBe('1:42:7:planet');
    expect(form.querySelector('.start-input')).toBeNull();
    // ships the reports miss can be added by hand
    expect([...form.querySelectorAll('optgroup')].map((g) => g.label)).toContain('Schiffe (keine Imperium-Seite)');
    start.value = 'manual';
    start.dispatchEvent(new Event('change'));
    await settle();
    const manual = form.querySelector<HTMLInputElement>('.start-input')!;
    expect(manual.value).toBe('1:42:7');
    manual.value = '1:42:9';
    manual.dispatchEvent(new Event('input'));
    await settle();
    button(document.body.querySelector('.sheet-footer')!, 'Speichern').click();
    await settle();
    const body = JSON.parse(calls.find((c) => c.init?.method === 'PUT')!.init!.body as string);
    expect(body).toMatchObject({ g: 1, s: 42, p: 9, type: 'planet' });
    expect(body.drives).toBeUndefined();
    restore();
  });
});

describe('raid planner: plans without coordinates, retimes and holds', () => {
  it('shows a plan against a player without coordinates and with a rough time, coordinates as the next step', async () => {
    await go('/u8/raid-planner/8');
    const text = root.querySelector('.plan-card')!.textContent!;
    expect(text).toContain('Koordinaten noch offen');
    expect(text).toContain('Zweiter');
    expect(text).toContain('ca.');
    expect(text).toContain('Ohne Koordinaten gibt es noch keine Flugzeiten.');
    button(root.querySelector('.next-step')!, 'Koordinaten eintragen').click();
    await settle();
    // only the target: no player search, time or note
    const form = document.body.querySelector('.edit-box')!;
    expect(form.querySelectorAll('.field')).toHaveLength(1);
    expect(form.querySelector('input.mono')).not.toBeNull();
    button(document.body.querySelector('.sheet-footer')!, 'Abbrechen').click();
    await settle();
    expect(document.body.querySelector('.edit-box')).toBeNull();
  });

  it('shows the retime candidates of a plan', async () => {
    await go('/u8/raid-planner/9');
    const panel = root.querySelector('.retime')!;
    expect(panel.textContent).toContain('verzögert um 0:10:00');
    expect(panel.querySelectorAll('.cands .cand:not(.cand-head)')).toHaveLength(10);
    expect(panel.textContent).toContain('Geschwindigkeit wählen');
    const radio = panel.querySelectorAll<HTMLInputElement>('.cands input[type=radio]')[3];
    radio.click();
    await settle();
    expect(panel.textContent).toMatch(/Zielzeit des Plans: \d\d:\d\d:\d\d/);
    expect(panel.querySelector<HTMLButtonElement>('button.primary')!.disabled).toBe(false);
  });

  it('offers the recall seen in the overview pastes and links into the flight calculator', async () => {
    const panel = root.querySelector('.retime')!;
    expect(panel.textContent).toContain('wohl zurückgerufen');
    const link = panel.querySelector<HTMLAnchorElement>('a[href*="flight-calculator"]')!;
    expect(link.href).toContain('m=retime');
    button(panel, 'Als Rückruf übernehmen').click();
    await settle();
    // desktop: the date picker shows the hub's date format (de: 23.10.2026 19:12:22)
    const [from, to] = [...panel.querySelectorAll<HTMLInputElement>('.dt-input input')].slice(2).map((i) => i.value);
    const shown = (epoch: number) => toLocalInput(epoch).replace(/^(\d+)-(\d+)-(\d+)T/, '$3.$2.$1 ');
    expect([from, to]).toEqual([shown(target - 3000), shown(target - 2400)]);
    expect(panel.textContent).not.toContain('wohl zurückgerufen');
    expect(panel.querySelector<HTMLAnchorElement>('a[href*="flight-calculator"]')!.href).toContain('eout=recall');
  });

  it('plans holds next to retimes: every fleet lands on its own 1 s before the impact', async () => {
    await go('/u8/raid-planner/10');
    const card = root.querySelector('.plan-card')!;
    expect(card.querySelector('.badge.mission-hold')!.textContent).toBe('Halten');
    const hold = root.querySelector('div.hold')!;
    expect(hold.textContent).toContain('rechtzeitig vor dem Einschlag');
    expect(hold.textContent).toContain('(−1 s)');
    // no ACS: no lead, both launch times shown
    expect(card.textContent).not.toContain('Anführer');
    const rows = fleetRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => /\d\d:\d\d:\d\d/.test(r.textContent!))).toBe(true);
  });
});
