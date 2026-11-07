import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpyReportsText, spyProbes, spyValues } from '../src/spy.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('spy report text entry (static tools)', () => {
  it('parses a pasted report with defense, missiles and research', () => {
    const text = [
      'Spionagebericht',
      '21. Okt 2026, 12:00:30',
      'Spionagebericht vom Mond Trabant (Alpha) [1:234:5] am 21. Okt 2026, 12:00:30',
      'Rohstoffe', 'Metall', '1.000',
      'Verteidigungsanlagen', 'Raketenwerfer', '1.200', 'Gaußkanone', '15', 'Abfangrakete', '20', 'Interplanetarrakete', '4',
      'Forschungen', 'Waffentechnik', '12', 'Raumschiffpanzerung', '14',
      'Die Wahrscheinlichkeit der Zerstörung der Spionagesonde beträgt: 3 %',
    ].join('\n');
    const [report] = parseSpyReportsText(text);
    expect(report).toMatchObject({ coords: { g: 1, s: 234, p: 5 }, planetType: 'moon' });
    expect(spyValues(report)).toMatchObject({ 401: 1200, 404: 15, 502: 20, 503: 4, 109: 12, 111: 14, 901: 1000 });
  });

  it('keeps the order of the messages page and skips other messages', () => {
    const reports = parseSpyReportsText(fixture('messages.txt'));
    expect(reports).toHaveLength(1);
    expect(reports[0].coords).toEqual({ g: 1, s: 234, p: 5 });
    expect(parseSpyReportsText('nothing here')).toEqual([]);
  });
});

describe('spyProbes (MissionCaseSpy)', () => {
  it('needs one probe for every section at the same level, plus the extras', () => {
    expect(spyProbes(8, 8)).toEqual({ fleet: 1, defense: 1, buildings: 3, research: 5 });
  });
  it('needs the square of the difference more when the target is ahead', () => {
    expect(spyProbes(6, 8)).toEqual({ fleet: 4, defense: 5, buildings: 7, research: 9 });
  });
  it('needs fewer when the sender is ahead, at least one', () => {
    expect(spyProbes(10, 8)).toEqual({ fleet: 1, defense: 1, buildings: 1, research: 1 });
    expect(spyProbes(9, 8)).toEqual({ fleet: 1, defense: 1, buildings: 2, research: 4 });
    expect(spyProbes(0, 0)).toEqual({ fleet: 1, defense: 1, buildings: 3, research: 5 });
  });
});
