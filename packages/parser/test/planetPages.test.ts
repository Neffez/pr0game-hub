import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePlanetPage } from '../src/parsers/planetPages.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('planet pages for the tools', () => {
  it('takes the levels of the buildings page, the queue counted as built', () => {
    const page = parsePlanetPage(fixture('buildings.html'))!;
    expect(page).toMatchObject({ kind: 'buildings', coords: { g: 1, s: 100, p: 12 }, type: 'planet', resources: { 901: 120000, 902: 45000, 903: 30000 } });
    // crystal mine 15 with level 16 in the queue
    expect(page.levels).toEqual({ 1: 18, 2: 16, 21: 8, 15: 0 });
  });

  it('takes the research levels with the queue', () => {
    const page = parsePlanetPage(fixture('research.html'))!;
    expect(page.kind).toBe('research');
    expect(page.levels).toMatchObject({ 106: 9, 113: 13, 123: 0 });
  });

  it('reads the real page sources', () => {
    expect(parsePlanetPage(fixture('buildings-real-source.html'))?.kind).toBe('buildings');
    expect(parsePlanetPage(fixture('research-real-source.html'))?.kind).toBe('research');
  });

  it('answers null for other pages and plain text', () => {
    expect(parsePlanetPage(fixture('empire.html'))).toBeNull();
    expect(parsePlanetPage('Metallmine 12')).toBeNull();
  });
});
