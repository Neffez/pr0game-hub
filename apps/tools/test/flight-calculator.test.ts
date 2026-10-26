// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Smoke test of the calculator page: markup from index.html, then the UI module runs init().
describe('flight calculator page', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const html = readFileSync(resolve(import.meta.dirname, '../flight-calculator/index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
    location.hash = '#sg=1&ss=1&sp=1&tg=1&ts=2&tp=1&ships=202:5,222:3&h=10';
    await import('../flight-calculator/main.js');
  });
  afterAll(() => vi.useRealTimers());

  it('renders all ships including the Heavy Cruiser', () => {
    const boxes = [...document.querySelectorAll('[data-ship-box]')].map((el) => el.getAttribute('data-ship-box'));
    expect(boxes).toContain('222');
    expect(boxes).toHaveLength(18);
  });

  it('loads a share link and shows the slowest ship and a result row per speed', () => {
    const input = document.getElementById('ship-222') as HTMLInputElement;
    expect(input.value).toBe('3');
    // Heavy Cruiser with hyperspace 10: 7,500 * (1 + 0.3 * 10) = 30,000
    expect(document.querySelector('[data-ship-box="222"] .ship-name span')?.textContent).toContain('30,000');
    expect(document.querySelectorAll('#results tbody tr, table tbody tr').length).toBeGreaterThanOrEqual(10);
  });

  it('switches to German: static texts, ship names and number format', () => {
    (document.querySelector('#langSeg [data-lang="de"]') as HTMLButtonElement).click();
    expect(document.documentElement.lang).toBe('de');
    expect(document.querySelector('[data-mode="timing"] small')?.textContent).toBe('Ankunft → Start');
    expect(document.querySelector('[data-ship-box="222"] .ship-name strong')?.textContent).toBe('Schwerer Kreuzer');
    expect(document.querySelector('[data-ship-box="222"] .ship-name span')?.textContent).toContain('30.000');
    expect(document.querySelector('#table thead')?.textContent).toContain('Ankunft');
    expect((document.getElementById('ship-222') as HTMLInputElement).value).toBe('3');
    (document.querySelector('#langSeg [data-lang="en"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-ship-box="222"] .ship-name strong')?.textContent).toBe('Heavy Cruiser');
  });
});
