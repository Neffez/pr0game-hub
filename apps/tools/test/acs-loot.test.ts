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
    const area = document.querySelector<HTMLTextAreaElement>('textarea[data-paste-recycling]')!;
    const by = document.querySelector<HTMLSelectElement>('select[data-recycle-by]')!;
    by.value = 'b';
    by.dispatchEvent(new Event('change', { bubbles: true }));
    area.value = recycleReports;
    area.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-act="applyRecycling"]')!.click();
    const rows = [...document.querySelectorAll('#recycling tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((r) => r.querySelector<HTMLSelectElement>('select')!.value)).toEqual(['b', 'b']);
    expect(document.querySelector<HTMLTextAreaElement>('textarea[data-paste-recycling]')!.value).toBe('');
    // what is left in the field by the latest report
    expect(document.getElementById('debrisSummary')?.textContent).toMatch(/Left in the field: 4,000 Metal · 4,000 Crystal/);
  });
});
