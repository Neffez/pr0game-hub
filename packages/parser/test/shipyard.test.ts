import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePage, parseShipyardPage } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const PAGE = fixture('defense-queue.html');
const PLACEHOLDER = '<option>&nbsp;</option>';

describe('shipyard page', () => {
  it('reads the unit counts of the list and the queue of the planet', () => {
    const res = parsePage({ html: PAGE, url: 'https://pr0game.com/uni8/game.php?page=shipyard&mode=defense' });
    expect(res.pageType).toBe('shipyard');
    expect(res.records).toEqual([
      {
        kind: 'shipyard', coords: { g: 1, s: 194, p: 11 }, type: 'planet', pageTime: '2026-11-16 03:31:20', mode: 'defense',
        resources: { 901: 1200, 902: 4500, 903: 300 }, storage: { 901: 40000, 902: 20000, 903: 10000 }, perHour: { 901: 600.5, 902: 300, 903: 150 },
        // every unit of the list, the ones without any too
        units: { 401: 3, 402: 0, 407: 1, 502: 0 },
        // ships and defense share the queue
        queue: [{ id: 202, count: 5 }, { id: 401, count: 2 }],
      },
    ]);
  });

  it('is told from the page itself, without the URL', () => {
    expect(parsePage({ html: PAGE }).pageType).toBe('shipyard');
    expect(parseShipyardPage(PAGE)).toMatchObject({ mode: 'defense', units: { 401: 3 } });
    expect(parseShipyardPage(fixture('buildings.html'))).toBeNull();
  });

  it('takes the queue the running page shows: its amounts are already raised by the units built since', () => {
    // 2 of the 5 transporters are done: the page script counted the first entry down
    const running = PAGE.replace(PLACEHOLDER, '<option value="0">3 Kleiner Transporter in Arbeit</option><option value="1">2 Raketenwerfer in Arbeit</option>');
    expect(parseShipyardPage(running)!.queue).toEqual([{ id: 202, count: 3 }, { id: 401, count: 2 }]);
    // the transporters are through, one launcher too (the script wrote its new amount)
    const later = PAGE.replace(PLACEHOLDER, '<option value="0">1 Raketenwerfer in Arbeit</option>').replace('(Vorhanden:  3)', '(Vorhanden: 4)');
    expect(parseShipyardPage(later)).toMatchObject({ units: { 401: 4 }, queue: [{ id: 401, count: 1 }] });
    // everything built
    const done = PAGE.replace(PLACEHOLDER, '<option>Fertig</option>').replace('(Vorhanden:  3)', '(Vorhanden: 5)');
    expect(parseShipyardPage(done)).toMatchObject({ units: { 401: 5 }, queue: [] });
  });

  it('knows an empty queue from an unknown one', () => {
    const idle = PAGE.replace(/data\s*=\s*\{.*\};/, 'data\t\t\t= [];');
    expect(parseShipyardPage(idle)!.queue).toEqual([]);
    // a copy without the page scripts says nothing about the queue
    const copied = PAGE.replace(/<script[\s\S]*?<\/script>/g, '');
    expect(parseShipyardPage(copied)).toMatchObject({ pageTime: null, mode: 'defense', units: { 401: 3, 407: 1 }, queue: null });
  });

  it('reads the counts of real page sources (these copies have no planet selector and no scripts)', () => {
    const selector = '<select id="planetSelector"><option value="1" selected="selected">Ares [1:100:12]</option></select>';
    const defense = parseShipyardPage(selector + fixture('defense-real-source.html'))!;
    expect(defense).toMatchObject({ coords: { g: 1, s: 100, p: 12 }, mode: 'defense', units: { 401: 69514, 408: 1, 412: 0, 503: 0 }, queue: null });
    const hangar = parseShipyardPage(selector + fixture('hangar-real-source.html'))!;
    expect(hangar).toMatchObject({ mode: 'fleet', units: { 202: 609499, 214: 24210668, 232: 37571, 212: 0 }, queue: null });
    // without a selected planet the page belongs to no planet
    expect(parseShipyardPage(fixture('defense-real-source.html'))).toBeNull();
  });

  it('tells the list from the unit ids when the page has no build form', () => {
    const noForm = PAGE.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<form[\s\S]*?<\/form>/g, '');
    expect(parseShipyardPage(noForm)).toMatchObject({ mode: 'defense' });
    expect(parseShipyardPage(noForm.replace(/401/g, '202'))).toMatchObject({ mode: 'fleet', units: { 202: 3 } });
  });
});
