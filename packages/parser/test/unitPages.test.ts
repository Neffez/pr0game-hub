import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseUnitPage } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('unit pages', () => {
  it('shipyard: id, name, costs, unmet requirements', () => {
    const page = parseUnitPage(fixture('shipyard-template.html'))!;
    expect(page).toMatchObject({ kind: 'shipyard', lang: 'de', unknown: [] });
    expect(page.units).toEqual([
      { id: 202, name: 'Kleiner Transporter', cost: [2000, 2000, 0] },
      { id: 233, name: 'Sternenbrecher', cost: [1500000, 750000, 250000], req: { 21: 10, 118: 9 } },
    ]);
  });

  it('defense: once per planet', () => {
    const page = parseUnitPage(fixture('defense-template.html'))!;
    expect(page).toMatchObject({ kind: 'shipyard', lang: 'en' });
    expect(page.units).toEqual([
      { id: 401, name: 'Missile Launcher', cost: [2000, 0, 0] },
      { id: 407, name: 'Small Shield Dome', cost: [10000, 10000, 0], one: true },
    ]);
  });

  it('tech tree: requirements of the units only', () => {
    const page = parseUnitPage(fixture('techtree-template.html'))!;
    expect(page.kind).toBe('techtree');
    expect(page.units).toEqual([{ id: 227, name: 'Optimierter Recycler', req: { 21: 8, 110: 8, 117: 9 } }]);
  });

  it('info page: values, drives and rapidfire both ways', () => {
    const page = parseUnitPage(fixture('info-222-template.html'))!;
    expect(page).toMatchObject({ kind: 'info', lang: 'de', unknown: [] });
    expect(page.units).toEqual([{
      id: 222,
      name: 'Schwerer Kreuzer',
      structure: 42000,
      attack: 620,
      shield: 100,
      capacity: 1000,
      drives: { speed: [0, 0, 7500], tech: [0, 0, 1], consumption: [0, 0, 500] },
      rapidfire: { 202: 3, 204: 9, 401: 15 },
      rapidfireFrom: { 213: 2, 214: 18 },
    }]);
    const lc = parseUnitPage(fixture('info-202-template.html'))!.units[0];
    expect(lc).toMatchObject({ id: 202, capacity: 5000, rapidfire: { 210: 5 }, rapidfireFrom: {} });
    expect(lc.drives).toEqual({ speed: [5000, 10000, 0], tech: [1, 5, 0], consumption: [10, 20, 0] });
  });

  it('info page of a new unit: the name from an earlier shipyard page, else unknown', () => {
    const html = fixture('info-222-template.html').replace('<th>Schwerer Kreuzer</th>', '<th>Sternenbrecher</th>');
    expect(parseUnitPage(html)).toMatchObject({ units: [], unknown: ['Sternenbrecher'] });
    expect(parseUnitPage(html, { sternenbrecher: 233 })!.units[0]).toMatchObject({ id: 233, attack: 620 });
  });

  it('other pages are none of them', () => {
    expect(parseUnitPage(fixture('buildings-real-source.html'))).toBeNull();
    expect(parseUnitPage('<p>hallo</p>')).toBeNull();
  });
});
