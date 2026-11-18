// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runOptimizeJob, type OptimizeJobMessage, type OptimizeJobRequest } from '@pr0hub/planner';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyHash, cleanEconomy, cleanState, ECONOMY_DEFAULTS, emptyState, encodeHash, planInput, planRows, prodText, span, universeOf,
} from '../src/autoplan';

const NOW = 1_800_000_000;

describe('auto plan state', () => {
  it('cleans stored data: unknown elements, levels out of range and broken settings fall back', () => {
    const s = cleanState({
      temp: 40, levels: { 1: 10, 2: 300, 999: 4, 31: 0 }, research: { 113: 3, 1: 5 }, resources: [1, 2, 'x'],
      targets: [{ element: 202, value: 5 }, { element: 5000, value: 1 }, { element: 1, value: 0 }],
      settings: { budget: 7, economy: false, forbid: [12, 99], mineRatio: [2, 3], quietHours: [23, 30], workers: 3 },
    });
    expect(s.temp).toBe(40);
    expect(s.levels).toEqual({ 1: 10 });
    expect(s.research).toEqual({ 113: 3 });
    expect(s.resources).toBeNull();
    expect(s.targets).toEqual([{ element: 202, value: 5 }, { element: 1, value: 1 }]);
    expect(s.settings).toMatchObject({ budget: 30, economy: false, throttle: true, forbid: [12], mineRatio: [2, 3], quietHours: null, workers: 3 });
    expect(cleanState(null)).toEqual(emptyState());
  });

  it('round-trips a share link with the universe economy values', () => {
    const s = emptyState();
    s.temp = -20;
    s.levels = { 1: 12, 4: 10 };
    s.research = { 113: 2 };
    s.resources = [1000, 500, 0];
    s.targets = [{ element: 15, value: 1 }, { element: 202, value: 20 }];
    s.settings = { ...s.settings, budget: 60, throttle: false, forbid: [12], quietHours: [23, 7] };
    const uni = { ...ECONOMY_DEFAULTS, building_speed: 4, resource_multiplier: 6 };
    const hash = encodeHash(s, uni);
    expect(hash).toContain('bsp=4');
    expect(hash).not.toContain('rsp=');
    const back = emptyState();
    const backUni = { ...ECONOMY_DEFAULTS };
    expect(applyHash(back, backUni, '#' + hash)).toBe(true);
    expect(back).toEqual({ ...s, settings: { ...s.settings, workers: back.settings.workers } });
    expect(backUni).toEqual(uni);
    expect(applyHash(emptyState(), { ...ECONOMY_DEFAULTS }, 'd=4560')).toBe(false);
  });

  it('turns the economy values into the game config', () => {
    const u = universeOf(cleanEconomy({ building_speed: 2, research_speed: '3', storage_multiplier: 0, factor_university: 10 }));
    expect(u).toMatchObject({ buildingSpeed: 5000, researchSpeed: 7500, shipyardSpeed: 2500, resourceMultiplier: 2500, storageMultiplier: 1, universityFactor: 10 });
  });

  it('formats durations and production steps', () => {
    expect(span(59)).toBe('1m');
    expect(span(3 * 3600 + 120)).toBe('3h 2m');
    expect(span(2 * 86400 + 3600)).toBe('2d 1h 0m');
    expect(prodText({ id: 'p', kind: 'prod', prod: { factors: { 1: 0.9, 3: 0.5 }, awaitBuilding: false, awaitResearch: false, awaitShipyard: false, wait: 0 } }, ['M', 'K', 'D']))
      .toBe('M 90 % · K 100 % · D 50 %');
  });

  it('plans a planet from given levels and counts the levels of the steps on', () => {
    const s = emptyState();
    s.levels = { 1: 4, 2: 2, 4: 4 };
    s.targets = [{ element: 1, value: 6 }];
    s.settings.economy = false;
    const input = planInput(s, ECONOMY_DEFAULTS, NOW);
    expect(input.now).toBe(NOW);
    expect(input.order.base.planets[input.planet]).toEqual({ 1: 4, 2: 2, 4: 4 });
    const messages: OptimizeJobMessage[] = [];
    runOptimizeJob({ input, iterations: 20, seed: 1 }, (m) => messages.push(m));
    const done = messages.at(-1)!;
    if (done.type !== 'done') throw new Error(JSON.stringify(done));
    const rows = planRows(s, done.best);
    const metal = rows.filter((r) => r.step.element === 1).map((r) => r.level);
    expect(metal).toEqual([5, 6]);
    expect(rows.every((r) => r.end != null && r.end >= NOW)).toBe(true);
  });
});

describe('auto plan page', () => {
  beforeAll(async () => {
    // the workers run the search in the test's thread, with a fixed number of iterations instead of the time budget
    class FakeWorker {
      onmessage: ((e: { data: OptimizeJobMessage }) => void) | null = null;
      onerror: ((e: { message?: string }) => void) | null = null;
      postMessage(req: OptimizeJobRequest) {
        setTimeout(() => runOptimizeJob({ ...req, budgetMs: undefined, iterations: 20 }, (m) => this.onmessage?.({ data: m })));
      }
      terminate() {}
    }
    (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
    const html = readFileSync(resolve(import.meta.dirname, '../auto-plan/index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
    localStorage.setItem('pr0tools.lang', JSON.stringify('en'));
    location.hash = '#t=1:3,4:2&w=1&e=0&bsp=2';
    await import('../auto-plan/main.js');
  });

  it('opens a share link with targets and the building speed', () => {
    expect(location.hash).toBe('');
    expect(document.querySelectorAll('#targets .target')).toHaveLength(2);
    expect((document.querySelector('[data-value="0"]') as HTMLInputElement).value).toBe('3');
    expect(document.getElementById('uniSummary')?.textContent).toContain('Build ×2');
    expect((document.getElementById('economyIn') as HTMLInputElement).checked).toBe(false);
  });

  it('plans and shows the build order', async () => {
    (document.getElementById('runBtn') as HTMLButtonElement).click();
    for (let i = 0; i < 50 && !(document.getElementById('stopBtn') as HTMLElement).hidden; i++) await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById('notes')?.textContent).not.toContain('Cannot');
    const rows = [...document.querySelectorAll('#planTable tbody tr')].map((tr) => tr.textContent ?? '');
    expect(rows.filter((r) => r.includes('Metal Mine'))).toHaveLength(3);
    expect(rows.some((r) => r.includes('Solar Power plant 2'))).toBe(true);
    expect(document.getElementById('hero')?.textContent).toContain('Targets reached');
    expect(document.getElementById('runStatus')?.textContent).toContain('Done');
  });

  it('marks the result stale when an input changes', () => {
    const lvl = document.getElementById('lvl-1') as HTMLInputElement;
    lvl.value = '2';
    lvl.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('results')?.classList.contains('stale')).toBe(true);
    expect(document.querySelector('[data-now="0"]')?.textContent).toBe('now level 2');
  });

  it('takes the levels and resources of a pasted buildings page', async () => {
    const page = readFileSync(resolve(import.meta.dirname, '../../../packages/parser/test/fixtures/buildings.html'), 'utf8');
    const area = document.getElementById('pasteIn') as HTMLTextAreaElement;
    area.value = page;
    area.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 50 && (document.getElementById('lvl-1') as HTMLInputElement).value !== '18'; i++) await new Promise((r) => setTimeout(r, 20));
    expect((document.getElementById('lvl-1') as HTMLInputElement).value).toBe('18');
    expect((document.getElementById('lvl-2') as HTMLInputElement).value).toBe('16');
    expect((document.getElementById('res-0') as HTMLInputElement).value).toBe('120,000');
    expect(document.querySelector('[data-now="0"]')?.textContent).toBe('reached');
  });

  it('switches to German', () => {
    (document.querySelector('#langSeg [data-lang="de"]') as HTMLButtonElement).click();
    expect(document.querySelector('#targets')?.textContent).toContain('Metallmine');
    expect(document.getElementById('uniSummary')?.textContent).toContain('Bau ×2');
  });
});
