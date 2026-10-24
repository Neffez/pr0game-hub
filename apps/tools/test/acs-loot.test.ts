// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { battleFromReport, emptyState, encodeShare, fmtNum, fmtShort } from '../src/loot';

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
  });

  it('formats numbers per language', () => {
    expect(fmtNum(-1234567, 'de')).toBe('-1.234.567');
    expect(fmtNum(1234567, 'en')).toBe('1,234,567');
    expect(fmtShort(1250000, 'de')).toBe('1,3 Mio');
    expect(fmtShort(633400, 'en')).toBe('633k');
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
});
