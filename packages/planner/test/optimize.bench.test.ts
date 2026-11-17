import { describe, it } from 'vitest';
import { optimize, simulate, type OptimizeTargets } from '../src/index.js';
import { evaluate } from '../src/optimize/evaluate.js';
import { greedyPlan } from '../src/optimize/greedy.js';
import { setupProblem } from '../src/optimize/problem.js';
import { accountHub, accountOrder, COL1, HOME, NOW } from './optimizeFixture.js';

/**
 * Measurements of the optimizer (not part of the normal run): `BENCH=1 pnpm exec vitest run test/optimize.bench.test.ts
 * --silent=false`. Prints evaluations per second and plain / greedy / optimized finish times for fixed seeds.
 * Variants to compare (environment): `EVALS` (stop after this many simulations, else `ITER` iterations, default 3000),
 * `SEEDS` (default 1,2,3), `GREEDY` (`score`: pr0plan's estimate, `rollout`), `ANNEAL_T` (start temperature in
 * seconds), `THROTTLE=0` (no production pass).
 */
const hours = (t: number) => ((t - NOW) / 3600).toFixed(2);

describe.skipIf(!process.env.BENCH)('optimizer measurements', () => {
  const hub = accountHub();
  const order = accountOrder(hub);

  it('evaluations per second', () => {
    const steps = Object.values(order.planets).reduce((n, l) => n + l.length, 0);
    const time = (label: string, fn: () => void, n = 200) => {
      fn();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) fn();
      const ms = (performance.now() - t0) / n;
      console.log(`${label}: ${ms.toFixed(2)} ms, ${(1000 / ms).toFixed(0)}/s`);
    };
    console.log(`order: ${steps} steps on ${Object.keys(order.planets).length} planets`);
    time('simulate (full timeline)', () => simulate(order, hub, { now: NOW }));
    time('simulate (lean)', () => simulate(order, hub, { now: NOW, lean: true }));
    const problem = setupProblem({ order, hub, planet: COL1, targets: { research: { 115: 4 }, ships: { 202: 10 } }, now: NOW });
    const greedy = greedyPlan(problem);
    time('evaluate (lean, stop at the targets)', () => evaluate(problem, greedy));
  });

  const cases: { name: string; planet: string; targets: OptimizeTargets }[] = [
    { name: 'COL1 small cargos', planet: COL1, targets: { research: { 115: 4 }, ships: { 202: 10 } } },
    { name: 'HOME mines', planet: HOME, targets: { buildings: { 1: 24, 2: 20, 3: 14 } } },
    { name: 'HOME impulse + heavy fighters', planet: HOME, targets: { research: { 117: 4 }, ships: { 205: 5 } } },
  ];
  const iterations = Number(process.env.ITER ?? 3000);
  for (const c of cases) {
    it(c.name, () => {
      for (const seed of (process.env.SEEDS ?? '1,2,3').split(',').map(Number)) {
        const t0 = performance.now();
        const r = optimize({ order, hub, planet: c.planet, targets: c.targets, now: NOW, options: { includeExisting: false, throttle: process.env.THROTTLE !== '0' } }, {
          iterations: process.env.EVALS ? Infinity : iterations, maxEvaluations: process.env.EVALS ? Number(process.env.EVALS) : undefined, seed,
          greedy: process.env.GREEDY as 'score' | 'rollout' | undefined,
          temperature: process.env.ANNEAL_T ? Number(process.env.ANNEAL_T) : undefined,
        });
        const ms = performance.now() - t0;
        console.log(
          `${c.name} seed ${seed}: plain ${hours(r.baselineFinishAt)} h, greedy ${hours(r.greedyFinishAt)} h, optimized ${hours(r.finishAt)} h, ` +
            `${r.evaluations} evaluations in ${(ms / 1000).toFixed(1)} s (${((r.evaluations / ms) * 1000).toFixed(0)}/s)`,
        );
      }
    }, 600_000);
  }
});
