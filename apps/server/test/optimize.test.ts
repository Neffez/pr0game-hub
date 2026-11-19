import { validateBuildOrder } from '@pr0hub/planner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.WEB_DIR = '/nonexistent';

const { buildApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { OPTIMIZE_LIMITS } = await import('../src/optimize.js');

const db = openDb(':memory:');
const app = buildApp(db, { logger: false });
const t = Math.floor(Date.now() / 1000);
let group = 0;
const ids: Record<string, number> = {};
const h: Record<string, Record<string, string>> = {};
const HOME = '1:1:1:planet';

async function login(username: string) {
  const res = await app.inject({ method: 'POST', url: '/hub/api/auth/login', payload: { username, password: `${username}pass` } });
  return `hub_session=${res.cookies.find((c) => c.name === 'hub_session')!.value}`;
}
const call = (method: string, url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method: method as 'GET', url: `/hub/api${url}`, headers, payload });

const empire = {
  kind: 'empire', research: { 113: 1 },
  planets: [
    {
      name: 'Home', coords: { g: 1, s: 1, p: 1 }, type: 'planet', values: { 1: 10, 2: 7, 3: 3, 4: 12, 22: 3, 23: 3, 24: 2, 31: 1 }, fields: { used: 40, max: 163 },
      resources: { 901: 5000, 902: 3000, 903: 500 }, perHour: { 901: 3600, 902: 1500, 903: 400 }, building: null, temp: 40,
    },
  ],
};
const order = {
  base: { planets: { [HOME]: { 1: 10, 2: 7, 3: 3, 4: 12 } }, research: { 113: 1 } },
  planets: {
    [HOME]: [
      { id: 'a', kind: 'building', element: 1 },
      { id: 'tr', kind: 'transport', transport: { target: null, resources: { 901: 1000 }, flight: 600 } },
      { id: 'b', kind: 'building', element: 2 },
    ],
  },
};

/** polls a job until it is no longer running */
async function finished(job: string, headers: Record<string, string>) {
  for (let i = 0; i < 300; i++) {
    const res = (await call('GET', `/u8/build-order/optimize/${job}`, headers)).json();
    if (res.status !== 'running') return res;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the job did not end');
}

beforeAll(async () => {
  OPTIMIZE_LIMITS.minBudget = 1;
  await app.ready();
  for (const name of ['admin', 'carol', 'dave']) {
    db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)').run(name, hashPassword(`${name}pass`), name === 'admin' ? 1 : 0);
    ids[name] = db.prepare('SELECT id FROM users WHERE username = ?').pluck().get(name) as number;
  }
  const admin = { cookie: await login('admin') };
  await call('POST', '/admin/universes', admin, { slug: 'u8', name: 'Universum 8' });
  group = (await call('POST', '/admin/groups', admin, { universe: 'u8', name: 'A' })).json().id;
  for (const [name, ingame] of [['carol', 'Carol'], ['dave', 'Dave']]) {
    db.prepare('INSERT INTO group_members (group_id, user_id, ingame_name) VALUES (?, ?, ?)').run(group, ids[name], ingame);
    h[name] = { cookie: await login(name), 'x-hub-group': String(group) };
  }
  for (const name of ['carol', 'dave']) {
    db.prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)').run(group, ids[name], t - 600, JSON.stringify(empire));
  }
  expect((await call('PUT', '/u8/build-order', h.carol, { order })).statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe('build order search', () => {
  it('validates the request', async () => {
    const post = (payload: object) => call('POST', '/u8/build-order/optimize', h.carol, payload);
    expect((await post({ planet: HOME, targets: { buildings: { 99: 3 } }, budgetSeconds: 1 })).json().code).toBe('optimize_invalid');
    expect((await post({ planet: HOME, targets: { buildings: { 1: 5 } }, budgetSeconds: 1, options: { includeExisting: false } })).json()).toMatchObject({
      code: 'optimize_invalid', error: expect.stringMatching(/reached already/),
    });
    expect((await post({ planet: HOME, targets: { buildings: { 21: 2 } }, budgetSeconds: 1000 })).statusCode).toBe(400);
    expect((await post({ planet: HOME, targets: { buildings: { 21: 2 } }, keep: ['nope'], budgetSeconds: 1 })).statusCode).toBe(400);
    const elsewhere = await post({ planet: '1:2:3:planet', targets: { buildings: { 21: 2 } }, budgetSeconds: 1 });
    expect(elsewhere.statusCode).toBe(404);
    expect(elsewhere.json().code).toBe('optimize_planet_not_found');
  });

  it('runs a search, its steps are a valid list for the build order', async () => {
    const res = await call('POST', '/u8/build-order/optimize', h.carol, { planet: HOME, targets: { buildings: { 21: 2 }, research: { 115: 2 } }, budgetSeconds: 1, seed: 1 });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ job: expect.any(String), status: 'running' });
    const job = await finished(res.json().job, h.carol);
    expect(job).toMatchObject({ status: 'done', planet: HOME, revision: 1, error: null, endedAt: expect.any(Number) });
    expect(job.evaluations).toBeGreaterThan(0);
    const best = job.best;
    expect(best.finishAt).toBeLessThanOrEqual(best.baselineFinishAt);
    // the transport stays, the open buildings are still reached, the targets are reached
    expect(best.steps.some((s: { id: string }) => s.id === 'tr')).toBe(true);
    expect(best.timeline.length).toBe(best.steps.length);
    const checked = validateBuildOrder({ base: best.base, planets: { [HOME]: best.steps } });
    expect('order' in checked).toBe(true);
    const patched = await call('PATCH', '/u8/build-order', { ...h.carol, 'if-match': `"${job.revision}"` }, { planets: { [HOME]: best.steps }, base: best.base });
    expect(patched.statusCode).toBe(200);
    const timeline = (await call('GET', '/u8/build-order/timeline', h.carol)).json() as { steps: { id: string; state: string; target: number | null }[] };
    expect(timeline.steps.every((s) => s.state === 'planned')).toBe(true);
    const reached = (element: number) =>
      Math.max(...timeline.steps.filter((r) => best.steps.find((s: { id: string; element?: number }) => s.id === r.id)?.element === element).map((r) => r.target ?? 0));
    expect(reached(21)).toBe(2);
    expect(reached(115)).toBe(2);
    expect(reached(1)).toBeGreaterThanOrEqual(11);
    expect(reached(2)).toBeGreaterThanOrEqual(8);
  });

  it('takes targets with deadlines and reports every goal', async () => {
    const post = (payload: object) => call('POST', '/u8/build-order/optimize', h.carol, payload);
    expect((await post({ planet: HOME, targets: [{ element: 21 }], budgetSeconds: 1 })).json().code).toBe('optimize_invalid');
    expect((await post({ planet: HOME, targets: [{ element: 21, level: 2, weight: -1 }], budgetSeconds: 1 })).statusCode).toBe(400);
    expect((await post({ planet: HOME, targets: { buildings: { 21: 2 } }, options: { noLaterWeight: 'x' }, budgetSeconds: 1 })).statusCode).toBe(400);
    expect((await post({ planet: HOME, targets: { buildings: { 21: 2 } }, options: { keepTimeWeight: -1 }, budgetSeconds: 1 })).statusCode).toBe(400);
    expect((await post({ planet: HOME, targets: { buildings: { 21: 2 } }, options: { otherPlanetsWeight: -1 }, budgetSeconds: 1 })).statusCode).toBe(400);
    const by = t + 30 * 86400;
    const res = await post({
      planet: HOME, targets: [{ element: 21, level: 2, by, weight: 3 }, { element: 202, count: 2 }], budgetSeconds: 1, seed: 2,
      options: { noLater: true, noLaterWeight: 5, keepTimeWeight: 50, otherPlanetsWeight: 1 },
    });
    expect(res.statusCode).toBe(202);
    const job = await finished(res.json().job, h.carol);
    expect(job.status).toBe('done');
    const best = job.best;
    expect(best.targetsFinishAt).toBeLessThanOrEqual(best.finishAt);
    expect(best.currentFinishAt === null || typeof best.currentFinishAt === 'number').toBe(true);
    // without a current finish the answer says why, and the build order as it is gives a comparison
    if (best.currentFinishAt === null) expect(best.currentError).toEqual(expect.any(String));
    else expect(best.currentError).toBeNull();
    expect(best.asIsFinishAt === null || typeof best.asIsFinishAt === 'number').toBe(true);
    expect(best.goals.every((g: { planet: string; measure: string }) => g.planet === HOME && ['end', 'start'].includes(g.measure))).toBe(true);
    const shipyard = best.goals.find((g: { source: string; element: number }) => g.source === 'target' && g.element === 21);
    expect(shipyard).toMatchObject({ level: 2, by, weight: 3, step: null });
    expect(shipyard.currentEnd === null || typeof shipyard.currentEnd === 'number').toBe(true);
    expect(shipyard.end).toBeLessThanOrEqual(by);
    expect(best.goals.find((g: { element: number }) => g.element === 202)).toMatchObject({ level: 2, source: 'target', weight: 1 });
    // the small cargos stay one step of 2
    expect(best.steps.filter((s: { element?: number }) => s.element === 202).map((s: { count: number }) => s.count)).toEqual([2]);
  });

  it('allows one running search per member, only for that member; cancels', async () => {
    const res = await call('POST', '/u8/build-order/optimize', h.carol, { planet: HOME, targets: { buildings: { 21: 3 } }, budgetSeconds: 300 });
    expect(res.statusCode).toBe(202);
    const { job } = res.json();
    const again = await call('POST', '/u8/build-order/optimize', h.carol, { planet: HOME, targets: { buildings: { 21: 3 } }, budgetSeconds: 300 });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('optimize_job_running');
    expect((await call('GET', `/u8/build-order/optimize/${job}`, h.dave)).statusCode).toBe(404);
    expect((await call('DELETE', `/u8/build-order/optimize/${job}`, h.dave)).statusCode).toBe(404);
    const cancelled = await call('DELETE', `/u8/build-order/optimize/${job}`, h.carol);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ job, status: 'cancelled', endedAt: expect.any(Number) });
    expect((await call('GET', `/u8/build-order/optimize/${job}`, h.carol)).json().status).toBe('cancelled');
    expect((await call('GET', '/u8/build-order/optimize/unknown', h.carol)).statusCode).toBe(404);
  });

  it('runs at most the number of searches the server allows at a time', async () => {
    const concurrent = OPTIMIZE_LIMITS.concurrent;
    OPTIMIZE_LIMITS.concurrent = 1;
    try {
      const body = { planet: HOME, targets: { buildings: { 21: 3 } }, budgetSeconds: 300 };
      const first = await call('POST', '/u8/build-order/optimize', h.carol, body);
      expect(first.statusCode).toBe(202);
      // dave has no build order: his synced planet starts with an empty list
      const busy = await call('POST', '/u8/build-order/optimize', h.dave, body);
      expect(busy.statusCode).toBe(429);
      expect(busy.json().code).toBe('optimize_busy');
      await call('DELETE', `/u8/build-order/optimize/${first.json().job}`, h.carol);
      const res = await call('POST', '/u8/build-order/optimize', h.dave, { ...body, budgetSeconds: 1 });
      expect(res.statusCode).toBe(202);
      const job = await finished(res.json().job, h.dave);
      expect(job).toMatchObject({ status: 'done', revision: null });
      expect(job.best.steps.filter((s: { element?: number }) => s.element === 21)).toHaveLength(3);
    } finally {
      OPTIMIZE_LIMITS.concurrent = concurrent;
    }
  });

  it('keeps only the newest ended searches of a member', async () => {
    const body = { planet: HOME, targets: { buildings: { 21: 3 } }, budgetSeconds: 300 };
    const jobs: string[] = [];
    for (let i = 0; i < OPTIMIZE_LIMITS.keptPerMember + 2; i++) {
      const res = await call('POST', '/u8/build-order/optimize', h.dave, body);
      expect(res.statusCode).toBe(202);
      jobs.push(res.json().job);
      await call('DELETE', `/u8/build-order/optimize/${res.json().job}`, h.dave);
    }
    const status = await Promise.all(jobs.map(async (job) => (await call('GET', `/u8/build-order/optimize/${job}`, h.dave)).statusCode));
    expect(status).toEqual([...jobs.map((_, i) => (i < jobs.length - OPTIMIZE_LIMITS.keptPerMember ? 404 : 200))]);
  });

  it('works with a read-only API token', async () => {
    const token = (await call('POST', '/auth/tokens', { cookie: h.carol.cookie }, { name: 'agent' })).json().token;
    const bearer = { authorization: `Bearer ${token}`, 'x-hub-group': String(group) };
    // the token is read-only: the build order itself cannot be written
    expect((await call('PATCH', '/u8/build-order', { ...bearer, 'if-match': '*' }, { planets: {} })).json().code).toBe('read_only_token');
    const res = await call('POST', '/u8/build-order/optimize', bearer, { planet: HOME, targets: { buildings: { 21: 3 } }, budgetSeconds: 300 });
    expect(res.statusCode).toBe(202);
    expect((await call('GET', `/u8/build-order/optimize/${res.json().job}`, bearer)).statusCode).toBe(200);
    expect((await call('DELETE', `/u8/build-order/optimize/${res.json().job}`, bearer)).json().status).toBe('cancelled');
  });
});
