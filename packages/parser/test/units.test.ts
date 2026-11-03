import { CAPACITY, SHIPS as DRIVES } from '@pr0hub/flight';
import { describe, expect, it } from 'vitest';
import { buildingCost, requirementsOf, shipsOf, type BuildPlanet } from '../src/buildings.js';
import costs from '../src/data/costs.json' with { type: 'json' };
import ships from '../src/data/ships.json' with { type: 'json' };
import { costOf, idByName, registerUnitNames, techName } from '../src/tech.js';
import { activeUnits, DEFAULT_UNITS, emptyUnit, setActiveUnits, unitCatalog, unitPatch, validateUnits, withUnits } from '../src/units.js';

describe('unit catalog', () => {
  it('keeps the values the hub had as defaults', () => {
    expect(DEFAULT_UNITS.ids).toEqual(Object.keys(ships).map(Number));
    for (const [key, meta] of Object.entries(ships)) {
      const u = DEFAULT_UNITS.units[key];
      expect(u.req).toEqual(meta.req);
      expect(u.one).toBe(meta.one);
      expect(u.cost).toEqual((costs as Record<string, number[]>)[key].slice(0, 3));
    }
    expect(DEFAULT_UNITS.capacity).toEqual(CAPACITY);
    expect(DEFAULT_UNITS.drives).toEqual(DRIVES);
    expect(DEFAULT_UNITS.units[214].rapidfire[225]).toBe(140);
    expect(DEFAULT_UNITS.units[222]).toMatchObject({ attack: 620, shield: 100, name: { de: 'Schwerer Kreuzer', en: 'Heavy Cruiser' }, short: { de: 'HXer' } });
    expect(DEFAULT_UNITS.ships).toContain(212);
    expect(DEFAULT_UNITS.defense).toEqual([401, 402, 403, 404, 405, 406, 407, 408, 502, 503]);
  });

  it('applies the changes of a universe: fields, hidden and new units', () => {
    const c = unitCatalog({
      227: { req: { 21: 6, 110: 6, 117: 6 } },
      231: { hidden: true },
      233: { name: { de: 'Neuer Jäger', en: 'New Fighter' }, cost: [1000, 500, 0], capacity: 100, drives: { speed: [0, 0, 9000], tech: [0, 0, 1], consumption: [0, 0, 10] } },
    });
    expect(c.units[227].req).toEqual({ 21: 6, 110: 6, 117: 6 });
    expect(c.units[227].attack).toBe(1);
    expect(c.units[231]).toBeUndefined();
    expect(c.ships).toContain(233);
    expect(c.capacity[233]).toBe(100);
    expect(c.drives[233].speed[2]).toBe(9000);
    expect(c.units[233].short).toEqual({ de: '#233', en: '#233' });
    expect(unitCatalog({ 231: { hidden: true } })).toBe(unitCatalog({ 231: { hidden: true } }));
    expect(Object.isFrozen(c.units[227].req)).toBe(true);
  });

  it('feeds costs, requirements and the ships tab from the active catalog', () => {
    const c = unitCatalog({ 227: { req: { 21: 6 } }, 202: { cost: [1, 2, 3] } });
    expect(requirementsOf(227, {}, {})).toHaveLength(3);
    withUnits(c, () => {
      expect(requirementsOf(227, {}, {})).toEqual([{ id: 21, need: 6, own: 0 }]);
      expect(buildingCost(202, 1)).toEqual({ 901: 1, 902: 2, 903: 3 });
    });
    expect(activeUnits()).toBe(DEFAULT_UNITS);
    expect(costOf(202)).toEqual([2000, 2000, 0, 1]);
    expect(costOf(1)).toEqual([60, 15, 0, 1.5]);
    const p: BuildPlanet = { values: { 21: 6 }, queue: [], resources: {}, perHour: {}, time: 0 } as never;
    const tab = shipsOf(p, { research: {}, now: 0, units: unitCatalog({ 231: { hidden: true } }) });
    expect(tab.some((s) => s.id === 231)).toBe(false);
    expect(shipsOf(p, { research: {}, now: 0, units: c }).find((s) => s.id === 227)?.state).not.toBe('requirements');
  });

  it('names: the active catalog, registered universe names for the parsers', () => {
    const c = unitCatalog({ 233: { name: { de: 'Sternenbrecher', en: 'Star Breaker' }, cost: [1, 1, 1] } });
    expect(idByName('Sternenbrecher')).toBeNull();
    registerUnitNames(c);
    expect(idByName('star breaker')).toBe(233);
    expect(techName(233, 'en')).toBe('Star Breaker');
    setActiveUnits(unitCatalog({ 202: { name: { de: 'KT', en: 'SC' } } }));
    expect(techName(202, 'de')).toBe('KT');
    setActiveUnits(null);
    expect(techName(202, 'de')).toBe('Kleiner Transporter');
  });

  it('validates stored overrides and diffs a form against its default', () => {
    expect(validateUnits({ 227: { req: { 21: 8 } }, 231: { hidden: true } })).toBeNull();
    expect(validateUnits({ 100: { hidden: true } })).toBe('100');
    expect(validateUnits({ 227: { cost: [1, 2] } })).toBe('227.cost');
    expect(validateUnits({ 227: { req: { 300: 1 } } })).toBe('227.req');
    expect(validateUnits({ 227: { rapidfire: { 1: 2 } } })).toBe('227.rapidfire');
    expect(validateUnits({ 227: { evil: 1 } })).toBe('227.evil');
    expect(validateUnits({ 233: { attack: 5 } })).toBe('233.name');
    expect(validateUnits({ 233: { name: { de: 'X', en: 'X' }, cost: [1, 0, 0], drives: null } })).toBeNull();
    expect(validateUnits([])).toBe('');
    const base = DEFAULT_UNITS.units[227];
    expect(unitPatch({ ...base, req: { 21: 6 } }, base)).toEqual({ req: { 21: 6 } });
    expect(unitPatch(base, base)).toEqual({});
  });
});

describe('unit catalog input', () => {
  it('does not freeze or share the overrides it was built from', () => {
    const overrides = { 233: { name: { de: 'A', en: 'A' }, cost: [1, 1, 1] as [number, number, number], drives: { speed: [0, 0, 1] as [number, number, number], tech: [0, 0, 1] as [number, number, number], consumption: [0, 0, 1] as [number, number, number] } } };
    const c = unitCatalog(overrides);
    expect(Object.isFrozen(overrides[233].drives)).toBe(false);
    expect(c.units[233].drives).not.toBe(overrides[233].drives);
  });
});

describe('known units', () => {
  it('start a new unit of a known id with its values, not in the defaults', () => {
    expect(DEFAULT_UNITS.units[412]).toBeUndefined();
    const c = unitCatalog({ 412: { name: { de: 'Bunker', en: 'Bunker' }, cost: [9000, 1000, 0] }, 413: { name: { de: 'Titan Laser', en: 'Titan Laser' }, cost: [54000, 18000, 0] } });
    expect(c.units[412].req).toEqual({ 21: 5, 111: 6 });
    expect(c.units[413].req).toEqual({ 21: 7, 109: 6, 113: 6, 120: 6 });
    expect(emptyUnit(414)).toMatchObject({ id: 414, name: { en: 'Decoy' }, cost: [100, 0, 0], req: { 21: 2 }, attack: 0 });
    expect(emptyUnit(415).name.de).toBe('#415');
  });
});
