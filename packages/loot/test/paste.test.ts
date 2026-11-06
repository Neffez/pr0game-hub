import { readFileSync } from 'node:fs';
import { DEFAULT_UNITS } from '@pr0hub/core/units';
import { distance, fleetConsumption, flightDuration, slowestShip, type Universe } from '@pr0hub/flight';
import { describe, expect, it } from 'vitest';
import {
  applyDerived, applyPaste, autoPath, cleanSync, deriveFromSync, emptyState, emptySync, localEpoch, lootShares, pruneSync, setManual,
} from '../src/index.js';

const report = readFileSync(new URL('../../parser/test/fixtures/combat-report-de.txt', import.meta.url), 'utf8');
const market = readFileSync(new URL('../../parser/test/fixtures/marketplace-de.txt', import.meta.url), 'utf8');

// battle at [3:195:5] on 24 Oct 2026 13:04:03; Rudolf flies two fleets from [3:200:1], CVXII from [3:26:12] and [3:160:5]
const returns = [
  'Flottenhauptquartier', 'Flottenrückkehr', '24. Okt 2026, 13:48:06',
  'Eine deiner Flotten kehrt vom Angriff beim Planeten Rees [3:195:5] zurück zu Ra [3:200:1]. Sie haben 0 Metall, 408.133 Kristall und 209.670 Deuterium erbeutet',
  'Flottenhauptquartier', 'Flottenrückkehr', '24. Okt 2026, 13:42:23',
  'Eine deiner Flotten kehrt vom Angriff beim Planeten Rees [3:195:5] zurück zu Ra [3:200:1]. Sie haben 0 Metall, 195.136 Kristall und 100.247 Deuterium erbeutet',
  'Flottenhauptquartier', 'Raketeneinschlag', '24. Okt 2026, 12:50:00',
  'Interplanetarraketen (25) von Ra [3:200:1] sind auf dem Planeten Rees [3:195:5] eingeschlagen',
  '3 Raketen wurden abgefangen.', 'Raketenwerfer (- 120)',
  'Flottenhauptquartier', 'Raketeneinschlag', '20. Okt 2026, 12:50:00',
  'Interplanetarraketen (9) von Ra [3:200:1] sind auf dem Planeten Rees [3:195:5] eingeschlagen',
  '3 Raketen wurden abgefangen.', 'Raketenwerfer (- 1)',
].join('\n');

const recycling = [
  'Flottenhauptquartier', 'Recyclingbericht', '24. Okt 2026, 13:30:00',
  'Deine Recycler haben an den Koordinaten [3:195:5] 40.000 Metall und 20.000 Kristall von insgesamt 142.823.000 Metall und 68.450.500 Kristall gesammelt.',
  'Flottenhauptquartier', 'Flottenrückkehr', '24. Okt 2026, 14:10:00',
  'Eine deiner Recycler-Flotten kehrt nach Ra [3:200:1] mit 40.000 Metall, 20.000 Kristall und 0 Deuterium zurück.',
  'Flottenhauptquartier', 'Recyclingbericht', '28. Okt 2026, 13:30:00',
  'Deine Recycler haben an den Koordinaten [3:195:5] 1.000 Metall und 2.000 Kristall von insgesamt 5.000 Metall und 5.000 Kristall gesammelt.',
].join('\n');

const empire = ['Name\tTotal\tRa', 'Koordinaten\t-\t[3:200:1]', 'Verbrennungstriebwerk\t17', 'Impulstriebwerk\t14', 'Hyperraumantrieb\t12'].join('\n');

const U: Universe = {
  galaxies: 9, systems: 400, circularGalaxies: false, circularSystems: false, galaxyDistanceFactor: 20000, systemDistanceFactor: 95,
  systemDistance: 2700, planetDistanceFactor: 5, planetDistance: 1000, fleetSpeed: 2500,
};
const at = (s: string) => localEpoch(s)!;

function settled() {
  const state = emptyState();
  const sync = emptySync();
  const r = applyPaste(state, sync, report);
  return { state, sync, r };
}

describe('pasted pages into a settlement', () => {
  it('takes a battle report with the start planet of each fleet and replaces it when pasted again', () => {
    const { state, sync, r } = settled();
    expect(r).toMatchObject({ kind: 'report', battle: 0, replaced: false });
    expect(state.participants.map((p) => p.name)).toEqual(['CVXII', 'Rudolf']);
    const b = sync.battles[state.battles[0].key!];
    expect(b.target).toBe('3:195:5');
    expect(b.fleets.map((f) => [f.participant, f.from])).toEqual([['p1', '3:26:12'], ['p2', '3:200:1'], ['p1', '3:160:5'], ['p2', '3:200:1']]);
    expect(sync.planets).toEqual({ p1: ['3:26:12', '3:160:5'], p2: ['3:200:1'] });
    expect(applyPaste(state, sync, report)).toMatchObject({ replaced: true, battle: 0 });
    expect(state.battles).toHaveLength(1);
  });

  it('fills the blank battle row first', () => {
    const state = emptyState();
    state.battles.push({ time: null, loot: { m: 0, k: 0, d: 0 }, fleets: [] });
    applyPaste(state, emptySync(), report);
    expect(state.battles).toHaveLength(1);
    expect(state.battles[0].key).toBe('b1');
  });

  it('assigns returns and missiles by the home planet; loot per fleet, exact flight deuterium and missiles follow', () => {
    const { state, sync } = settled();
    const r = applyPaste(state, sync, returns);
    expect(r).toMatchObject({ kind: 'messages', unassigned: 0, added: { returns: 2, missiles: 2 } });
    applyPaste(state, sync, empire);
    expect(sync.drives.p2).toEqual({ combustion: 17, impulse: 14, hyperspace: 12, fuelEfficiency: 0 });

    const d = deriveFromSync(state, sync, U, DEFAULT_UNITS);
    const key = state.battles[0].key!;
    expect(d.loot[key]).toEqual({ p2: { m: 0, k: 603269, d: 309917 } });
    expect(d.missiles).toEqual({ p2: 25 }); // the one four days before does not count
    expect(d.missingDrives).toEqual(['p1']);
    // the two fleets of Rudolf: flight time = return - battle, the earlier return for the first fleet
    const fleets = sync.battles[key].fleets.filter((f) => f.participant === 'p2');
    const drives = sync.drives.p2;
    const dist = distance(U, [3, 200, 1], [3, 195, 5]);
    const battle = at('2026-10-24 13:04:03');
    const expected =
      fleetConsumption(U, fleets[0].ships, at('2026-10-24 13:42:23') - battle, dist, drives, 1, DEFAULT_UNITS.drives) +
      fleetConsumption(U, fleets[1].ships, at('2026-10-24 13:48:06') - battle, dist, drives, 1, DEFAULT_UNITS.drives);
    expect(d.flightDeut.p2).toEqual({ deut: expected, exact: true });

    const set = applyDerived(state, sync, d);
    expect(set.has(autoPath.loot(key, 'p2'))).toBe(true);
    expect(state.participants[1]).toMatchObject({ flightDeut: expected, missiles: 25 });
    expect(lootShares(state.battles[0]).get('p2')).toEqual({ m: 0, k: 603269, d: 309917 });
  });

  it('uses fleet returns only with one battle at the target (waves cannot be told apart)', () => {
    const { state, sync } = settled();
    applyPaste(state, sync, report.replace('24. Okt 2026, 13:04:03', '24. Okt 2026, 13:20:00'));
    expect(state.battles).toHaveLength(2);
    applyPaste(state, sync, returns);
    applyPaste(state, sync, empire);
    const d = deriveFromSync(state, sync, U, DEFAULT_UNITS);
    expect(d.loot).toEqual({});
    expect(d.flightDeut.p2.exact).toBe(false);
  });

  it('estimates the flight at 100 % speed without a return', () => {
    const { state, sync } = settled();
    applyPaste(state, sync, empire, { owner: { id: 'p1' } });
    const d = deriveFromSync(state, sync, U, DEFAULT_UNITS);
    const f = sync.battles[state.battles[0].key!].fleets[0];
    const dist = distance(U, [3, 26, 12], [3, 195, 5]);
    const slow = slowestShip(f.ships, sync.drives.p1, DEFAULT_UNITS.drives)!;
    const first = fleetConsumption(U, f.ships, flightDuration(U, dist, slow.speed, 100), dist, sync.drives.p1, 1, DEFAULT_UNITS.drives);
    expect(d.flightDeut.p1.exact).toBe(false);
    expect(d.flightDeut.p1.deut).toBeGreaterThan(first);
  });

  it('drops the loot per fleet when it is more than the battle loot', () => {
    const { state, sync } = settled();
    applyPaste(state, sync, returns.replace('408.133 Kristall', '9.408.133 Kristall'));
    expect(deriveFromSync(state, sync, U, DEFAULT_UNITS).loot).toEqual({});
  });

  it('takes recycling at the target within 24 hours, finds the recycler by the return and computes the recycler deuterium', () => {
    const { state, sync } = settled();
    applyPaste(state, sync, empire);
    const r = applyPaste(state, sync, recycling);
    expect(r).toMatchObject({ added: { recycling: 1, recycleReturns: 1 }, outside: 1, unassigned: 0 });
    expect(state.recycling).toEqual([
      { key: expect.any(String), by: 'p2', m: 40000, k: 20000, time: at('2026-10-24 13:30:00'), field: { m: 142823000, k: 68450500 } },
    ]);
    expect(applyPaste(state, sync, recycling).added.recycling).toBe(0); // no duplicates
    const d = deriveFromSync(state, sync, U, DEFAULT_UNITS);
    const dist = distance(U, [3, 200, 1], [3, 195, 5]);
    expect(d.recDeut.p2).toBe(fleetConsumption(U, { 209: 3 }, 40 * 60, dist, sync.drives.p2, 1, DEFAULT_UNITS.drives));
  });

  it('assigns everything to the chosen person or a new helper', () => {
    const { state, sync } = settled();
    const r = applyPaste(state, sync, recycling.split('Flottenhauptquartier\nFlottenrückkehr')[0], { owner: { helper: 'Recy' } });
    expect(r.added.recycling).toBe(1);
    expect(state.helpers).toEqual([{ id: 'h3', name: 'Recy', keepPct: 20, recDeut: 0 }]);
    expect(state.recycling[0].by).toBe('h3');
    // without a recycler return and in auto mode nobody is known
    const other = settled();
    expect(applyPaste(other.state, other.sync, recycling.split('Flottenhauptquartier\nFlottenrückkehr')[0])).toMatchObject({ unassigned: 1 });
    expect(other.state.recycling).toEqual([]);
  });

  it('keeps values typed by hand and takes market rates', () => {
    const { state, sync } = settled();
    applyPaste(state, sync, returns);
    setManual(sync, autoPath.person('p2', 'missiles'), true);
    state.participants[1].missiles = 3;
    applyDerived(state, sync, deriveFromSync(state, sync, U, DEFAULT_UNITS));
    expect(state.participants[1].missiles).toBe(3);

    const m = applyPaste(state, sync, market);
    expect(m).toMatchObject({ kind: 'marketplace', added: { rates: true } });
    expect(state.settings.rates).toEqual({ m: 4.06, k: 1.44, d: 1 });
  });

  it('cleans stored data and drops facts of removed people', () => {
    const { state, sync } = settled();
    applyPaste(state, sync, returns);
    expect(cleanSync(JSON.parse(JSON.stringify(sync)))).toEqual(sync);
    expect(cleanSync('x')).toEqual(emptySync());
    state.participants.splice(1, 1);
    state.battles[0].fleets = state.battles[0].fleets.filter((f) => f.participant !== 'p2');
    pruneSync(state, sync);
    expect(sync.planets.p2).toBeUndefined();
    expect(sync.battles[state.battles[0].key!].fleets.every((f) => f.participant === 'p1')).toBe(true);
  });
  it('gives computed values back to 0 when their source is gone and forgets marks of removed battles', () => {
    const { state, sync } = settled();
    applyPaste(state, sync, returns);
    applyPaste(state, sync, empire);
    const key = state.battles[0].key!;
    applyDerived(state, sync, deriveFromSync(state, sync, U, DEFAULT_UNITS));
    expect(state.participants[1].flightDeut).toBeGreaterThan(0);
    expect(state.participants[1].missiles).toBe(25);
    setManual(sync, autoPath.loot(key, 'p1'), true);
    state.battles.splice(0, 1);
    pruneSync(state, sync);
    expect(sync.manual).toEqual([]);
    applyDerived(state, sync, deriveFromSync(state, sync, U, DEFAULT_UNITS));
    expect(state.participants[1].flightDeut).toBe(0);
    expect(state.participants[1].missiles).toBe(0);
  });
});
