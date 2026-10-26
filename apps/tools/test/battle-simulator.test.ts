// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeShare, runBattle, summarize } from '@pr0hub/battle';
import { initSync, wasm_fight_battle_rounds } from '@pr0hub/battle/wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { applySpyReport, balance, battleSetup, cleanState, defaultDebrisTo, emptyState, fightingSlots, shareFromState, slotFlight, stateFromShare } from '../src/battle';
import { DEFAULT_UNI } from '../src/core';

const spyReport = [
  'Spionagebericht',
  '21. Okt 2026, 12:00:30',
  'Spionagebericht vom Planeten Ziel (Alpha) [1:110:8] am 21. Okt 2026, 12:00:30',
  'Rohstoffe', 'Metall', '300.000', 'Kristall', '150.000', 'Deuterium', '60.000',
  'Schiffe', 'Leichter Jäger', '20',
  'Verteidigungsanlagen', 'Raketenwerfer', '400', 'Ionengeschütz', '30',
  'Forschungen', 'Waffentechnik', '12', 'Schildtechnik', '11', 'Raumschiffpanzerung', '13',
  'Die Wahrscheinlichkeit der Zerstörung der Spionagesonde beträgt: 3 %',
].join('\n');

describe('battle simulator glue', () => {
  it('takes target, resources, fleet, defense and research of a spy report into the planet', () => {
    const s = emptyState();
    expect(applySpyReport(s, spyReport)).toMatchObject({ ok: true, coords: [1, 110, 8], fleet: true, defense: true, research: true, resources: true });
    expect(s.target).toEqual([1, 110, 8]);
    expect(s.resources).toEqual({ metal: 300000, crystal: 150000, deuterium: 60000 });
    expect(s.defenders[0].units).toEqual({ 204: 20, 401: 400, 405: 30 });
    expect(s.defenders[0].research).toEqual({ 109: 12, 110: 11, 111: 13 });
    expect(applySpyReport(emptyState(), 'nothing')).toEqual({ ok: false });
  });

  it('round-trips the share link and drops what is out of range', () => {
    const s = cleanState({
      attackers: [{ units: { 207: 50, 212: 5 }, research: { 109: 14, 118: 10 }, from: [1, 100, 5], speed: 80 }, { units: { 231: 1 }, research: {} }],
      defenders: [{ units: { 401: 100 }, research: { 111: 12 } }],
      target: [1, 110, 8],
      resources: { metal: 1000, crystal: 0, deuterium: 5 },
      runs: 50,
    });
    // no solar satellites attack
    expect(s.attackers[0].units).toEqual({ 207: 50 });
    expect(stateFromShare(shareFromState(s, {}))).toEqual(s);
  });

  it('leaves empty attackers out of the battle and keeps the planet', () => {
    const s = cleanState({ attackers: [{ units: {} }, { units: { 204: 5 } }], defenders: [{ units: {} }, { units: { 202: 1 } }] });
    expect(battleSetup(s).attackers).toHaveLength(1);
    expect(battleSetup(s).defenders).toHaveLength(2);
    expect(fightingSlots(s)).toEqual({ attackers: [1], defenders: [0, 1] });
  });

  it('times the flight of an attacker to the target', () => {
    const s = cleanState({ attackers: [{ units: { 204: 10 }, research: { 115: 10 }, from: [1, 100, 5], speed: 100 }], target: [1, 110, 8] });
    const f = slotFlight(s, s.attackers[0], { ...DEFAULT_UNI });
    expect(f).not.toBeNull();
    expect(f!.distance).toBe(2700 + 95 * 10);
    expect(f!.duration).toBeGreaterThan(0);
  });
});

describe('battle simulator balance', () => {
  const summary = {
    wins: { attacker: 0.7, defender: 0.1, draw: 0.2 },
    lostResources: { attacker: { metal: 1000, crystal: 500, deuterium: 0 }, defender: { metal: 4000, crystal: 2000, deuterium: 100 } },
    loot: { metal: 3000, crystal: 1500, deuterium: 600 },
    debris: { metal: { avg: 2500, min: 0, max: 0 }, crystal: { avg: 1250, min: 0, max: 0 } },
  } as unknown as Parameters<typeof balance>[0];

  it('nets losses, loot, fuel and debris per side in resources and DSU', () => {
    expect(defaultDebrisTo(summary)).toBe('attacker');
    const b = balance(summary, 'attacker', { metal: 2, crystal: 1 }, 200);
    expect(b.attacker.map((r) => r.key)).toEqual(['lost', 'loot', 'fuel', 'debris', 'net']);
    expect(b.attacker.at(-1)).toEqual({ key: 'net', metal: 4500, crystal: 2250, deuterium: 400, dse: 4500 / 2 + 2250 + 400 });
    expect(b.defender.map((r) => r.key)).toEqual(['lost', 'loot', 'net']);
    expect(b.defender.at(-1)).toMatchObject({ metal: -7000, crystal: -3500, deuterium: -700 });
  });

  it('takes the fuel of holding fleets into the defenders balance', () => {
    const b = balance(summary, 'attacker', { metal: 2, crystal: 1 }, { attacker: 100, defender: 40 });
    expect(b.attacker.find((r) => r.key === 'fuel')!.deuterium).toBe(-100);
    expect(b.defender.map((r) => r.key)).toEqual(['lost', 'loot', 'fuel', 'net']);
  });

  it('takes the recyclers fuel of both sides into the balance', () => {
    const b = balance(summary, 'defender', { metal: 2, crystal: 1 }, 0, { attacker: 50, defender: 30 });
    expect(b.attacker.map((r) => r.key)).toEqual(['lost', 'loot', 'recyclerFuel', 'net']);
    expect(b.defender.map((r) => r.key)).toEqual(['lost', 'loot', 'recyclerFuel', 'debris', 'net']);
    expect(b.defender.at(-1)!.deuterium).toBe(-700 - 30);
  });

  it('leaves the debris to the defender on a draw', () => {
    expect(defaultDebrisTo({ ...summary, wins: { attacker: 0, defender: 0, draw: 1 } })).toBe('defender');
    expect(balance(summary, 'defender').defender.map((r) => r.key)).toEqual(['lost', 'loot', 'debris', 'net']);
  });
});

describe('battle simulator page', () => {
  beforeAll(async () => {
    initSync({ module: readFileSync(resolve(import.meta.dirname, '../../../packages/battle/wasm/battlerust_bg.wasm')) });
    // the worker runs the engine in the test's thread
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      postMessage(job: { id: number; setup: Parameters<typeof runBattle>[1]; runs: number; settings: Parameters<typeof runBattle>[2] }) {
        const list = Array.from({ length: job.runs }, () => runBattle(wasm_fight_battle_rounds, job.setup, job.settings));
        setTimeout(() => this.onmessage?.({ data: { id: job.id, type: 'done', summary: summarize(list) } }));
      }
      terminate() {}
    }
    (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
    const html = readFileSync(resolve(import.meta.dirname, '../battle-simulator/index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
    const state = cleanState({
      attackers: [{ units: { 207: 100, 203: 50 }, research: { 109: 10, 110: 10, 111: 10 } }],
      defenders: [{ units: { 401: 50, 405: 10 }, research: {} }],
      target: [1, 110, 8],
      resources: { metal: 500000, crystal: 200000, deuterium: 100000 },
      runs: 10,
    });
    location.hash = '#' + encodeShare(shareFromState(state, { fd: 50, dd: 10 }));
    await import('../battle-simulator/main.js');
    await new Promise((r) => setTimeout(r, 20));
  });

  it('loads a link, runs it at once and shows the result', () => {
    expect(location.hash).toBe('');
    expect((document.getElementById('u-att-207') as HTMLInputElement).value).toBe('100');
    const hero = document.getElementById('outcome')?.textContent ?? '';
    expect(hero).toContain('100 %');
    expect(document.getElementById('uniSummary')?.textContent).toContain('50/10');
    // the rocket launchers' debris: 10 % of what is not rebuilt
    const rows = [...document.querySelectorAll('#resultBody tbody tr')].map((tr) => tr.textContent);
    expect(rows.some((r) => r?.includes('Missile Launcher'))).toBe(true);
  });

  it('adds an ACS fleet with the research of the selected one and switches the language', () => {
    (document.querySelector('[data-add-slot="att"]') as HTMLButtonElement).click();
    expect(document.querySelectorAll('#attTabs [data-slot]')).toHaveLength(2);
    expect((document.getElementById('r-att-109') as HTMLInputElement).value).toBe('10');
    (document.querySelector('#langSeg [data-lang="de"]') as HTMLButtonElement).click();
    expect(document.querySelector('#attTabs')?.textContent).toContain('A 2');
    expect(document.querySelector('#resultBody .balance')?.textContent).toContain('Verloren');
  });

  it('marks the result as outdated after a change', () => {
    const input = document.getElementById('u-att-203') as HTMLInputElement;
    input.value = '5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('staleNote')?.hidden).toBe(false);
  });

  it('takes the number of simulations as a number', () => {
    const runs = document.getElementById('runsIn') as HTMLInputElement;
    expect(runs.value).toBe('10');
    runs.value = '37';
    runs.dispatchEvent(new Event('input', { bubbles: true }));
    runs.value = '0';
    runs.dispatchEvent(new Event('input', { bubbles: true }));
    expect(runs.classList.contains('invalid')).toBe(true);
    runs.dispatchEvent(new Event('blur'));
    expect(runs.value).toBe('37');
  });

  it('shows the balance of both sides and switches who gets the debris', () => {
    const tables = () => [...document.querySelectorAll('#resultBody .balance')].map((x) => x.textContent ?? '');
    expect(tables()).toHaveLength(2);
    // the attacker wins: the debris goes to the attacker
    expect(tables()[0]).toContain('Trümmerfeld');
    expect(tables()[1]).not.toContain('Trümmerfeld');
    (document.querySelector('[data-debris-to="defender"]') as HTMLButtonElement).click();
    expect(tables()[1]).toContain('Trümmerfeld');
    expect(tables()[0]).not.toContain('Trümmerfeld');
    expect(document.querySelector('[data-debris-to="defender"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps independent simulations in tabs', async () => {
    const tabs = () => [...document.querySelectorAll('#calcTabs [data-tab]')];
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].textContent).toContain('1:110:8');
    // a new tab copies the current one, without its result
    (document.getElementById('addTab') as HTMLButtonElement).click();
    expect(tabs()).toHaveLength(2);
    expect((document.getElementById('u-att-207') as HTMLInputElement).value).toBe('100');
    expect(document.querySelector('#resultBody .hero')).toBeNull();
    const input = document.getElementById('u-att-207') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // back to the first tab: its own fleet and result
    (tabs()[0].querySelector('.ctab-main') as HTMLButtonElement).click();
    expect((document.getElementById('u-att-207') as HTMLInputElement).value).toBe('100');
    expect(document.querySelector('#resultBody .hero')).not.toBeNull();
    const stored = JSON.parse(localStorage.getItem('pr0bs.tabs.v1')!);
    expect(stored.tabs.map((x: { state: { attackers: { units: Record<string, number> }[] } }) => x.state.attackers[0].units[207])).toEqual([100, 7]);
  });

  it('pastes a spy report from the defender menu and lists the solar satellite after the ships', () => {
    (document.querySelector('[data-menu="defMenu"]') as HTMLButtonElement).click();
    expect((document.getElementById('defMenu') as HTMLElement).hidden).toBe(false);
    (document.querySelector('[data-menu-action="spy"]') as HTMLButtonElement).click();
    expect((document.getElementById('defMenu') as HTMLElement).hidden).toBe(true);
    expect((document.getElementById('spyDialog') as HTMLDialogElement).open).toBe(true);
    const area = document.getElementById('spyIn') as HTMLTextAreaElement;
    area.value = spyReport;
    area.dispatchEvent(new Event('input', { bubbles: true }));
    expect((document.getElementById('spyDialog') as HTMLDialogElement).open).toBe(false);
    expect((document.getElementById('u-def-405') as HTMLInputElement).value).toBe('30');
    expect((document.getElementById('res-metal') as HTMLInputElement).value).toBe('300.000');
    const ships = [...document.querySelectorAll('#defSlot .units')][0].querySelectorAll('input');
    expect(ships[ships.length - 1].id).toBe('u-def-212');
    // resetting (confirmed) clears the units, the target stays
    window.confirm = () => true;
    (document.querySelector('[data-menu="defMenu"]') as HTMLButtonElement).click();
    (document.querySelector('[data-menu-action="reset"][data-side="def"]') as HTMLButtonElement).click();
    expect((document.getElementById('u-def-405') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('targetIn') as HTMLInputElement).value).toBe('1:110:8');
  });

  it('removes a fleet with the × of its tab after confirming, and resets all attackers from the menu', () => {
    const attTabs = () => document.querySelectorAll('#attTabs [data-slot]').length;
    (document.querySelector('[data-add-slot="att"]') as HTMLButtonElement).click();
    const before = attTabs();
    window.confirm = () => false;
    (document.querySelector('#attTabs [data-remove-slot]') as HTMLButtonElement).click();
    expect(attTabs()).toBe(before);
    window.confirm = () => true;
    (document.querySelector('#attTabs [data-remove-slot]') as HTMLButtonElement).click();
    expect(attTabs()).toBe(before - 1);
    // the planet has no ×
    expect(document.querySelector('#defTabs [data-remove-slot][data-index="0"]')).toBeNull();
    // reset keeps the fleets and clears their ships, "remove all" leaves one empty fleet
    (document.querySelector('[data-add-slot="att"]') as HTMLButtonElement).click();
    (document.querySelector('[data-menu="attMenu"]') as HTMLButtonElement).click();
    (document.querySelector('[data-menu-action="reset"][data-side="att"]') as HTMLButtonElement).click();
    expect(attTabs()).toBe(before);
    expect((document.querySelector('#attTabs [data-slot="0"]') as HTMLButtonElement).closest('.slot-tab')?.classList.contains('has')).toBe(false);
    (document.querySelector('[data-menu="attMenu"]') as HTMLButtonElement).click();
    (document.querySelector('[data-menu-action="remove"][data-side="att"]') as HTMLButtonElement).click();
    expect(attTabs()).toBe(1);
    expect((document.getElementById('u-att-207') as HTMLInputElement).value).toBe('');
  });

  it('starts the simulation with Enter in a field and shows the win chances next to the button', async () => {
    const input = document.getElementById('u-att-204') as HTMLInputElement;
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('.run-row #outcome')?.textContent).toMatch(/%/);
  });

  it('takes the fleet names of a link and renames a fleet by double click', async () => {
    const named = cleanState({
      attackers: [{ units: { 204: 5 }, name: 'Neffez' }, { units: { 202: 2 }, name: 'Gast' }],
      defenders: [{ units: { 401: 3 }, name: 'Alpha' }],
      target: [2, 20, 4],
    });
    location.hash = '#' + encodeShare(shareFromState(named, {}));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById('attTabs')?.textContent).toContain('Neffez');
    expect(document.getElementById('attTabs')?.textContent).toContain('Gast');
    expect(document.getElementById('defTabs')?.textContent).toContain('Alpha (Planet)');
    expect(document.querySelector('#calcTabs .ctab.active .ctab-name')?.textContent).toBe('Alpha 2:20:4');
    const tab = document.querySelector('#attTabs [data-slot="1"]') as HTMLButtonElement;
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('#attTabs .slot-rename') as HTMLInputElement;
    input.value = 'Bob';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.getElementById('attTabs')?.textContent).toContain('Bob');
  });

  it('sends recyclers with the dialog, shows their flight and puts their fuel into the balance', async () => {
    (document.querySelector('[data-rec="att"]') as HTMLButtonElement).click();
    expect((document.getElementById('recDialog') as HTMLDialogElement).open).toBe(true);
    const set = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('rec-209', '10');
    set('recFrom', '2:20:9');
    set('rec-r-115', '10');
    const info = document.getElementById('recInfo')?.textContent ?? '';
    expect(info).toContain('200.000');
    expect(document.querySelector('[data-rec="att"] .rec-count')?.textContent).toContain('10');
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('#resultBody .balance')?.textContent).toContain('Recycler');
    expect(document.querySelector('#resultBody .hero')?.textContent).toContain('Runden');
    // target and resources share the first row of the planet
    expect(document.querySelector('#defSlot .target-row #res-metal')).not.toBeNull();
  });

  it('links the planet to the IPM calculator and leaves the rebuilt column out for attackers', () => {
    const defense = document.getElementById('u-def-401') as HTMLInputElement;
    defense.value = '25';
    defense.dispatchEvent(new Event('input', { bubbles: true }));
    const link = document.querySelector('[data-ipm]') as HTMLAnchorElement;
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    const hash = new URLSearchParams(link.href.split('#')[1]);
    expect(hash.get('d401')).toBe('25');
    expect(hash.get('tg')).toBe('2');
    const heads = [...document.querySelectorAll('#resultBody .balances')].at(-1)!.querySelectorAll('thead');
    expect(heads[0].textContent).not.toContain('Wiederaufgebaut');
    expect(heads[1].textContent).toContain('Wiederaufgebaut');
  });

  it('does not show the running state for quick simulations', () => {
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    expect((document.getElementById('runBtn') as HTMLButtonElement).hidden).toBe(false);
    expect((document.getElementById('progress') as HTMLElement).hidden).toBe(true);
  });

  it('gives holding fleets a start, speed and drives, with their flight in the result', async () => {
    (document.querySelector('[data-add-slot="def"]') as HTMLButtonElement).click();
    const set = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    expect(document.getElementById('r-def-115')).not.toBeNull();
    set('from-def', '2:21:1');
    set('r-def-115', '8');
    set('u-def-204', '40');
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    const flights = [...document.querySelectorAll('#resultBody table')].map((x) => x.textContent ?? '').find((x) => x.includes('D 2') || x.includes('V 2'));
    expect(flights).toBeTruthy();
    expect([...document.querySelectorAll('#resultBody .balance')][1].textContent).toContain('Treibstoff');
  });

  it('puts research and ships of both sides on the same rows', () => {
    const rows = (id: string) => [...document.getElementById(id)!.children].map((el) => (el.querySelector('[data-unit]') ? 'units' : el.querySelector('[data-tech="109"]') ? 'combat' : el.classList.contains('grid4') ? 'drives' : 'route'));
    (document.querySelector('#defTabs [data-slot="0"]') as HTMLButtonElement).click();
    const attacker = rows('attSlot');
    expect(attacker.slice(0, 4)).toEqual(['route', 'combat', 'drives', 'units']);
    expect(rows('defSlot').slice(0, 4)).toEqual(attacker.slice(0, 4));
    (document.querySelector('#defTabs [data-slot="1"]') as HTMLButtonElement).click();
    expect(rows('defSlot').slice(0, 4)).toEqual(attacker.slice(0, 4));
  });
});
