import {
  BUILDINGS, buildingCost, buildTime, capacityOf, labLevels, LOCKED_BY, NANITE_FACTORY, RESEARCH, RESEARCH_LAB, RESEARCH_NETWORK, requirementsOf,
  researchTime, resourceAt, ROBOT_FACTORY, SHIPS, SHIPYARD, shipyardTime, TECHNO_DOME,
} from '@pr0hub/core/buildings';
import { calibrate, productionOf } from '@pr0hub/core/production';
import { STORAGE, storageCapacity } from '@pr0hub/core/tech';
import { doneStateOf, targetsOf, type DoneState, type HubState } from './hub.js';
import type { BuildOrder, Step } from './types.js';

/**
 * Timeline of a build order from the hub's state now, like pr0plan's `GameReducer`: every planet works through its
 * list in order, a step starts as soon as its slot is free (the planet's build queue, the account's research, the
 * planet's shipyard), its requirements are met and the resources are there; the next step of the list waits until it
 * started. Research runs in parallel to the planet's buildings. Resources grow with the production of the planned
 * levels (the game's formulas, calibrated against the synced production) up to the storage, plus the synced fleets
 * landing and the transports of the build order. Steps the hub's levels already reach are skipped.
 */

export type StepState = 'done' | 'queued' | 'deactivated' | 'planned' | 'invalid';
/** What a step waited for last before it started, or why it can never start. */
export type WaitReason = 'resources' | 'slot' | 'research' | 'lab' | 'shipyard' | 'requirements' | 'storage' | 'max' | 'planet' | 'nolab' | 'horizon';

export interface StepResult {
  id: string;
  planet: string;
  /** target level or unit count (building, research, ship, defense) */
  target: number | null;
  state: StepState;
  /** epoch seconds the step starts and is finished (planned steps) */
  start: number | null;
  end: number | null;
  /** cost paid at the start */
  cost: Record<number, number> | null;
  wait: WaitReason | null;
  /** resources beyond the storage that have to come by transport (overflow), null when none */
  transport: Record<number, number> | null;
}

export interface Simulation {
  steps: StepResult[];
  /** hub planet key -> id of its next open step (planned or invalid), null when the list is through */
  next: Record<string, string | null>;
}

export interface SimulateOptions {
  now: number;
  /** stop planning this far ahead (seconds, default two years) */
  horizon?: number;
  /** ignore storage capacities (comparisons with pr0plan, which has none) */
  noStorage?: boolean;
}

const RES = [901, 902, 903] as const;
const MAX_EVENTS = 200_000;
/** batches of the shipyard become units in up to this many parts (satellites change the energy on the way) */
const SHIP_PARTS = 10;

interface Planet {
  key: string;
  type: 'planet' | 'moon';
  levels: Record<string, number>;
  res: Record<number, number>;
  rate: Record<number, number>;
  cap: Record<number, number>;
  /** capacities as synced, valid while the storage level is the synced one */
  syncedCap: { level: Record<number, number>; cap: Record<number, number> };
  temp: number;
  factors: Record<string, number>;
  calibration: Record<number, number>;
  /** build queue: target level, end */
  build: { id: number; level: number; end: number }[];
  /** shipyard parts: units done at `end` */
  shipyard: { id: number; count: number; end: number }[];
  arrivals: { at: number; resources: Record<number, number> }[];
  steps: Step[];
  head: number;
  /** a production step lets the list wait until then */
  waitUntil: number;
  /** last wait reason of the head step */
  wait: WaitReason | null;
}

interface Check {
  ok: boolean;
  wait?: WaitReason;
  /** nothing pending can change it: the step can never start */
  never?: boolean;
  /** when the resources are there, only when they are all that is missing */
  readyAt?: number;
}

export function simulate(order: BuildOrder, hub: HubState, o: SimulateOptions): Simulation {
  const targets = targetsOf(order);
  const resultById = new Map<string, StepResult>();
  const results: StepResult[] = [];
  const horizon = o.now + (o.horizon ?? 2 * 365 * 86400);
  const research = { ...hub.research };
  const researchQueue: { id: number; level: number; end: number; planet: string | null }[] = [];
  const resourceSpeed = (hub.resourceSpeed ?? 0) / 2500;
  const buildingSpeed = hub.buildingSpeed ?? 2500;
  const researchSpeed = hub.researchSpeed ?? 2500;
  const shipyardSpeed = hub.shipyardSpeed ?? buildingSpeed;
  const catchUp = hub.catchUp ?? 0;

  // ------------------------------------------------------------------ state from the hub
  const planets: Planet[] = [];
  for (const hp of hub.planets) {
    const bp = hp.planet;
    const t = Math.max(bp.time, 0);
    const levels: Record<string, number> = { ...bp.values };
    const res: Record<number, number> = {};
    const cap: Record<number, number> = {};
    const arrivals = hp.arrivals.map((a) => ({ at: a.at, amount: a.resources }));
    for (const r of RES) {
      cap[r] = capacityOf(bp, r, hub.storageFactor);
      const list = arrivals.map((a) => ({ at: a.at, amount: a.amount[r] ?? 0 })).filter((a) => a.amount > 0);
      res[r] = resourceAt(bp.resources[r] ?? 0, bp.perHour[r] ?? 0, cap[r], t, o.now, list);
    }
    const build: Planet['build'] = [];
    let end = o.now;
    for (const q of bp.queue) {
      // later entries start when the one before is done; without a known end the hub has no time: assume now
      end = q.end != null ? Math.max(q.end, o.now) : end;
      build.push({ id: q.id, level: levelOfQueue(q), end });
    }
    const shipyard: Planet['shipyard'] = [];
    let yard = o.now;
    for (const [id, n] of Object.entries(bp.shipyard ?? {})) {
      const unit = shipyardTime(buildingCost(Number(id), 1), levels[SHIPYARD] ?? 0, levels[NANITE_FACTORY] ?? 0, shipyardSpeed);
      yard += unit * n;
      shipyard.push({ id: Number(id), count: n, end: yard });
    }
    planets.push({
      key: hp.key, type: hp.type, levels, res, rate: { 901: 0, 902: 0, 903: 0 }, cap,
      syncedCap: { level: Object.fromEntries(RES.map((r) => [r, levels[STORAGE[r]] ?? 0])), cap: { ...cap } },
      temp: hp.temp ?? 0, factors: { ...(hp.factors ?? {}) }, calibration: { 901: 1, 902: 1, 903: 1 }, build, shipyard,
      arrivals: hp.arrivals.filter((a) => a.at > o.now).map((a) => ({ at: a.at, resources: a.resources })),
      steps: order.planets[hp.key] ?? [], head: 0, waitUntil: o.now, wait: null,
    });
  }
  for (const q of hub.researchQueue) {
    const prev = researchQueue[researchQueue.length - 1]?.end ?? o.now;
    researchQueue.push({ id: q.id, level: q.level, end: q.end != null ? Math.max(q.end, o.now) : prev, planet: null });
  }
  const byKey = new Map(planets.map((p) => [p.key, p]));

  // calibration: synced production against the formula for the synced levels
  const formulaSpeed = resourceSpeed || 1;
  const production = (p: Planet) =>
    p.type === 'moon'
      ? { 901: 0, 902: 0, 903: 0, energy: 0, energyUsed: 0 }
      : productionOf({ levels: p.levels, research, temp: p.temp, factors: p.factors, resourceSpeed: formulaSpeed });
  const known: Record<number, number[]> = { 901: [], 902: [], 903: [] };
  hub.planets.forEach((hp, i) => {
    const p = planets[i];
    if (p.type === 'moon' || !Object.keys(hp.planet.perHour).length) return;
    p.calibration = calibrate(hp.planet.perHour, production(p));
    for (const r of RES) if (hp.planet.perHour[r] != null && p.calibration[r] !== 1) known[r].push(p.calibration[r]);
  });
  hub.planets.forEach((hp, i) => {
    const p = planets[i];
    if (p.type === 'moon' || Object.keys(hp.planet.perHour).length) return;
    // no synced production: the others' factor (speed unknown), else the formula
    for (const r of RES) p.calibration[r] = !resourceSpeed && known[r].length ? median(known[r]) : 1;
  });
  const updateRate = (p: Planet) => {
    const prod = production(p);
    for (const r of RES) p.rate[r] = prod[r] * p.calibration[r];
  };
  const updateCap = (p: Planet) => {
    for (const r of RES) {
      const level = p.levels[STORAGE[r]] ?? 0;
      p.cap[r] = o.noStorage ? Infinity : level === p.syncedCap.level[r] ? p.syncedCap.cap[r] : storageCapacity(level, hub.storageFactor);
    }
  };
  planets.forEach((p) => {
    updateRate(p);
    updateCap(p);
  });

  // ------------------------------------------------------------------ steps
  const record = (p: Planet, s: Step, r: Omit<StepResult, 'id' | 'planet'>) => {
    const out = { id: s.id, planet: p.key, ...r };
    resultById.set(s.id, out);
    results.push(out);
  };
  /** skips the head steps that need no simulation (done, queued, deactivated) */
  const skip = (p: Planet) => {
    while (p.head < p.steps.length) {
      const s = p.steps[p.head];
      const target = targets.get(s.id) ?? null;
      const done: DoneState = doneStateOf(s, target ?? undefined, p.key, hub);
      if (s.deactivated) record(p, s, { target, state: 'deactivated', start: null, end: null, cost: null, wait: null, transport: null });
      else if (done !== 'open') record(p, s, { target, state: done, start: null, end: null, cost: null, wait: null, transport: null });
      else return;
      p.head++;
    }
  };
  planets.forEach(skip);

  const levelOf = (p: Planet, id: number) => p.build.reduce((l, q) => (q.id === id ? q.level : l), p.levels[id] ?? 0);
  const researchLevelOf = (id: number) => researchQueue.reduce((l, q) => (q.id === id ? q.level : l), research[id] ?? 0);
  /**
   * When the resources for `cost` are there. More than the storage holds: production stops at the capacity, but
   * fleets may bring more (overflow); landing fleets or a storage being built are waited for, else the rest is
   * assumed to come by transport once the storage is full (`overflow`, the start books it).
   */
  const ready = (p: Planet, cost: Record<number, number>, t: number): Check => {
    let at = t;
    let overflow = false;
    for (const r of RES) {
      const need = cost[r] ?? 0;
      if (need <= p.res[r] + 1e-9) continue;
      if (need > p.cap[r]) {
        const landing = p.arrivals.reduce((s, a) => s + (a.resources[r] ?? 0), 0);
        if (p.res[r] + landing >= need || p.build.some((q) => q.id === STORAGE[r])) return { ok: false, wait: 'storage' };
        overflow = true;
        if (p.res[r] < p.cap[r] && p.rate[r] > 0) at = Math.max(at, t + Math.ceil(((p.cap[r] - p.res[r]) / p.rate[r]) * 3600));
        continue;
      }
      if (p.rate[r] <= 0) return { ok: false, wait: 'resources' };
      at = Math.max(at, t + Math.ceil(((need - p.res[r]) / p.rate[r]) * 3600));
    }
    if (at > t) return { ok: false, wait: overflow ? 'storage' : 'resources', readyAt: at };
    return { ok: true, wait: overflow ? 'storage' : undefined };
  };
  const unmet = (p: Planet, id: number) => requirementsOf(id, p.levels, research).some((r) => r.own < r.need);
  /**
   * Requirements not met: whether what is running (build queue of the planet, research) or the next step of another
   * planet's list can still meet them; else the step can never start in this order.
   */
  const requirements = (p: Planet, id: number): Check => {
    const pending = requirementsOf(id, p.levels, research)
      .filter((r) => r.own < r.need)
      .every((r) =>
        r.id >= 100
          ? researchQueue.some((q) => q.id === r.id && q.level >= r.need) ||
            planets.some((x) => x !== p && x.steps[x.head]?.kind === 'research' && x.steps[x.head].element === r.id && researchLevelOf(r.id) + 1 >= r.need)
          : p.build.some((q) => q.id === r.id && q.level >= r.need),
      );
    return { ok: false, wait: 'requirements', never: !pending };
  };
  const labBuilding = () => planets.some((x) => x.build.some((q) => q.id === RESEARCH_LAB || q.id === TECHNO_DOME));

  const stepCost = (p: Planet, s: Step): Record<number, number> => {
    if (s.kind === 'building') return buildingCost(s.element!, levelOf(p, s.element!) + 1, catchUp);
    if (s.kind === 'research') return buildingCost(s.element!, researchLevelOf(s.element!) + 1, catchUp);
    if (s.kind === 'ship' || s.kind === 'defense') {
      const unit = buildingCost(s.element!, 1);
      return Object.fromEntries(Object.entries(unit).map(([r, v]) => [r, v * (s.count ?? 1)]));
    }
    if (s.kind === 'transport') return { ...s.transport!.resources };
    return {};
  };

  const check = (p: Planet, s: Step, t: number): Check => {
    if (p.waitUntil > t) return { ok: false, wait: 'slot' };
    const id = s.element!;
    switch (s.kind) {
      case 'building': {
        const meta = BUILDINGS[String(id)];
        if (!meta || !meta.on.includes(p.type)) return { ok: false, wait: 'planet', never: true };
        if (levelOf(p, id) + 1 > meta.max) return { ok: false, wait: 'max', never: true };
        if (unmet(p, id)) return requirements(p, id);
        if (p.build.length) return { ok: false, wait: 'slot' };
        if (LOCKED_BY[id] === 'shipyard' && p.shipyard.length) return { ok: false, wait: 'shipyard' };
        if (LOCKED_BY[id] === 'research' && researchQueue.length) return { ok: false, wait: 'research' };
        break;
      }
      case 'research': {
        const meta = RESEARCH[String(id)];
        if (!meta || p.type !== 'planet') return { ok: false, wait: 'planet', never: true };
        if (researchLevelOf(id) + 1 > meta.max) return { ok: false, wait: 'max', never: true };
        if (!(p.levels[RESEARCH_LAB] ?? 0)) return { ok: false, wait: 'nolab', never: !p.build.some((q) => q.id === RESEARCH_LAB) };
        if (unmet(p, id)) return requirements(p, id);
        if (researchQueue.length) return { ok: false, wait: 'research' };
        if (labBuilding()) return { ok: false, wait: 'lab' };
        break;
      }
      case 'ship':
      case 'defense': {
        if (!SHIPS[String(id)]) return { ok: false, wait: 'planet', never: true };
        if (unmet(p, id)) return requirements(p, id);
        if (p.build.some((q) => q.id === SHIPYARD || q.id === NANITE_FACTORY)) return { ok: false, wait: 'shipyard' };
        break;
      }
      case 'prod': {
        const w = s.prod!;
        if (w.awaitBuilding && p.build.length) return { ok: false, wait: 'slot' };
        if (w.awaitResearch && researchQueue.length) return { ok: false, wait: 'research' };
        if (w.awaitShipyard && p.shipyard.length) return { ok: false, wait: 'shipyard' };
        return { ok: true };
      }
      case 'transport':
        break;
    }
    return ready(p, stepCost(p, s), t);
  };

  const pay = (p: Planet, cost: Record<number, number>) => {
    for (const r of RES) p.res[r] = Math.max(0, p.res[r] - (cost[r] ?? 0));
  };

  const start = (p: Planet, s: Step, t: number) => {
    const target = targets.get(s.id) ?? null;
    const cost = stepCost(p, s);
    const id = s.element!;
    let end = t;
    switch (s.kind) {
      case 'building': {
        const robot = levelOf(p, ROBOT_FACTORY);
        const nanite = levelOf(p, NANITE_FACTORY);
        end = t + buildTime(cost, robot, nanite, buildingSpeed);
        p.build.push({ id, level: levelOf(p, id) + 1, end });
        break;
      }
      case 'research': {
        const others = planets.filter((x) => x !== p && x.type === 'planet').map((x) => x.levels[RESEARCH_LAB] ?? 0);
        const labs = labLevels(id, p.levels[RESEARCH_LAB] ?? 0, others, research[RESEARCH_NETWORK] ?? 0);
        end = t + researchTime(cost, labs, researchSpeed, p.levels[TECHNO_DOME] ?? 0, hub.universityFactor);
        researchQueue.push({ id, level: researchLevelOf(id) + 1, end, planet: p.key });
        break;
      }
      case 'ship':
      case 'defense': {
        const count = s.count ?? 1;
        const unit = shipyardTime(buildingCost(id, 1), p.levels[SHIPYARD] ?? 0, p.levels[NANITE_FACTORY] ?? 0, shipyardSpeed);
        let at = Math.max(t, p.shipyard[p.shipyard.length - 1]?.end ?? t);
        const parts = Math.min(count, SHIP_PARTS);
        let left = count;
        for (let i = 0; i < parts; i++) {
          const n = Math.ceil(left / (parts - i));
          left -= n;
          at += unit * n;
          p.shipyard.push({ id, count: n, end: at });
        }
        end = at;
        break;
      }
      case 'prod': {
        p.factors = { ...p.factors, ...s.prod!.factors };
        updateRate(p);
        end = t + s.prod!.wait;
        p.waitUntil = end;
        break;
      }
      case 'transport': {
        end = t + s.transport!.flight;
        const target = s.transport!.target ? byKey.get(s.transport!.target) : undefined;
        if (target) target.arrivals.push({ at: end, resources: { ...s.transport!.resources } });
        break;
      }
    }
    // beyond the storage: the rest comes by transport (overflow)
    const transport: Record<number, number> = {};
    for (const r of RES) {
      const short = (cost[r] ?? 0) - p.res[r];
      if (short > 1e-9) {
        transport[r] = Math.ceil(short);
        p.res[r] += short;
      }
    }
    pay(p, cost);
    record(p, s, {
      target, state: 'planned', start: t, end, cost: Object.keys(cost).length ? cost : null, wait: p.wait,
      transport: Object.keys(transport).length ? transport : null,
    });
    p.wait = null;
    p.head++;
    skip(p);
  };

  const invalid = (p: Planet, wait: WaitReason) => {
    const s = p.steps[p.head];
    record(p, s, { target: targets.get(s.id) ?? null, state: 'invalid', start: null, end: null, cost: null, wait, transport: null });
    p.wait = null;
    p.head++;
    skip(p);
  };

  // ------------------------------------------------------------------ event loop
  const advance = (dt: number) => {
    if (dt <= 0) return;
    for (const p of planets) {
      for (const r of RES) {
        if (p.rate[r] < 0) p.res[r] = Math.max(0, p.res[r] + (p.rate[r] * dt) / 3600);
        else if (p.res[r] < p.cap[r]) p.res[r] = Math.min(p.cap[r], p.res[r] + (p.rate[r] * dt) / 3600);
      }
    }
  };
  /** completes what ends at `t`; true when production may have changed */
  const complete = (t: number) => {
    let rates = false;
    let all = false;
    for (const p of planets) {
      while (p.build[0] && p.build[0].end <= t) {
        const q = p.build.shift()!;
        p.levels[q.id] = q.level;
        // later entries of a synced queue without a known end start now
        if (p.build[0] && p.build[0].end < t) p.build[0].end = t;
        rates = true;
        if (Object.values(STORAGE).includes(q.id)) updateCap(p);
        updateRate(p);
      }
      while (p.shipyard[0] && p.shipyard[0].end <= t) {
        const q = p.shipyard.shift()!;
        p.levels[q.id] = (p.levels[q.id] ?? 0) + q.count;
        if (q.id === 212) updateRate(p);
      }
      for (let i = p.arrivals.length - 1; i >= 0; i--) {
        if (p.arrivals[i].at > t) continue;
        for (const r of RES) p.res[r] += p.arrivals[i].resources[r] ?? 0;
        p.arrivals.splice(i, 1);
      }
    }
    while (researchQueue[0] && researchQueue[0].end <= t) {
      const q = researchQueue.shift()!;
      research[q.id] = q.level;
      all = true;
    }
    if (all) planets.forEach(updateRate);
    return rates || all;
  };

  let t = o.now;
  let events = 0;
  complete(t);
  while (events++ < MAX_EVENTS) {
    // start every head that can start now (one start may block or free another)
    let started = true;
    while (started) {
      started = false;
      for (const p of planets) {
        if (p.head >= p.steps.length) continue;
        const c = check(p, p.steps[p.head], t);
        if (c.ok) {
          if (c.wait) p.wait = c.wait;
          start(p, p.steps[p.head], t);
          started = true;
        } else if (c.never) {
          invalid(p, c.wait ?? 'requirements');
          started = true;
        } else p.wait = c.wait ?? null;
      }
    }
    const open = planets.filter((p) => p.head < p.steps.length);
    if (!open.length) break;
    // next event: something finishes, lands, a list stops waiting, or resources are there
    let next = Infinity;
    for (const p of planets) {
      if (p.build[0]) next = Math.min(next, p.build[0].end);
      if (p.shipyard[0]) next = Math.min(next, p.shipyard[0].end);
      for (const a of p.arrivals) next = Math.min(next, a.at);
      if (p.waitUntil > t) next = Math.min(next, p.waitUntil);
    }
    if (researchQueue[0]) next = Math.min(next, researchQueue[0].end);
    for (const p of open) {
      const c = check(p, p.steps[p.head], t);
      if (c.readyAt != null) next = Math.min(next, c.readyAt);
    }
    if (next === Infinity) {
      // nothing will change any more: the heads can never start
      for (const p of open) invalid(p, p.wait ?? 'resources');
      continue;
    }
    if (next > horizon) {
      for (const p of open) while (p.head < p.steps.length) invalid(p, 'horizon');
      break;
    }
    advance(next - t);
    t = next;
    complete(t);
  }

  // steps in list order per planet
  const steps: StepResult[] = [];
  const nextOf: Record<string, string | null> = {};
  for (const [key, list] of Object.entries(order.planets)) {
    nextOf[key] = null;
    for (const s of list) {
      const r = resultById.get(s.id) ?? {
        id: s.id, planet: key, target: targets.get(s.id) ?? null, state: 'invalid' as const, start: null, end: null, cost: null, wait: 'planet' as const, transport: null,
      };
      steps.push(r);
      if (nextOf[key] == null && (r.state === 'planned' || r.state === 'invalid')) nextOf[key] = s.id;
    }
  }
  return { steps, next: nextOf };
}

const levelOfQueue = (q: { level: number; destroy: boolean }) => (q.destroy ? q.level - 1 : q.level);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
