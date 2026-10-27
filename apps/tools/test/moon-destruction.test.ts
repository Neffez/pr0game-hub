// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyHash, calculateWaves, cleanState, emptyState, encodeHash, fleetChance, moonChance, parseMoons, recommend, ripsFor } from '../src/moon';

/** The moon tooltip of the galaxy view (tooltip.galaxy.missions.tpl). */
const TOOLTIP = `<table style='width:240px'>
<tr>
        <th colspan='2'>Mond Ra [3:200:1]</th>
    </tr>
            <tr>
            <td>Durchmesser</td>
            <td>4.560</td>
        </tr>
        <tr>
        <td style='width:80px'>
            <img src='./styles/theme/community/planeten/mond06.jpg' height='75' width='75'>
        </td>
        <td>`;

describe('moon destruction formulas', () => {
  it('rounds the moon chance to 0.1 like the battle report, but rolls whole percent', () => {
    // √4560 = 67.53: (100 − 67.53) · 1 = 32.47 → 32.5 %, counts as 32 %
    expect(moonChance(4560, 1)).toEqual({ shown: 32.5, effective: 0.32 });
    expect(moonChance(4560, 4)).toEqual({ shown: 64.9, effective: 0.64 });
    expect(moonChance(4560, 10)).toEqual({ shown: 100, effective: 1 });
    expect(moonChance(4560, 0)).toEqual({ shown: 0, effective: 0 });
    expect(moonChance(10000, 50)).toEqual({ shown: 0, effective: 0 });
    expect(fleetChance(4560)).toBe(34);
    expect(fleetChance(8944)).toBe(47);
  });

  it('finds the fewest Death Stars for a chance', () => {
    expect(ripsFor(4560, 100)).toBe(10);
    expect(moonChance(4560, 9).shown).toBeLessThan(100);
    expect(ripsFor(4560, 50)).toBe(3);
    expect(ripsFor(10000, 10)).toBeNull();
  });

  it('adds waves: later waves only fly while the moon stands', () => {
    const r = calculateWaves(4560, [1, 0, 1]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1].flies).toBeCloseTo(0.68);
    expect(r.total).toBeCloseTo(1 - 0.68 * 0.68);
    expect(r.rows[1].lost).toBeCloseTo(0.68 * 0.34);
    expect(r.expectedLost).toBeCloseTo(0.34 + 0.68 * 0.34);
    expect(r.expectedWaves).toBeCloseTo(1.68);
    // no loss: moon falls in wave 1 and it survives, or wave 1 survives and wave 2 flies and survives
    expect(r.anyLost).toBeCloseTo(1 - (0.32 * 0.66 + 0.68 * 0.66 * 0.66));
    const sure = calculateWaves(4560, [10, 10]);
    expect(sure.total).toBe(1);
    expect(sure.rows[1].flies).toBe(0);
    expect(sure.anyLost).toBeCloseTo(0.34);
  });

  it('recommends the fewest Death Stars per wave count', () => {
    const list = recommend(4560, 90);
    expect(list[0]).toMatchObject({ waves: 1, ripsPerWave: 8 });
    for (const x of list) {
      expect(x.total).toBeGreaterThanOrEqual(0.9);
      if (x.ripsPerWave > 1) expect(calculateWaves(4560, Array(x.waves).fill(x.ripsPerWave - 1)).total).toBeLessThan(0.9);
    }
    // waves that need as many Death Stars as one wave less are left out
    expect(new Set(list.map((x) => x.ripsPerWave)).size).toBe(list.length);
    expect(recommend(4560, 100)).toEqual([expect.objectContaining({ waves: 1, ripsPerWave: 10, total: 1 })]);
    expect(recommend(10000, 90)).toEqual([]);
  });

  it('round-trips a share link and keeps the waves for a link with only a moon', () => {
    const s = emptyState();
    Object.assign(s, { diameter: 4560, target: [3, 200, 1], name: 'Ra', waves: [5, 5, 3], goal: 75 });
    const back = emptyState();
    expect(applyHash(back, encodeHash(s))).toBe(true);
    expect(back).toEqual(s);
    const kept = cleanState({ waves: [7, 7], goal: 80, diameter: 5000, name: 'Old', target: [1, 1, 1] });
    applyHash(kept, 'd=6000&tg=2&ts=3&tp=4');
    expect(kept).toEqual({ diameter: 6000, target: [2, 3, 4], name: '', waves: [7, 7], goal: 80 });
    expect(applyHash(emptyState(), 'foo=1')).toBe(false);
  });

  it('reads moons from the pasted tooltip, escaped galaxy HTML and copied text', () => {
    expect(parseMoons(TOOLTIP)).toEqual([{ diameter: 4560, target: [3, 200, 1], name: 'Ra' }]);
    const escaped = TOOLTIP.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const page = `<a class="tooltip_sticky" data-tooltip-content="${escaped}"><img alt="Ra"></a>`
      + `<a data-tooltip-content="${escaped.replace('Ra [3:200:1]', 'Luna [3:200:9]').replace('4.560', '8.944')}"></a>`;
    expect(parseMoons(page).map((m) => [m.name, m.diameter, m.target])).toEqual([['Ra', 4560, [3, 200, 1]], ['Luna', 8944, [3, 200, 9]]]);
    expect(parseMoons('Moon Luna [1:2:3]\nDiameter\t5,099')).toEqual([{ diameter: 5099, target: [1, 2, 3], name: 'Luna' }]);
    expect(parseMoons('Durchmesser 4.000')).toEqual([{ diameter: 4000, target: null, name: '' }]);
    expect(parseMoons('nothing here')).toEqual([]);
  });
});

describe('moon destruction page', () => {
  beforeAll(async () => {
    const html = readFileSync(resolve(import.meta.dirname, '../moon-destruction/index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
    localStorage.setItem('pr0tools.lang', JSON.stringify('en'));
    location.hash = '#d=4560&tg=3&ts=200&tp=1&mn=Ra&r=1,1';
    await import('../moon-destruction/main.js');
  });

  it('opens a share link with the diameter and shows one row per wave', () => {
    expect((document.getElementById('diameterIn') as HTMLInputElement).value).toBe('4,560');
    expect((document.getElementById('coordsIn') as HTMLInputElement).value).toBe('3:200:1');
    expect(document.querySelectorAll('#table tbody tr')).toHaveLength(2);
    expect(document.getElementById('hero')?.textContent).toContain('53.8 %');
    expect(location.hash).toBe('');
  });

  it('applies a recommendation', () => {
    (document.querySelector('[data-apply="1:8"]') as HTMLButtonElement).click();
    expect(document.querySelectorAll('[data-wave]')).toHaveLength(1);
    expect((document.getElementById('wave-0') as HTMLInputElement).value).toBe('8');
  });

  it('takes a moon from a pasted tooltip', () => {
    const area = document.getElementById('pasteIn') as HTMLTextAreaElement;
    area.value = TOOLTIP.replace('4.560', '6.400').replace('Ra', 'Sol');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    expect((document.getElementById('diameterIn') as HTMLInputElement).value).toBe('6,400');
    expect(document.getElementById('moonMeta')?.textContent).toContain('Sol');
  });

  it('switches to German', () => {
    (document.querySelector('#langSeg [data-lang="de"]') as HTMLButtonElement).click();
    expect(document.querySelector('#table thead')?.textContent).toContain('Todessterne');
    expect((document.getElementById('diameterIn') as HTMLInputElement).value).toBe('6.400');
  });
});
