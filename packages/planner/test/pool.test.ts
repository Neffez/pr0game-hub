import { describe, expect, it } from 'vitest';
import {
  betterResult, OptimizeError, plannedKey, runOptimizeJob, standaloneInput, startOptimizePool, workerSeed, type OptimizeJobMessage, type OptimizeJobRequest,
  type OptimizeResult, type WorkerLike,
} from '../src/index.js';
import { HOME, hubOf, NOW, planetOf } from './optimizeFixture.js';

/** A worker that runs the job in this thread (after a tick, like a real one). */
function inlineWorker(log: number[] = []): WorkerLike {
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    terminate: () => void (w.onmessage = null),
    postMessage: (req: OptimizeJobRequest) => {
      log.push(req.seed!);
      setTimeout(() => runOptimizeJob(req, (m) => w.onmessage?.({ data: m })));
    },
  };
  return w;
}

const single = () => {
  const hub = hubOf([planetOf(HOME, { 1: 8, 2: 6, 3: 2, 4: 8, 14: 2, 31: 1, 22: 1, 23: 1, 24: 1 }, { 901: 3000, 902: 1500, 903: 300 })], { research: {} });
  return { hub, order: { base: { planets: { [HOME]: { ...hub.planets[0].planet.values } }, research: {} }, planets: { [HOME]: [] } } };
};

describe('auto plan job and pool', () => {
  it('runs a job and reports progress, the best plan and the result', () => {
    const { hub, order } = single();
    const messages: OptimizeJobMessage[] = [];
    runOptimizeJob({ input: { order, hub, planet: HOME, targets: { research: { 115: 2 } }, now: NOW }, iterations: 100, seed: 1 }, (m) => messages.push(m), { progressEveryMs: 0 });
    const done = messages.at(-1)!;
    expect(done.type).toBe('done');
    expect(messages.some((m) => m.type === 'best')).toBe(true);
    expect(messages.some((m) => m.type === 'progress')).toBe(true);
    if (done.type === 'done') expect(done.best.objective).toBeGreaterThan(NOW);
  });

  it('reports an input that cannot be planned as invalid', () => {
    const { hub, order } = single();
    const messages: OptimizeJobMessage[] = [];
    runOptimizeJob({ input: { order, hub, planet: HOME, targets: { research: { 115: 0 } }, now: NOW }, iterations: 10 }, (m) => messages.push(m));
    expect(messages).toEqual([expect.objectContaining({ type: 'error', invalid: true })]);
  });

  it('runs several workers with their own seeds and keeps the best plan', async () => {
    const { hub, order } = single();
    const seeds: number[] = [];
    const progress: number[] = [];
    const pool = startOptimizePool({
      request: { input: { order, hub, planet: HOME, targets: { research: { 115: 3 }, ships: { 202: 5 } }, now: NOW }, iterations: 200, seed: 5 },
      workers: 3,
      createWorker: () => inlineWorker(seeds),
      onProgress: (p) => progress.push(p.running),
    });
    const best = await pool.done;
    expect(seeds).toEqual([0, 1, 2].map((i) => workerSeed(5, i)));
    expect(new Set(seeds).size).toBe(3);
    expect(best).not.toBeNull();
    expect(best!.finishAt).toBeLessThanOrEqual(best!.greedyFinishAt);
    expect(progress.at(-1)).toBe(0);
  });

  it('rejects with the reason when the input cannot be planned, a stop keeps the best so far', async () => {
    const { hub, order } = single();
    const bad = startOptimizePool({ request: { input: { order, hub, planet: HOME, targets: {}, now: NOW }, iterations: 10 }, workers: 2, createWorker: () => inlineWorker() });
    await expect(bad.done).rejects.toBeInstanceOf(OptimizeError);
    const stopped = startOptimizePool({ request: { input: { order, hub, planet: HOME, targets: { research: { 115: 2 } }, now: NOW }, iterations: 10 }, createWorker: () => inlineWorker() });
    stopped.stop();
    expect(await stopped.done).toBeNull();
  });

  it('compares results by the objective, then the finish', () => {
    const r = (objective: number, finishAt: number) => ({ objective, finishAt }) as OptimizeResult;
    expect(betterResult(r(10, 5), r(9, 50))!.objective).toBe(9);
    expect(betterResult(r(10, 5), r(10, 4))!.finishAt).toBe(4);
    expect(betterResult(null, r(1, 1))).not.toBeNull();
  });

  it('plans a new planet without a hub', () => {
    const input = standaloneInput({ targets: { buildings: { 1: 5, 4: 4 } }, now: NOW });
    expect(input.planet).toBe(plannedKey(1));
    expect(input.hub.planets).toHaveLength(1);
    const messages: OptimizeJobMessage[] = [];
    runOptimizeJob({ input, iterations: 100, seed: 3 }, (m) => messages.push(m));
    const done = messages.at(-1)!;
    expect(done.type).toBe('done');
    if (done.type !== 'done') return;
    const built = (id: number) => done.best.steps.filter((s) => s.element === id).length;
    expect(built(1)).toBeGreaterThanOrEqual(5);
    expect(built(4)).toBeGreaterThanOrEqual(4);
    expect(done.best.finishAt).toBeGreaterThan(NOW);
  });

  it('builds the mine and its energy first where a resource has no income (a new planet has no deuterium)', () => {
    // small cargo: shipyard 2 needs the robotics factory, which costs 200 deuterium
    const input = standaloneInput({ targets: { ships: { 202: 5 } }, now: NOW });
    const messages: OptimizeJobMessage[] = [];
    runOptimizeJob({ input, iterations: 50, seed: 1 }, (m) => messages.push(m));
    const done = messages.at(-1)!;
    expect(done.type).toBe('done');
    if (done.type !== 'done') return;
    const at = (id: number) => done.best.steps.findIndex((s) => s.element === id);
    expect(at(3)).toBeGreaterThanOrEqual(0);
    expect(at(3)).toBeLessThan(at(14));
    expect(at(4)).toBeLessThan(at(14));
    expect(done.best.steps.filter((s) => s.element === 202).reduce((a, s) => a + (s.count ?? 1), 0)).toBe(5);
  });
});
