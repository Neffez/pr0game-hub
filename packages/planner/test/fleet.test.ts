import { describe, expect, it } from 'vitest';
import { optimize, simulate, type BuildOrder, type OptimizeResult } from '../src/index.js';
import { structureError } from '../src/optimize/evaluate.js';
import { setupProblem, type Item } from '../src/optimize/problem.js';
import { COLONY, fleetHub, fleetOrder, MAIN } from './fleetFixture.js';
import { hubOf, NOW, planetOf } from './optimizeFixture.js';

/** The optimizer on the main planet of a fleet player (the three runs of the report that led to priorities). */
const order = fleetOrder();
const hub = fleetHub(order);
const ids = () => {
  let n = 0;
  return () => `x${n++}`;
};
const run = (keep?: string[], extra: Partial<Parameters<typeof optimize>[0]> = {}, iterations = 300) =>
  optimize({ order, hub, planet: MAIN, targets: {}, keep, now: NOW, options: { forbid: [12, 212] }, ...extra }, { iterations, seed: 1, newId: ids() });
const timeOf = (r: OptimizeResult, id: string) => r.timeline.find((t) => t.id === id)!;
const goalOf = (r: OptimizeResult, step: string) => r.goals.find((x) => x.source !== 'target' && x.step === step);
/** the colony ship step of a result and the colonization */
const colonyShip = (r: OptimizeResult) => r.steps.find((s) => s.kind === 'ship' && s.element === 208)!;
const KEEP2 = ['probes', 'cruisers1', 'assault', 'cruisers2', 'astro2', 'astro3', 'colonyShip', 'colonize'];

describe('auto plan for a fleet player', () => {
  it('run 1 (default keep): ship steps stay steps of their own and end no later than now', () => {
    const r = run();
    const cruisers = r.steps.filter((s) => s.element === 206);
    expect(cruisers.map((s) => s.count)).toEqual([2, 2]);
    expect(r.steps.filter((s) => s.element === 225).map((s) => s.count)).toEqual([4]);
    // every ship step of the list is a goal with a deadline at its end now; the cruisers, probes and assault
    // transports end no later
    const ships = r.goals.filter((g) => g.source === 'existing' && [206, 210, 225].includes(g.element));
    expect(ships).toHaveLength(4);
    for (const g of ships) {
      expect(g.by).toBe(g.currentEnd);
      expect(g.end).toBeLessThanOrEqual(g.by!);
      expect(cruisers.concat(r.steps.filter((s) => s.element === 210 || s.element === 225)).some((s) => s.id === g.step)).toBe(true);
    }
    // the first two cruisers end before the next two
    expect(timeOf(r, cruisers[0].id).end!).toBeLessThan(timeOf(r, cruisers[1].id).end!);
    expect(goalOf(r, cruisers[0].id)?.level).toBe(2);
  });

  it('a transport never leaves before the colony ship it carries is built', () => {
    for (const keep of [undefined, KEEP2, ['colonyShip', 'astro2', 'astro3', 'colonize']]) {
      const r = run(keep);
      const ship = colonyShip(r);
      expect(r.steps.indexOf(ship)).toBeLessThan(r.steps.findIndex((s) => s.id === 'colonize'));
      expect(timeOf(r, 'colonize').start!).toBeGreaterThanOrEqual(timeOf(r, ship.id).end!);
    }
    // a tail with the colonization before the colony ship is invalid without simulating it
    const problem = setupProblem({ order, hub, planet: MAIN, targets: {}, now: NOW, options: { forbid: [12, 212] } });
    const tail: Item[] = problem.tail.map((step) => ({ step, kept: problem.kept.some((k) => k.step.id === step.id) }));
    expect(structureError(problem, tail)).toBeNull();
    const ship = tail.findIndex((it) => it.step.id === 'colonyShip');
    const moved = [...tail];
    const [it] = moved.splice(ship, 1);
    moved.push(it);
    expect(structureError(problem, moved)).toMatch(/transport colonize needs 1 of ship 208/);
  });

  it('run 2 (ships, astrophysics, colony ship and transports kept): their requirements come first, the plan is valid', () => {
    const r = run(KEEP2);
    expect(r.steps.filter((s) => KEEP2.includes(s.id)).map((s) => s.id)).toEqual(KEEP2);
    const sim = simulate({ ...order, base: r.base, planets: { ...order.planets, [MAIN]: r.steps } }, hub, { now: NOW });
    expect(sim.steps.filter((s) => s.planet === MAIN).every((s) => s.state === 'planned')).toBe(true);
    // the kept steps are goals of their own, with their end now as deadline
    expect(r.goals.filter((g) => g.source === 'kept').map((g) => g.step)).toEqual(KEEP2.filter((id) => id !== 'colonize'));
    // a kept step that can never get its requirement before it is refused clearly
    const bad: BuildOrder = { ...order, planets: { ...order.planets, [MAIN]: [{ id: 'cr', kind: 'ship', element: 206, count: 1 }, { id: 'imp', kind: 'research', element: 117 }] } };
    expect(() => optimize({ order: bad, hub, planet: MAIN, targets: {}, keep: ['cr', 'imp'], now: NOW }, { iterations: 10 })).toThrow(/needs/);
  });

  it('finishAt covers kept steps: the colonization landing', () => {
    // the targets are reached long before the colonization lands
    const r = run(undefined, { targets: { research: { 117: 3 } }, options: { forbid: [12, 212], includeExisting: false } }, 100);
    const landing = timeOf(r, 'colonize').end!;
    expect(r.targetsFinishAt).toBeLessThan(landing);
    expect(r.finishAt).toBeGreaterThanOrEqual(landing);
    expect(r.finishAt).toBe(Math.max(...r.timeline.map((t) => t.end ?? 0)));
    expect(r.goals).toEqual([expect.objectContaining({ element: 117, level: 3, source: 'target', step: null, end: r.targetsFinishAt })]);
    expect(r.steps.some((s) => s.transport?.target === COLONY)).toBe(true);
  });

  it('meets a deadline of a target when it can', () => {
    const single = hubOf([planetOf(MAIN, { 1: 10, 2: 8, 3: 4, 4: 10, 14: 2, 21: 2, 31: 1, 22: 2, 23: 2, 24: 1 }, { 901: 5000, 902: 3000, 903: 500 })], { research: { 113: 1, 115: 1 } });
    const empty: BuildOrder = { base: { planets: { [MAIN]: {} }, research: {} }, planets: { [MAIN]: [] } };
    const input = { order: empty, hub: single, planet: MAIN, now: NOW };
    // alone, the small cargos are done at `alone`
    const alone = optimize({ ...input, targets: [{ element: 202, count: 3 }] }, { iterations: 100, seed: 1 }).finishAt;
    const mines = [{ element: 1, level: 16 }, { element: 2, level: 13 }];
    const free = optimize({ ...input, targets: [...mines, { element: 202, count: 3 }] }, { iterations: 200, seed: 1 });
    const cargoFree = free.goals.find((g) => g.element === 202)!.end;
    expect(cargoFree).toBeGreaterThan(alone + 3600);
    const by = alone + 1800;
    const due = optimize({ ...input, targets: [...mines, { element: 202, count: 3, by, weight: 5 }] }, { iterations: 200, seed: 1 });
    const cargo = due.goals.find((g) => g.element === 202)!;
    expect(cargo).toMatchObject({ by, weight: 5, source: 'target' });
    expect(cargo.end).toBeLessThanOrEqual(by);
    // the mines are still reached
    expect(due.goals.filter((g) => g.element === 1 || g.element === 2).every((g) => g.end <= due.targetsFinishAt)).toBe(true);
  });
});
