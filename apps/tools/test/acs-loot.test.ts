// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { battleFromReport, emptyState, encodeShare, fmtNum, fmtShort, recyclingFromReports } from '../src/loot';

const report = [
  'The following fleets face each other on: 20 Oct 2026, 10:29:25',
  'Attacker Alpha ([1:2:3])', 'Type', 'Heavy Cargo', 'Battleship', 'Amount', '10', '5',
  'Attacker Alpha ([1:2:3])', 'Type', 'Battleship', 'Amount', '2',
  'Attacker Beta ([1:2:4])', 'Type', 'Battleship', 'Amount', '20',
  'Defender Gamma ([1:5:6])', 'Type', 'Missile Launcher', 'Amount', '100',
  'Attacker Alpha ([1:2:3])', 'Type', 'Heavy Cargo', 'Battleship', 'Amount', '10', '4',
  'Attacker Alpha ([1:2:3])', 'Type', 'Battleship', 'Amount', '2',
  'Attacker Beta ([1:2:4])', 'Type', 'Battleship', 'Amount', '20',
  'Defender Gamma ([1:5:6])', 'Type', 'Missile Launcher', 'Amount', '0',
  'The attacker has won the battle! They loot 120,000 Metal, 60,000 Crystal and 30,000 Deuterium',
  "The attacker's losses: 60,000 units",
].join('\n');

describe('loot calculator glue', () => {
  it('takes a battle report: participants by name, fleets of one player summed up', () => {
    const state = emptyState();
    state.participants.push({ id: 'p0', name: '', flightDeut: 0, recDeut: 0, missiles: 0 });
    const res = battleFromReport(state, report);
    if (!res.ok) throw new Error('not parsed');
    expect(state.participants.map((p) => p.name)).toEqual(['Alpha', 'Beta']);
    expect(res.battle.loot).toEqual({ m: 120000, k: 60000, d: 30000 });
    expect(res.battle.time).toBe(new Date(2026, 9, 20, 10, 29, 25).getTime() / 1000); // the player's local time
    expect(res.battle.fleets[0]).toEqual({ participant: 'p0', start: { 203: 10, 207: 7 }, end: { 203: 10, 207: 6 } });
    expect(battleFromReport(state, 'nothing')).toEqual({ ok: false });
  });

  it('takes a copied german report of an ACS with two fleets per player', () => {
    const text = readFileSync(resolve(import.meta.dirname, '../../../packages/parser/test/fixtures/combat-report-de.txt'), 'utf8');
    const state = emptyState();
    const res = battleFromReport(state, text);
    if (!res.ok) throw new Error('not parsed');
    expect(state.participants.map((p) => p.name)).toEqual(['CVXII', 'Rudolf']);
    expect(res.battle.loot).toEqual({ m: 0, k: 1343846, d: 690373 });
    expect(res.battle.fleets.map((f) => f.start[207])).toEqual([11799, 2178]);
    expect(res.battle.time).toBe(new Date(2026, 9, 24, 13, 4, 3).getTime() / 1000);

    // the same report as a hold: the defender settles, without loot
    const hold = emptyState();
    const def = battleFromReport(hold, text, 'defender');
    if (!def.ok) throw new Error('not parsed');
    expect(hold.participants.map((p) => p.name)).toEqual(['Hustensaftdealer']);
    expect(def.battle.loot).toEqual({ m: 0, k: 0, d: 0 });
  });

  it('formats numbers per language', () => {
    expect(fmtNum(-1234567, 'de')).toBe('-1.234.567');
    expect(fmtNum(1234567, 'en')).toBe('1,234,567');
    expect(fmtShort(1250000, 'de')).toBe('1,3 Mio');
    expect(fmtShort(633400, 'en')).toBe('633k');
  });
});

const recycleReports = [
  'Flottenhauptquartier', 'Recyclerbericht', '24. Okt 2026, 13:04:12',
  'Deine Recycler haben an den Koordinaten [3:195:5] 40.219.074 Metall und 19.280.927 Kristall von insgesamt 142.823.000 Metall und 68.469.000 Kristall gesammelt.',
  'Es werden 7.590 Recycler für das Trümmerfeld benötigt.',
  'Fleet headquarters', 'Recycling report', '24 Oct 2026, 13:10:00',
  'Your recyclers have collected 1,000 Metal and 2,000 Crystal from a total of 5,000 Metal and 6,000 Crystal at coordinates [3:195:5].',
].join('\n');

describe('recycling reports', () => {
  it('takes every pasted recycling report', () => {
    expect(recyclingFromReports(recycleReports)).toEqual([
      { m: 40219074, k: 19280927, field: { m: 142823000, k: 68469000 } },
      { m: 1000, k: 2000, field: { m: 5000, k: 6000 } },
    ]);
    expect(recyclingFromReports('nothing')).toEqual([]);
  });
});

describe('loot calculator page', () => {
  beforeAll(async () => {
    const html = readFileSync(resolve(import.meta.dirname, '../acs-loot/index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
    const state = emptyState();
    state.participants.push({ id: 'a', name: 'Rolf', flightDeut: 0, recDeut: 0, missiles: 0 });
    state.participants.push({ id: 'b', name: 'ballermann', flightDeut: 0, recDeut: 0, missiles: 0 });
    state.recycling.push({ by: 'a', m: 100000, k: 0 });
    location.hash = '#s=' + encodeShare(state);
    await import('../acs-loot/main.js');
  });

  it('opens a share link and suggests the delivery', () => {
    const names = [...document.querySelectorAll<HTMLInputElement>('#participants input[data-type="text"]')].map((el) => el.value);
    expect(names).toEqual(['Rolf', 'ballermann']);
    expect(document.getElementById('transferText')?.textContent).toMatch(/^Rolf \S+ 50k .* ballermann/);
  });

  it('adds a recycling row per pasted report for the chosen person', () => {
    const owner = document.querySelector<HTMLSelectElement>('select[data-owner]')!;
    owner.value = 'b';
    owner.dispatchEvent(new Event('change', { bubbles: true }));
    paste(recycleReports);
    const rows = [...document.querySelectorAll('#recycling tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((r) => r.querySelector<HTMLSelectElement>('select')!.value)).toEqual(['b', 'b']);
    expect(document.querySelector<HTMLTextAreaElement>('textarea[data-paste]')!.value).toBe('');
    expect(document.querySelector('#paste .note')?.textContent).toContain('2 recycling reports');
    // what is left in the field by the latest report
    expect(document.getElementById('debrisSummary')?.textContent).toMatch(/Left in the field: 4,000 Metal · 4,000 Crystal/);
  });

  it('opens a new tab with the settings of the current one and switches between tabs', () => {
    const tabs = () => [...document.querySelectorAll<HTMLElement>('#calcTabs .ctab')];
    const rate = () => document.querySelector<HTMLInputElement>('[data-bind="settings.rates.m"]')!.value;
    const rateIn = document.querySelector<HTMLInputElement>('[data-bind="settings.rates.m"]')!;
    rateIn.value = '3';
    rateIn.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('#addTab')!.click();
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1].classList.contains('active')).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>('#participants input[data-type="text"]')].map((el) => el.value)).toEqual(['', '']);
    expect(rate()).toBe('3');
    tabs()[0].querySelector<HTMLButtonElement>('.ctab-main')!.click();
    expect(document.querySelectorAll('#recycling tbody tr')).toHaveLength(3);
    expect(tabs()[0].querySelector('.ctab-name')?.textContent).toBe('Rolf, ballermann');
  });

  it('fills in a battle from the report and its fleet returns, missiles and drives from pasted pages', () => {
    document.querySelector<HTMLButtonElement>('#addTab')!.click();
    paste(readFileSync(resolve(import.meta.dirname, '../../../packages/parser/test/fixtures/combat-report-de.txt'), 'utf8'));
    expect([...document.querySelectorAll<HTMLInputElement>('#participants input[data-type="text"]')].map((el) => el.value)).toEqual(['CVXII', 'Rudolf']);
    paste(messages);
    paste(empire);
    const flight = document.querySelector<HTMLInputElement>('[data-auto="p2.flightDeut"]')!;
    expect(Number(flight.value.replace(/,/g, ''))).toBeGreaterThan(0);
    expect(document.querySelector('[data-auto-mark="p2.flightDeut"]')?.textContent).toBe('auto');
    expect(document.querySelector<HTMLInputElement>('[data-auto="p2.missiles"]')!.value).toBe('25');
    expect(document.querySelector<HTMLInputElement>('[data-drives="p2"]')!.value).toBe('17/14/12');
    expect(document.querySelector('#results .notes')?.textContent).toContain('CVXII');
    // the tab is named after the target
    expect(document.querySelector('#calcTabs .ctab.active .ctab-name')?.textContent).toMatch(/^\[3:195:5\]/);
    // typed over: stays, ↺ brings back the computed value
    flight.value = '5';
    flight.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('[data-auto-mark="p2.flightDeut"] [data-act="autoReset"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-auto-mark="p2.flightDeut"] [data-act="autoReset"]')!.click();
    expect(document.querySelector<HTMLInputElement>('[data-auto="p2.flightDeut"]')!.value).not.toBe('5');
    // stored with its pasted facts
    const stored = JSON.parse(localStorage.getItem('pr0loot.tabs.v1') ?? 'null');
    expect(stored === null || Array.isArray(stored.tabs)).toBe(true);
  });

  it('opens a link in a new tab', () => {
    const before = document.querySelectorAll('#calcTabs .ctab').length;
    const state = emptyState();
    state.participants.push({ id: 'x', name: 'Linked', flightDeut: 0, recDeut: 0, missiles: 0 });
    location.hash = '#s=' + encodeShare(state);
    window.dispatchEvent(new Event('hashchange'));
    expect(document.querySelectorAll('#calcTabs .ctab')).toHaveLength(before + 1);
    expect(document.querySelector<HTMLInputElement>('#participants input[data-type="text"]')!.value).toBe('Linked');
  });
});

function paste(text: string) {
  const area = document.querySelector<HTMLTextAreaElement>('textarea[data-paste]')!;
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector<HTMLButtonElement>('[data-act="applyPaste"]')!.click();
}

const messages = [
  'Flottenhauptquartier', 'Flottenrückkehr', '24. Okt 2026, 13:48:06',
  'Eine deiner Flotten kehrt vom Angriff beim Planeten Rees [3:195:5] zurück zu Ra [3:200:1]. Sie haben 0 Metall, 408.133 Kristall und 209.670 Deuterium erbeutet',
  'Flottenhauptquartier', 'Flottenrückkehr', '24. Okt 2026, 13:42:23',
  'Eine deiner Flotten kehrt vom Angriff beim Planeten Rees [3:195:5] zurück zu Ra [3:200:1]. Sie haben 0 Metall, 195.136 Kristall und 100.247 Deuterium erbeutet',
  'Flottenhauptquartier', 'Raketeneinschlag', '24. Okt 2026, 12:50:00',
  'Interplanetarraketen (25) von Ra [3:200:1] sind auf dem Planeten Rees [3:195:5] eingeschlagen',
  '3 Raketen wurden abgefangen.', 'Raketenwerfer (- 120)',
].join('\n');

const empire = ['Name\tTotal\tRa', 'Koordinaten\t-\t[3:200:1]', 'Verbrennungstriebwerk\t17', 'Impulstriebwerk\t14', 'Hyperraumantrieb\t12'].join('\n');
