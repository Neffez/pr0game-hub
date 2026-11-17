import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { OptimizeInput, OptimizeOptions, OptimizeResult, OptimizeTargets } from '@pr0hub/planner';
import type { UnitOverrides } from '@pr0hub/core/units';
import { HttpError } from './auth.js';

/**
 * Auto plan jobs (`/api/:uni/build-order/optimize`): the search for the fastest build order of one planet runs in a
 * worker thread (`optimize-worker.mjs`) for the budget the caller sets; the job and its best plan stay in memory for an
 * hour. A job belongs to the member and group that started it.
 */
export const OPTIMIZE_LIMITS = {
  minBudget: 5,
  maxBudget: 300,
  defaultBudget: 60,
  /** jobs and results are dropped this long after they ended (ms) */
  keepMs: 3_600_000,
  /** the worker is stopped this long after its budget, whatever it does (greedy plans of huge lists) */
  graceMs: 60_000,
  /** concurrent searches on the server: one core stays free */
  concurrent: Math.max(1, availableParallelism() - 1),
};

export interface OptimizeRequest {
  planet: string;
  targets: OptimizeTargets;
  keep: string[] | undefined;
  budgetSeconds: number;
  seed: number | undefined;
  options: OptimizeOptions;
}

const bad = (message: string) => new HttpError(400, 'optimize_invalid', message);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const KEY = /^\d{1,2}:\d{1,4}:\d{1,2}:(planet|moon)$/;

function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(`${what}: integer ${min}-${max}`);
  return v;
}

function num(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw bad(`${what}: number ${min}-${max}`);
  return v;
}

function bool(v: unknown, what: string): boolean | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'boolean') throw bad(`${what}: boolean`);
  return v;
}

/** Checks and normalizes the request body (the targets' ids and levels are checked against the game data later). */
export function parseOptimizeRequest(body: unknown): OptimizeRequest {
  if (!isObject(body)) throw bad('JSON object expected');
  if (typeof body.planet !== 'string' || !KEY.test(body.planet)) throw bad('planet: hub planet key "g:s:p:planet", "g:s:p:moon" or a planned planet "0:0:<n>:planet"');
  if (!isObject(body.targets)) throw bad('targets: { buildings, research, ships, defense }');
  const targets: OptimizeTargets = {};
  for (const group of ['buildings', 'research', 'ships', 'defense'] as const) {
    const raw = body.targets[group];
    if (raw == null) continue;
    if (!isObject(raw)) throw bad(`targets.${group}: element id -> level or count`);
    const out: Record<string, number> = {};
    for (const [id, v] of Object.entries(raw)) {
      if (!/^\d{1,3}$/.test(id)) throw bad(`targets.${group}: ${id} is not an element id`);
      out[id] = int(v, `targets.${group}.${id}`, 0, group === 'ships' || group === 'defense' ? 1e7 : 255);
    }
    targets[group] = out;
  }
  let keep: string[] | undefined;
  if (body.keep != null) {
    if (!Array.isArray(body.keep) || body.keep.length > 3000 || !body.keep.every((id) => typeof id === 'string')) throw bad('keep: step ids');
    keep = body.keep as string[];
  }
  const L = OPTIMIZE_LIMITS;
  const budgetSeconds = body.budgetSeconds == null ? L.defaultBudget : int(body.budgetSeconds, 'budgetSeconds', L.minBudget, L.maxBudget);
  const seed = body.seed == null ? undefined : int(body.seed, 'seed', 0, 2 ** 32 - 1);
  const options: OptimizeOptions = {};
  if (body.options != null) {
    if (!isObject(body.options)) throw bad('options: object');
    const o = body.options;
    options.economy = bool(o.economy, 'options.economy');
    options.throttle = bool(o.throttle, 'options.throttle');
    options.includeExisting = bool(o.includeExisting, 'options.includeExisting');
    if (o.forbid != null) {
      if (!Array.isArray(o.forbid) || o.forbid.length > 100) throw bad('options.forbid: element ids');
      options.forbid = o.forbid.map((id, i) => int(id, `options.forbid[${i}]`, 1, 999));
    }
    if (o.mineRatio != null) {
      if (!isObject(o.mineRatio)) throw bad('options.mineRatio: { crystalBelowMetal, deutBelowCrystal, tolerance, weight }');
      const m = o.mineRatio;
      options.mineRatio = {
        ...(m.crystalBelowMetal != null ? { crystalBelowMetal: int(m.crystalBelowMetal, 'options.mineRatio.crystalBelowMetal', 0, 50) } : {}),
        ...(m.deutBelowCrystal != null ? { deutBelowCrystal: int(m.deutBelowCrystal, 'options.mineRatio.deutBelowCrystal', 0, 50) } : {}),
        ...(m.tolerance != null ? { tolerance: int(m.tolerance, 'options.mineRatio.tolerance', 0, 50) } : {}),
        ...(m.weight != null ? { weight: num(m.weight, 'options.mineRatio.weight', 0, 1e7) } : {}),
      };
    }
    if (o.quietHours != null) {
      if (!isObject(o.quietHours)) throw bad('options.quietHours: { from, to, weight }');
      const q = o.quietHours;
      options.quietHours = {
        from: num(q.from, 'options.quietHours.from', 0, 24),
        to: num(q.to, 'options.quietHours.to', 0, 24),
        ...(q.weight != null ? { weight: num(q.weight, 'options.quietHours.weight', 0, 1e4) } : {}),
      };
    }
  }
  return { planet: body.planet, targets, keep, budgetSeconds, seed, options };
}

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface OptimizeJob {
  id: string;
  groupId: number;
  userId: number;
  planet: string;
  /** revision of the build order the search started from (null: none) */
  revision: number | null;
  status: JobStatus;
  phase: string;
  iteration: number;
  evaluations: number;
  startedAt: number;
  endedAt: number | null;
  budgetSeconds: number;
  best: OptimizeResult | null;
  error: string | null;
  worker: Worker | null;
  timer: NodeJS.Timeout | null;
}

const WORKER = new URL('../optimize-worker.mjs', import.meta.url);

/** The jobs of one server (in memory). */
export class OptimizeJobs {
  private jobs = new Map<string, OptimizeJob>();

  constructor(private workerUrl: URL | string = WORKER) {}

  /** Drops jobs that ended more than `keepMs` ago. */
  private sweep(now = Date.now()) {
    for (const [id, job] of this.jobs) if (job.endedAt != null && now - job.endedAt * 1000 > OPTIMIZE_LIMITS.keepMs) this.jobs.delete(id);
  }

  private running() {
    return [...this.jobs.values()].filter((j) => j.status === 'running');
  }

  /**
   * Starts a search: 409 while the member has one running, 429 when the server runs its maximum. `input` is what the
   * worker simulates (build order, hub state with the planned planets, universe settings), `units` the universe's
   * differences of the unit catalog.
   */
  start(owner: { groupId: number; userId: number }, req: OptimizeRequest, input: OptimizeInput, units: UnitOverrides, revision: number | null): OptimizeJob {
    this.sweep();
    if (this.running().some((j) => j.userId === owner.userId)) {
      throw new HttpError(409, 'optimize_job_running', 'You already have a search running: wait for it or cancel it (DELETE)');
    }
    if (this.running().length >= OPTIMIZE_LIMITS.concurrent) throw new HttpError(429, 'optimize_busy', 'The server runs as many searches as it can, try again in a moment');
    const job: OptimizeJob = {
      id: randomUUID(), groupId: owner.groupId, userId: owner.userId, planet: req.planet, revision, status: 'running', phase: 'greedy', iteration: 0,
      evaluations: 0, startedAt: Math.floor(Date.now() / 1000), endedAt: null, budgetSeconds: req.budgetSeconds, best: null, error: null, worker: null, timer: null,
    };
    // the worker builds the unit catalog from the universe's overrides
    const { units: _catalog, ...plain } = input;
    const worker = new Worker(this.workerUrl, { workerData: { input: plain, units, budgetMs: req.budgetSeconds * 1000, seed: req.seed } });
    job.worker = worker;
    const end = (status: JobStatus, error: string | null = null) => {
      if (job.status !== 'running') return;
      job.status = status;
      job.error = error;
      job.endedAt = Math.floor(Date.now() / 1000);
      job.worker = null;
      if (job.timer) clearTimeout(job.timer);
      void worker.terminate();
    };
    worker.on('message', (m: { type: string; best?: OptimizeResult; message?: string; phase?: string; iteration?: number; evaluations?: number }) => {
      if (m.type === 'progress') {
        job.phase = m.phase ?? job.phase;
        job.iteration = m.iteration ?? job.iteration;
        job.evaluations = m.evaluations ?? job.evaluations;
      } else if (m.type === 'best' || m.type === 'done') {
        job.best = m.best ?? job.best;
        if (job.best) {
          job.iteration = Math.max(job.iteration, job.best.iterations);
          job.evaluations = Math.max(job.evaluations, job.best.evaluations);
        }
        if (m.type === 'done') end('done');
      } else if (m.type === 'error') end('failed', m.message ?? 'The search failed');
    });
    worker.on('error', (err) => end('failed', err.message));
    worker.on('exit', (code) => end(job.best ? 'done' : 'failed', job.best ? null : `The search worker exited (${code})`));
    // a hard stop after the budget: what was found so far is the result
    job.timer = setTimeout(() => end(job.best ? 'done' : 'failed', job.best ? null : 'The search took too long'), req.budgetSeconds * 1000 + OPTIMIZE_LIMITS.graceMs);
    job.timer.unref();
    this.jobs.set(job.id, job);
    return job;
  }

  /** The job of this member in this group, 404 otherwise. */
  get(owner: { groupId: number; userId: number }, id: string): OptimizeJob {
    this.sweep();
    const job = this.jobs.get(id);
    if (!job || job.groupId !== owner.groupId || job.userId !== owner.userId) throw new HttpError(404, 'optimize_job_not_found', 'No such search');
    return job;
  }

  /** Cancels a running job (the best plan so far stays); an ended job stays as it is. */
  cancel(owner: { groupId: number; userId: number }, id: string): OptimizeJob {
    const job = this.get(owner, id);
    if (job.status === 'running') {
      job.status = 'cancelled';
      job.endedAt = Math.floor(Date.now() / 1000);
      if (job.timer) clearTimeout(job.timer);
      void job.worker?.terminate();
      job.worker = null;
    }
    return job;
  }

  /** Stops every worker (server shutdown). */
  close() {
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer);
      void job.worker?.terminate();
    }
    this.jobs.clear();
  }
}

/** The job as the API shows it. */
export function jobView(job: OptimizeJob) {
  return {
    job: job.id,
    status: job.status,
    planet: job.planet,
    revision: job.revision,
    phase: job.phase,
    iteration: job.iteration,
    evaluations: job.evaluations,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    budgetSeconds: job.budgetSeconds,
    error: job.error,
    best: job.best
      ? {
          finishAt: job.best.finishAt,
          baselineFinishAt: job.best.baselineFinishAt,
          greedyFinishAt: job.best.greedyFinishAt,
          steps: job.best.steps,
          base: job.best.base,
          timeline: job.best.timeline,
        }
      : null,
  };
}
