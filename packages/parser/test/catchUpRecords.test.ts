import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildingCost, catchUpAt, catchUpFromCosts, recordHints, recordLevel, type CostPage } from '../src/buildings.js';
import { parsePage } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('catch-up bonus near record levels (getCatchUpFactorForElement)', () => {
  it('gives the full bonus 3 levels below the record, two thirds at 2, one third at 1, none at or above it', () => {
    expect(catchUpAt(12, 17, 20)).toBe(12);
    expect(catchUpAt(12, 18, 20)).toBeCloseTo(8, 10);
    expect(catchUpAt(12, 19, 20)).toBeCloseTo(4, 10);
    expect(catchUpAt(12, 20, 20)).toBe(0);
    expect(catchUpAt(12, 25, 20)).toBe(0);
    // no record known: the full bonus; no bonus at all: nothing to reduce
    expect(catchUpAt(12, 20, null)).toBe(12);
    expect(catchUpAt(0, 20, 20)).toBe(0);
  });

  it('prices a level with the bonus its distance to the record leaves', () => {
    const full = buildingCost(1, 19, 30);
    const third = buildingCost(1, 19, 30, 20);
    const none = buildingCost(1, 19);
    expect(third[901]).toBeCloseTo(none[901] * 0.9, 6);
    expect(full[901]).toBeCloseTo(none[901] * 0.7, 6);
    expect(buildingCost(1, 20, 30, 20)).toEqual(buildingCost(1, 20));
  });

  // a page as the game shows it: bonus 12.3456 %, metal mine 1 below its record, crystal mine 2 below, solar plant
  // above it, deuterium synthesizer and the storages far below
  const bonus = 12.3456;
  const records: Record<number, number> = { 1: 20, 2: 18, 4: 10, 3: 40, 22: 30, 23: 30 };
  const levels: Record<number, number> = { 1: 18, 2: 15, 4: 10, 3: 20, 22: 9, 23: 8 };
  const page = (shown: boolean): CostPage => ({
    buildings: Object.entries(levels).map(([key, level]) => {
      const id = Number(key);
      const cost = buildingCost(id, level + 1, bonus, records[id]);
      const own = catchUpAt(bonus, level + 1, records[id]);
      return {
        id, level, cost: Object.fromEntries(Object.entries(cost).map(([r, x]) => [r, Math.round(x)])),
        ...(shown && own !== bonus ? { catchUp: Math.round(own * 100) / 100 } : {}),
      };
    }),
    queue: [],
  });

  it('finds the exact general bonus behind costs of which some are near a record', () => {
    expect(catchUpFromCosts(page(true))).toBeCloseTo(bonus, 3);
    // the game shows the own bonus only when the element can be built now: the costs alone tell as well
    expect(catchUpFromCosts(page(false))).toBeCloseTo(bonus, 3);
  });

  it('reads the record levels from the share of the bonus in each cost', () => {
    for (const shown of [true, false]) {
      const p = page(shown);
      const hints = recordHints(p, catchUpFromCosts(p), true).sort((a, b) => a.id - b.id);
      expect(hints).toEqual([
        { id: 1, min: 20, max: 20 },
        { id: 2, min: 18, max: 18 },
        { id: 3, min: 24, max: null },
        { id: 4, min: null, max: 11 },
        { id: 22, min: 13, max: null },
        { id: 23, min: 12, max: null },
      ]);
    }
    // with the rounded bonus of the page header as well
    expect(recordHints(page(true), 12.35).find((h) => h.id === 1)).toEqual({ id: 1, min: 20, max: 20 });
    expect(recordHints(page(true), null)).toEqual([]);
  });

  it('reckons with an upper bound until a lower bound above it shows the record grew', () => {
    expect(recordLevel({ min: 20, max: 20 })).toBe(20);
    expect(recordLevel({ min: null, max: 11 })).toBe(11);
    expect(recordLevel({ min: 24, max: null })).toBeNull();
    expect(recordLevel({ min: 22, max: 20 })).toBeNull();
  });
});

describe('own catch-up bonus of an element on the buildings page', () => {
  it('reads "Bonus: x %" below the cost', () => {
    const html = fixture('buildings.html').replace(
      '<b><span class="colorPositive">19.476</span></b>',
      '<b><span class="colorPositive">19.476</span></b>\n          <span class="colorNeutral tooltip" data-tooltip-content="Reduzierter Bonus wegen Rekordstufe"><br>Bonus: 4,17 %</span>',
    );
    const rec = parsePage({ html }).records[0];
    if (rec.kind !== 'buildings') throw new Error('expected buildings');
    expect(rec.buildings.find((b) => b.id === 1)).toMatchObject({ cost: { 901: 77907, 902: 19476 }, catchUp: 4.17 });
    expect(rec.buildings.find((b) => b.id === 2)!.catchUp).toBeUndefined();
  });
});

describe('records page', () => {
  it('parses the record level of every building and research', () => {
    const res = parsePage({ html: fixture('records-template.html') });
    expect(res.pageType).toBe('records');
    expect(res.records).toEqual([{ kind: 'records', pageTime: '2026-11-28 12:30:00', levels: { 1: 32, 15: 5, 41: 0, 108: 21 } }]);
  });

  it('knows the elements by name in a copy without the info links', () => {
    const html = fixture('records-template.html').replace(/ onclick='return Dialog\.info\(\d+\)'/g, '');
    const rec = parsePage({ html }).records[0];
    expect(rec).toMatchObject({ kind: 'records', levels: { 1: 32, 15: 5, 41: 0, 108: 21 } });
  });
});
