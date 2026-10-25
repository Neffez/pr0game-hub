// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyHash, applySpyReport, calculate, cleanState, emptyState, encodeHash, MISSILE_COST, MISSILE_TARGETS } from '../src/missile';

const spyReport = (type: 'Planeten' | 'Mond') => [
  'Spionagebericht',
  '21. Okt 2026, 12:00:30',
  `Spionagebericht vom ${type} Ziel (Alpha) [1:110:8] am 21. Okt 2026, 12:00:30`,
  'Verteidigungsanlagen', 'Raketenwerfer', '400', 'Gaußkanone', '20', 'Abfangrakete', '7', 'Interplanetarrakete', '3',
  'Forschungen', 'Raumschiffpanzerung', '11',
  'Die Wahrscheinlichkeit der Zerstörung der Spionagesonde beträgt: 3 %',
].join('\n');

describe('IPM calculator glue', () => {
  it('uses the costs of the game data for structure and value', () => {
    const costs = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../packages/parser/src/data/costs.json'), 'utf8'));
    for (const [id, cost] of Object.entries(MISSILE_TARGETS)) expect(costs[id].slice(0, 3)).toEqual(cost);
    expect(costs[503].slice(0, 3)).toEqual([MISSILE_COST.m, MISSILE_COST.k, MISSILE_COST.d]);
  });

  it('round-trips a share link', () => {
    const s = emptyState();
    Object.assign(s, { start: [2, 100, 5], target: [2, 110, 8], moon: true, impulse: 6, weapons: 12, silo: 6, missiles: 30, primary: 404, armor: 11, interceptors: 5 });
    s.defense = { 401: 400, 404: 20, 503: 3 };
    s.uni = { systems: 499, galaxyType: 1, speed: 4, rangeFactor: 0.5, siloFactor: 2 };
    const back = emptyState();
    expect(applyHash(back, encodeHash(s))).toBe(true);
    expect(back).toEqual(s);
    expect(applyHash(emptyState(), 'foo=1')).toBe(false);
  });

  it('a link with a target replaces the old target but keeps own research', () => {
    const s = emptyState();
    Object.assign(s, { impulse: 7, weapons: 10, armor: 15, interceptors: 9, primary: 406 });
    s.defense = { 402: 50 };
    applyHash(s, 'tg=1&ts=5&tp=3&d401=10');
    expect(s).toMatchObject({ impulse: 7, weapons: 10, armor: 0, interceptors: 0, primary: 0, defense: { 401: 10 }, target: [1, 5, 3] });
  });

  it('takes defense, interceptors and armour from a spy report, interceptors not from a moon', () => {
    const s = emptyState();
    expect(applySpyReport(s, spyReport('Planeten'))).toMatchObject({ ok: true, moon: false, defense: true, armor: true, interceptors: true });
    expect(s).toMatchObject({ target: [1, 110, 8], moon: false, armor: 11, interceptors: 7, defense: { 401: 400, 404: 20, 503: 3 } });
    const m = emptyState();
    m.interceptors = 12;
    expect(applySpyReport(m, spyReport('Mond'))).toMatchObject({ ok: true, moon: true, interceptors: false });
    expect(m).toMatchObject({ moon: true, interceptors: 12, defense: { 401: 400, 404: 20, 503: 3 } });
    expect(applySpyReport(emptyState(), 'no report')).toEqual({ ok: false });
  });

  it('calculates the attack, the missiles needed, range and flight time', () => {
    const s = cleanState({ start: [1, 100, 5], target: [1, 110, 8], impulse: 6, weapons: 12, silo: 6, missiles: 30, primary: 404, armor: 11, interceptors: 5, defense: { 401: 400, 402: 300, 403: 50, 404: 20, 406: 2, 407: 1, 503: 3 } });
    const r = calculate(s);
    expect(r).toMatchObject({ range: 29, inRange: true, duration: 630, intercepted: 5, effective: 25, damage: 660000, neededAll: 27, neededPrimary: 11, siloCapacity: 30 });
    expect(r.rows.every((row) => row.remaining === 0)).toBe(true);
    // everything destroyed: 401×400, 402×300, 403×50, 404×20, 406×2, 407×1 and 503×3 at their costs
    expect(r.value).toEqual({ m: 2097500, k: 667500, d: 130000 });
  });
});

describe('IPM calculator page', () => {
  beforeAll(async () => {
    const html = readFileSync(resolve(import.meta.dirname, '../ipm-calculator/index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
    localStorage.setItem('pr0tools.lang', JSON.stringify('en'));
    location.hash = '#sg=1&ss=100&sp=5&tg=1&ts=110&tp=8&i=6&w=12&sl=6&n=30&pt=404&a=11&ic=5&d401=400&d404=20&ms=400&gt=0&gs=1';
    await import('../ipm-calculator/main.js');
  });

  it('opens a share link and shows one row per defense type', () => {
    expect((document.getElementById('missilesIn') as HTMLInputElement).value).toBe('30');
    expect((document.getElementById('primaryIn') as HTMLSelectElement).value).toBe('404');
    const rows = [...document.querySelectorAll('#table tbody tr')].map((tr) => tr.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('Gauss Cannon');
    expect(location.hash).toBe('');
  });

  it('fills the target from a pasted spy report', () => {
    const area = document.getElementById('spyIn') as HTMLTextAreaElement;
    area.value = spyReport('Planeten');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    expect((document.getElementById('interceptorsIn') as HTMLInputElement).value).toBe('7');
    expect((document.getElementById('def-503') as HTMLInputElement).value).toBe('3');
    expect(document.getElementById('spyHint')?.textContent).toContain('1:110:8');
  });

  it('switches to German', () => {
    (document.querySelector('#langSeg [data-lang="de"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-def-box="404"] strong')?.textContent).toBe('Gaußkanone');
    expect(document.querySelector('#table thead')?.textContent).toContain('Zerstört');
  });
});
