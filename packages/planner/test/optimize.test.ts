import { describe, expect, it } from 'vitest';
import { expandTargets, optimize, quietWait, simulate, type BuildOrder, type HubState, type Step } from '../src/index.js';
import { anneal, type Move } from '../src/optimize/anneal.js';
import { evaluate } from '../src/optimize/evaluate.js';
import { greedyPlan } from '../src/optimize/greedy.js';
import { setupProblem } from '../src/optimize/problem.js';
import { createRng } from '../src/optimize/rng.js';
import { accountHub, accountOrder, COL2, HOME, hubOf, NOW, planetOf } from './optimizeFixture.js';

/** one planet with small mines, a lab and storages, an empty list */
const single = (): { hub: HubState; order: BuildOrder } => {
  const hub = hubOf([planetOf(HOME, { 1: 8, 2: 6, 3: 2, 4: 8, 14: 2, 31: 1, 22: 1, 23: 1, 24: 1 }, { 901: 3000, 902: 1500, 903: 300 })], { research: {} });
  return { hub, order: { base: { planets: { [HOME]: { ...hub.planets[0].planet.values } }, research: {} }, planets: { [HOME]: [] } } };
};
const ids = () => {
  let n = 0;
  return () => `t${n++}`;
};
/** levels after the whole list (base + steps of the planet; research of the account) */
const levelsAfter = (order: BuildOrder, key: string) => {
  const out: Record<number, number> = { ...order.base.planets[key], ...order.base.research };
  for (const s of Object.values(order.planets).flat()) {
    if (s.element == null || (s.kind !== 'research' && !order.planets[key].includes(s))) continue;
    out[s.element] = (out[s.element] ?? 0) + (s.count ?? 1);
  }
  return out;
};

describe('auto plan', () => {
  it('expands the targets with their requirements', () => {
    // small cargo: shipyard 2 (robot factory 2), combustion drive 2 (energy 1, lab 1)
    expect(expandTargets({ ships: { 202: 5 } })).toEqual({ 202: 5, 21: 2, 14: 2, 115: 2, 113: 1, 31: 1 });
    // fusion reactor: deuterium synthesizer 5 and energy technology 3; the higher level wins
    expect(expandTargets({ buildings: { 12: 1, 3: 7 } })).toMatchObject({ 12: 1, 3: 7, 113: 3, 31: 1 });
    expect(() => expandTargets({ buildings: { 99: 1 } })).toThrow(/unknown building/);
    expect(() => expandTargets({ research: { 1: 1 } })).toThrow(/not a research/);
    expect(() => expandTargets({ buildings: { 1: 3 } }, 'moon')).toThrow(/moon/);
  });

  it('builds a valid greedy plan that reaches all targets', () => {
    const { hub, order } = single();
    const problem = setupProblem({ order, hub, planet: HOME, targets: { research: { 115: 3 }, ships: { 202: 5 } }, now: NOW });
    for (const mode of ['plain', 'score', 'rollout'] as const) {
      const items = greedyPlan(problem, mode);
      expect(evaluate(problem, items)!.fitness.valid).toBe(true);
      const levels = levelsAfter({ ...problem.order, planets: { [HOME]: items.map((i) => i.step) } }, HOME);
      expect(levels[115]).toBeGreaterThanOrEqual(3);
      expect(levels[202]).toBe(5);
      expect(levels[21]).toBeGreaterThanOrEqual(2);
    }
  });

  it('never returns worse than the greedy plan, the same seed gives the same plan', () => {
    const { hub, order } = single();
    const input = { order, hub, planet: HOME, targets: { research: { 115: 3 }, ships: { 202: 5 } }, now: NOW };
    const a = optimize(input, { iterations: 300, seed: 7, newId: ids() });
    expect(a.finishAt).toBeLessThanOrEqual(a.greedyFinishAt);
    expect(a.finishAt).toBeLessThanOrEqual(a.baselineFinishAt);
    const b = optimize(input, { iterations: 300, seed: 7, newId: ids() });
    expect(b.steps).toEqual(a.steps);
    expect(b.finishAt).toBe(a.finishAt);
    // the proposal is a valid list: the timeline plans every step, the last one ends at the finish
    const sim = simulate({ ...order, base: a.base, planets: { [HOME]: a.steps } }, hub, { now: NOW });
    expect(sim.steps.every((s) => s.state === 'planned')).toBe(true);
    expect(Math.max(...sim.steps.map((s) => s.end!))).toBe(a.finishAt);
    expect(a.timeline.map((t) => t.id)).toEqual(a.steps.map((s) => s.id));
  });

  it('never accepts an invalid plan', () => {
    const { hub, order } = single();
    const problem = setupProblem({ order, hub, planet: HOME, targets: { research: { 115: 3 } }, now: NOW });
    const start = greedyPlan(problem, 'plain');
    const fit = evaluate(problem, start)!.fitness;
    // combustion drive before the energy technology it needs: invalid, even though it would be "faster"
    const research = start.filter((i) => i.step.kind === 'research');
    const broken = [...research.filter((i) => i.step.element === 115), ...start.filter((i) => i.step.element !== 115)];
    expect(evaluate(problem, broken)!.fitness.valid).toBe(false);
    const invalidOnly: Move = () => broken;
    const res = anneal(problem, start, fit, [invalidOnly], createRng(1), { iterations: 50, deadline: Infinity, temperature: 1e9, coolingRate: 1, reheatEvery: 5000 });
    expect(res.items).toBe(start);
    expect(res.fitness).toBe(fit);
  });

  it('respects forbidden elements', () => {
    const { hub, order } = single();
    const r = optimize(
      { order, hub, planet: HOME, targets: { buildings: { 1: 14 } }, now: NOW, options: { forbid: [4, 12, 22, 23, 24] } },
      { iterations: 300, seed: 3, newId: ids() },
    );
    expect(r.steps.some((s) => [4, 12, 22, 23, 24].includes(s.element!))).toBe(false);
    const free = optimize({ order, hub, planet: HOME, targets: { buildings: { 1: 14 } }, now: NOW }, { iterations: 300, seed: 3, newId: ids() });
    expect(free.steps.some((s) => s.element === 4)).toBe(true);
  });

  it('inserts economy early for a far target and beats the plain order', () => {
    const { hub, order } = single();
    const r = optimize({ order, hub, planet: HOME, targets: { research: { 113: 6, 115: 5 } }, now: NOW }, { iterations: 400, seed: 1, newId: ids() });
    expect(r.finishAt).toBeLessThan(r.baselineFinishAt);
    // a mine before the last research step: production first
    const lastResearch = r.steps.map((s) => s.kind).lastIndexOf('research');
    expect(r.steps.slice(0, lastResearch).some((s) => s.kind === 'building' && [1, 2, 3].includes(s.element!))).toBe(true);
  });

  it('keeps kept steps in their order and the steps before the open tail', () => {
    const { hub, order } = single();
    const prod = (id: string, f: number): Step => ({ id, kind: 'prod', prod: { factors: { 1: f }, awaitBuilding: false, awaitResearch: false, awaitShipyard: false, wait: 0 } });
    const tr = (id: string): Step => ({ id, kind: 'transport', transport: { target: null, resources: { 901: 500 }, flight: 600 } });
    const list: Step[] = [{ id: 'd1', kind: 'building', element: 1, done: true }, { id: 'm', kind: 'building', element: 2 }, prod('p1', 0.5), tr('x1'), { id: 'm2', kind: 'building', element: 1 }, prod('p2', 1), tr('x2')];
    const withList = { ...order, planets: { [HOME]: list } };
    const r = optimize({ order: withList, hub, planet: HOME, targets: { buildings: { 21: 2 } }, now: NOW }, { iterations: 300, seed: 5, newId: ids() });
    expect(r.steps[0].id).toBe('d1');
    expect(r.steps.map((s) => s.id).filter((id) => ['p1', 'x1', 'p2', 'x2'].includes(id))).toEqual(['p1', 'x1', 'p2', 'x2']);
    // the open steps that were not kept are targets too: their levels are still reached
    const after = levelsAfter({ ...withList, base: r.base, planets: { [HOME]: r.steps } }, HOME);
    expect(after[1]).toBeGreaterThanOrEqual(10);
    expect(after[2]).toBeGreaterThanOrEqual(7);
    expect(after[21]).toBeGreaterThanOrEqual(2);
    // a given keep list: only those stay
    const only = optimize({ order: withList, hub, planet: HOME, targets: { buildings: { 21: 2 } }, keep: ['x2'], now: NOW }, { iterations: 100, seed: 5, newId: ids() });
    expect(only.steps.some((s) => s.id === 'p1')).toBe(false);
    expect(only.steps.some((s) => s.id === 'x2')).toBe(true);
    expect(() => optimize({ order: withList, hub, planet: HOME, targets: { buildings: { 21: 2 } }, keep: ['nope'], now: NOW }, { iterations: 10 })).toThrow(/keep/);
  });

  it('simulates the other planets as they are: their transports still arrive', () => {
    const hub = accountHub();
    const order = accountOrder(hub);
    const before = simulate(order, hub, { now: NOW }).steps.find((s) => s.id === 'tr')!;
    expect(before.state).toBe('planned');
    const r = optimize({ order, hub, planet: HOME, targets: { research: { 117: 3 } }, now: NOW, options: { includeExisting: false } }, { iterations: 100, seed: 2, newId: ids() });
    const after = simulate({ ...order, base: r.base, planets: { ...order.planets, [HOME]: r.steps } }, hub, { now: NOW });
    const tr = after.steps.find((s) => s.id === 'tr')!;
    expect(tr.state).toBe('planned');
    expect(tr.end).toBe(before.end);
    // the other lists stay as they are
    expect(after.steps.filter((s) => s.planet === COL2).every((s) => s.state === 'planned')).toBe(true);
    expect(r.finishAt).toBeLessThanOrEqual(r.baselineFinishAt);
  });

  it('counts steps that start in the quiet hours', () => {
    // 2026-11-17 22:30 UTC is 23:30 in Berlin: 7.5 h until 07:00
    const t = Date.UTC(2026, 10, 17, 22, 30) / 1000;
    expect(quietWait(t, 23, 7, 'Europe/Berlin')).toBe(7.5 * 3600);
    expect(quietWait(t, 0, 7, 'Europe/Berlin')).toBe(0);
    expect(quietWait(t, 23, 24, 'Europe/Berlin')).toBe(1800);
  });

  it('keeps the mines together with a mine ratio', () => {
    const { hub, order } = single();
    const input = { order, hub, planet: HOME, targets: { buildings: { 1: 14 } }, now: NOW };
    const r = optimize({ ...input, options: { mineRatio: { weight: 1e6 } } }, { iterations: 300, seed: 1, newId: ids() });
    const after = levelsAfter({ ...order, base: r.base, planets: { [HOME]: r.steps } }, HOME);
    // crystal at most 2 + 1 levels below metal, deuterium at most 3 below crystal
    expect(after[1] - after[2]).toBeLessThanOrEqual(3);
    expect(after[2] - after[3]).toBeLessThanOrEqual(3);
  });
});
