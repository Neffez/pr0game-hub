import { describe, expect, it } from 'vitest';
import { optimize, simulate, type OptimizeResult } from '../src/index.js';
import { NOW } from './optimizeFixture.js';
import { COLONY, DEPARTURES, HOME, transportHub, transportOrder } from './transportFixture.js';

/** The optimizer on a colony whose kept transports feed the home planet (the report of transports moved to the end). */
const hub = transportHub();
const order = transportOrder(hub);
const targets = [{ element: 1, level: 20, by: NOW + 72 * 3600 }, { element: 2, level: 17, by: NOW + 72 * 3600 }];
const run = (options = {}, iterations = 300): OptimizeResult =>
  optimize({ order, hub, planet: COLONY, targets, now: NOW, options: { forbid: [12, 212], ...options } }, { iterations, seed: 1 });
const SLACK = 60;

describe('auto plan of a colony with timed transports', () => {
  const r = run();
  const timeline = new Map(r.timeline.map((t) => [t.id, t]));

  it('keeps the transports\' departures', () => {
    // in the list between the colony's steps, not at its end
    const ids = r.steps.map((s) => s.id);
    expect(ids.filter((id) => id.startsWith('t'))).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
    expect(ids.indexOf('t1')).toBeLessThan(ids.length / 2);
    DEPARTURES.forEach((at, i) => expect(timeline.get(`t${i + 1}`)!.start!).toBeLessThanOrEqual(at + SLACK));
    // reported as goals of the colony that measure the departure
    const departures = r.goals.filter((g) => g.measure === 'start');
    expect(departures.map((g) => g.step)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
    expect(departures.every((g) => g.planet === COLONY && g.end <= g.by! + SLACK)).toBe(true);
    // the transports with 5 small cargos still come after the step that builds the 2 more
    const cargos = r.steps.findIndex((s) => s.element === 202);
    expect(cargos).toBeGreaterThanOrEqual(0);
    expect(cargos).toBeLessThan(ids.indexOf('t4'));
  });

  it('does not delay the home planet it feeds', () => {
    const home = r.goals.filter((g) => g.planet === HOME);
    expect(home.map((g) => g.step)).toEqual(['h-lf', 'h-imp', 'h-hf', 'h-sc', 'h-imp2']);
    expect(home.every((g) => g.source === 'other' && g.by === g.currentEnd)).toBe(true);
    for (const g of home) expect(g.end).toBeLessThanOrEqual(g.currentEnd! + SLACK);
    // checked against the timeline of the whole build order with the result
    const sim = simulate({ ...order, base: r.base, planets: { ...order.planets, [COLONY]: r.steps } }, hub, { now: NOW });
    for (const g of home) expect(sim.steps.find((s) => s.id === g.step)!.end).toBe(g.end);
  });

  it('a plan that moves the transports to the end loses', () => {
    // the same plan with the transports last: the departures are late, the home planet gets its resources later
    const without = r.steps.filter((s) => s.kind !== 'transport');
    const late = [...without, ...r.steps.filter((s) => s.kind === 'transport')];
    const sim = simulate({ ...order, base: r.base, planets: { ...order.planets, [COLONY]: late } }, hub, { now: NOW });
    const start = (id: string) => sim.steps.find((s) => s.id === id)!.start!;
    expect(start('t1')).toBeGreaterThan(DEPARTURES[0] + 86400);
    // the home planet's steps end later than in the result: that is what the departure and home goals prevent
    const later = r.goals.filter((g) => g.planet === HOME).filter((g) => sim.steps.find((s) => s.id === g.step)!.end! > g.end + SLACK);
    expect(later.length).toBeGreaterThan(0);
    // without them (weight 0, noLater off) the home planet is not measured at all
    const free = run({ keepTimeWeight: 0, noLater: false }, 50);
    expect(free.goals.some((g) => g.planet === HOME)).toBe(false);
    expect(free.goals.filter((g) => g.measure === 'start').every((g) => g.weight === 0)).toBe(true);
  });

  it('fills currentFinishAt and the comparison as it is', () => {
    expect(r.currentFinishAt).toEqual(expect.any(Number));
    expect(r.currentError).toBeNull();
    expect(r.finishAt).toBeLessThanOrEqual(r.currentFinishAt!);
    // the colony's targets are beyond the list as it is: no finish there
    expect(r.asIsFinishAt).toBeNull();
    // without includeExisting the current list is not a start, and the answer says why
    const own = run({ includeExisting: false }, 50);
    expect(own.currentFinishAt).toBeNull();
    expect(own.currentError).toMatch(/includeExisting/);
  });
});
