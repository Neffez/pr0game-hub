import {
  BUILDINGS, buildingCost, buildTime, capacityOf, labLevels, LOCKED_BY, NANITE_FACTORY, RESEARCH, RESEARCH_LAB, RESEARCH_NETWORK, requirementsOf,
  researchTime, resourceAt, ROBOT_FACTORY, SHIPYARD, shipyardTime, TECHNO_DOME,
} from '@pr0hub/core/buildings';
import { activeUnits, withUnits, type UnitCatalog } from '@pr0hub/core/units';
import { calibrate, productionOf, SOLAR_SATELLITE } from '@pr0hub/core/production';
import { STORAGE, storageCapacity } from '@pr0hub/core/tech';
import { ASTROPHYSICS, planetLimit, type UniverseSettings } from '@pr0hub/core/universe';
import { distance, drivesFromResearch, fleetCapacity, fleetConsumption, flightDuration, slowestShip, SPEED_PERCENTS, type Coords } from '@pr0hub/flight';
import { doneStateOf, targetsOf, type DoneState, type HubState } from './hub.js';
import { planetStartResources } from '@pr0hub/core/universe';
import { isPlannedKey, plannedNumber } from './planned.js';
import { allOf, fixedOf, type BuildOrder, type Step, type TransportSettings } from './types.js';

/**
 * Timeline of a build order from the hub's state now, like pr0plan's `GameReducer`: every planet works through its
 * list in order, a step starts as soon as its slot is free (the planet's build queue, the account's research, the
 * planet's shipyard), its requirements are met and the resources are there; the next step of the list waits until it
 * started. Research runs in parallel to the planet's buildings. Resources grow with the production of the planned
 * levels (the game's formulas, calibrated against the synced production) up to the storage, plus the synced fleets
 * landing and the transports of the build order. Steps the hub's levels already reach are skipped.
 *
 * Transports with ships fly as long as the game's flight formula says (coordinates, the drives researched at the
 * departure, the universe's settings), pay the deuterium of the flight and carry at most their cargo space. A planned
 * planet that a colonization of the build order flies to is founded at its arrival (start resources plus the cargo);
 * the colonization waits until the astrophysics research that allows the planet is done at the arrival. When that
 * research is only further down a list, the ship leaves without blocking the list and its arrival is set once the
 * research starts: it lands right after the research is done, at the slowest speed that makes it (automatic, the
 * step has no speed) or at the step's own speed, leaving as late as it can. Transports and deployments to such a
 * planet leave only once it is founded. A checked-off colonization whose planet is not synced yet founds it when its
 * colony ship lands (`hub.colonizing`), with the fleet's cargo; once landed (or without a synced fleet) the planet
 * works from now on with its start resources plus the cargo (the fleet's, else the step's fixed amounts).
 *
 * Planned planets are start planets or colonies to come. While the hub has no synced planet of the member, the first
 * `maxInitialPlanets` planned planets without a colonization (by number; pr0plan's planet 1 is the home planet) are
 * the start planets: they exist from the start. A colony to come with an open colonization exists once it lands. One
 * without a colonization (`unscheduled`) still works through its list from now on, so an imported plan shows its
 * timeline, but it never counts against the astrophysics planet limit; one without steps and without transports to
 * it (an empty placeholder) is not simulated at all.
 */

export type StepState = 'done' | 'queued' | 'deactivated' | 'planned' | 'invalid';
/** What a step waited for last before it started, or why it can never start. */
export type WaitReason =
  | 'resources' | 'slot' | 'research' | 'lab' | 'shipyard' | 'requirements' | 'storage' | 'max' | 'planet' | 'nolab' | 'horizon' | 'aborted'
  /** transports: the set departure or arrival time, more cargo than the ships hold, astrophysics for the colony */
  | 'time' | 'cargo' | 'astro'
  /** a planned planet that is not colonized yet */
  | 'colony';

export interface StepResult {
  id: string;
  planet: string;
  /** target level or unit count (building, research, ship, defense) */
  target: number | null;
  state: StepState;
  /** epoch seconds the step starts and is finished (planned steps) */
  start: number | null;
  end: number | null;
  /** cost paid at the start (not with the option `lean`) */
  cost: Record<number, number> | null;
  wait: WaitReason | null;
  /** resources beyond the storage that have to come by transport (overflow), null when none */
  transport: Record<number, number> | null;
  /**
   * Storages that ran full while the planet's list waited for this step: since when (epoch seconds) and how much
   * production was lost beyond the capacity until the step started; null when none ran full
   */
  full: Record<number, { since: number; lost: number }> | null;
  /** deuterium of the flight, part of `cost` (transports with ships) */
  fuel?: number;
  /** colonizations without their own speed: the speed (percent) to fly at so the ship lands after the astrophysics, when below 100 */
  speed?: number;
  /** planned steps: resources on the planet at the start, right before paying and after (whole units) */
  before?: Record<number, number>;
  after?: Record<number, number>;
  /**
   * planned steps on a planet with production: energy left over (negative: short) at the start and once what is
   * queued on the planet up to this step is finished (buildings, solar satellites, research such as energy technology)
   */
  energy?: { before: number; after: number };
  /** production steps: production per hour (901-903, calibrated like the timeline) and energy balance before and after */
  production?: { before: ProductionRates; after: ProductionRates };
}

/** metal, crystal, deuterium per hour and the energy left over (negative: short), rounded */
export interface ProductionRates {
  901: number;
  902: number;
  903: number;
  energy: number;
}

export interface Simulation {
  steps: StepResult[];
  /** hub planet key -> id of its next open step (planned or invalid), null when the list is through */
  next: Record<string, string | null>;
  /**
   * planned planets of the build order that are neither a start planet nor founded by a colonization of the build
   * order: their steps are simulated from now on but they do not count as planets (empty ones are not simulated)
   */
  unscheduled: string[];
  /** the state where the loop ended (option `state`) */
  final?: SimState;
}

/** The simulation's state at one moment (searches that continue from a planned prefix, see `optimize`). */
export interface SimState {
  t: number;
  /** research levels finished and the research queue */
  research: Record<string, number>;
  researchQueue: { id: number; level: number; end: number }[];
  resourceSpeed: number;
  planets: Record<string, SimPlanetState>;
}

export interface SimPlanetState {
  type: 'planet' | 'moon';
  active: boolean;
  levels: Record<string, number>;
  build: { id: number; level: number; end: number }[];
  shipyard: { id: number; count: number; end: number }[];
  res: Record<number, number>;
  /** production per hour now (calibrated) */
  rate: Record<number, number>;
  cap: Record<number, number>;
  temp: number;
  factors: Record<string, number>;
  calibration: Record<number, number>;
}

export interface SimulateOptions {
  now: number;
  /** stop planning this far ahead (seconds, default two years) */
  horizon?: number;
  /** ignore storage capacities (comparisons with pr0plan, which has none) */
  noStorage?: boolean;
  /** ships and defense of the universe (default: the active catalog) */
  units?: UnitCatalog;
  /** safety cap of the event loop (default 200 000); steps left when it hits are invalid with wait 'aborted' */
  maxEvents?: number;
  /** the universe's settings: flight times of transports with ships, the planet limit of colonizations */
  universe?: UniverseSettings;
  /**
   * Stop once these steps all started (`at: 'start'`) or, with `at: 'end'`, also the time reached their ends; steps
   * not simulated by then are left out of `steps` (searches that only need some steps, see `optimize`)
   */
  stop?: { ids: string[]; at: 'start' | 'end' };
  /** leave out what only the timeline's display needs: energy, resources before and after, full storages, production rates */
  lean?: boolean;
  /** return the state where the loop ended as `final` */
  state?: boolean;
}

const RES = [901, 902, 903] as const;
const STORAGE_IDS = new Set(Object.values(STORAGE));
const MAX_EVENTS = 200_000;
/** batches of the shipyard become units in up to this many parts (satellites change the energy on the way) */
const SHIP_PARTS = 10;
/** a colonization lands this many seconds after the astrophysics that allows its planet is done, not in the same second */
export const ASTRO_MARGIN = 10;

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
  /** `found`: a colonization, the planet exists from then on */
  arrivals: { at: number; resources: Record<number, number>; found?: boolean }[];
  /** where it is (flights), null when unknown */
  coords: Coords | null;
  /** false: a planned planet before its colonization arrives (no production, no steps) */
  active: boolean;
  /** counts against the astrophysics planet limit once active (false: a planned colony without a colonization) */
  counts: boolean;
  /** resources it is founded with */
  founded: Record<number, number>;
  steps: Step[];
  head: number;
  /** a production step lets the list wait until then */
  waitUntil: number;
  /** a deferred colonization flies here, its arrival is not set yet */
  founding: boolean;
  /** last wait reason of the head step */
  wait: WaitReason | null;
  /** storages full while the head step waits: since when, production lost beyond the capacity */
  full: Record<number, { since: number; lost: number }>;
}

interface Check {
  ok: boolean;
  wait?: WaitReason;
  /** nothing pending can change it: the step can never start */
  never?: boolean;
  /** when the resources are there, only when they are all that is missing */
  readyAt?: number;
  /** a colonization that starts now and gets its arrival once the astrophysics further down a list starts */
  defer?: boolean;
}

export function simulate(order: BuildOrder, hub: HubState, o: SimulateOptions): Simulation {
  return withUnits(o.units, () => run(order, hub, o));
}

function run(order: BuildOrder, hub: HubState, o: SimulateOptions): Simulation {
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
  const records = hub.catchUpRecords ?? {};
  const homePlanet = hub.planets.find((p) => p.type === 'planet' && p.coords.g > 0)?.planet ?? null;
  const newPlanetResources = planetStartResources(o.universe, homePlanet);

  // ------------------------------------------------------------------ state from the hub
  const colonized = new Set<string>();
  /** planned planets whose colonization is checked off: flown, the planet exists (not synced yet) */
  const flown = new Set<string>();
  /** the fixed cargo of the checked-off colonizations, by planned planet */
  const flownCargo = new Map<string, Record<number, number>>();
  const targeted = new Set<string>();
  for (const list of Object.values(order.planets))
    for (const s of list) {
      const target = s.transport?.target;
      if (!target || s.deactivated) continue;
      targeted.add(target);
      if (s.transport!.mission === 'colonize') (s.done ? flown : colonized).add(target);
      if (s.transport!.mission === 'colonize' && s.done) flownCargo.set(target, fixedOf(s.transport!));
    }
  const { unscheduled } = plannedRoles(order, hub, new Set([...colonized, ...flown]), o.universe);
  // empty placeholders (no steps, no transports to them) are not simulated
  const hubPlanets = hub.planets.filter((hp) => !unscheduled.includes(hp.key) || (order.planets[hp.key]?.length ?? 0) > 0 || targeted.has(hp.key));
  const planets: Planet[] = [];
  for (const hp of hubPlanets) {
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
    const at = order.planned?.[hp.key]?.coords ?? (hp.coords.g > 0 ? hp.coords : null);
    // a checked-off colonization of a planet not synced yet: its colony ship lands (synced fleet) or has landed
    const landing = flown.has(hp.key) && isPlannedKey(hp.key) && at ? colonizingTo(hub, at) : null;
    const pending: Planet['arrivals'] = [];
    if (landing && landing.at > o.now) pending.push({ at: landing.at, resources: { ...landing.resources }, found: true });
    else if (flown.has(hp.key) && isPlannedKey(hp.key)) {
      // landed: the planet has its start resources plus the cargo (that of the fleet, else the step's fixed amounts)
      const cargo = landing?.resources ?? flownCargo.get(hp.key) ?? {};
      for (const r of RES) res[r] += cargo[r] ?? 0;
    }
    // a planned planet with a colonization still to fly (or flying) is founded by it; start planets and unscheduled
    // colonies work from now on (the latter without counting as a planet)
    const active = !(isPlannedKey(hp.key) && (colonized.has(hp.key) || pending.length));
    const founded = active ? {} : newPlanetResources;
    planets.push({
      key: hp.key, type: hp.type, levels, res: active ? res : { 901: 0, 902: 0, 903: 0 }, rate: { 901: 0, 902: 0, 903: 0 }, cap,
      coords: at ? [at.g, at.s, at.p] : null, active, founded, counts: !unscheduled.includes(hp.key),
      syncedCap: { level: Object.fromEntries(RES.map((r) => [r, levels[STORAGE[r]] ?? 0])), cap: { ...cap } },
      temp: hp.temp ?? 0, factors: { ...(hp.factors ?? {}) }, calibration: { 901: 1, 902: 1, 903: 1 }, build, shipyard,
      arrivals: [...hp.arrivals.filter((a) => a.at > o.now).map((a) => ({ at: a.at, resources: a.resources })), ...pending],
      steps: order.planets[hp.key] ?? [], head: 0, waitUntil: o.now, founding: false, wait: null, full: {},
    });
  }
  for (const q of hub.researchQueue) {
    const prev = researchQueue[researchQueue.length - 1]?.end ?? o.now;
    researchQueue.push({ id: q.id, level: q.level, end: q.end != null ? Math.max(q.end, o.now) : prev, planet: null });
  }
  const byKey = new Map(planets.map((p) => [p.key, p]));
  /**
   * Transports of the lists that have not left yet, per target and resource they may carry: a step that costs more
   * than the storage holds waits for them before it assumes the rest comes by transport (`ready`).
   */
  const incoming = new Map<string, Record<number, number>>();
  const inboundOf = (p: Planet, s: Step) => {
    const tr = s.transport;
    if (s.kind !== 'transport' || !tr?.target || tr.target === p.key || s.deactivated || tr.mission === 'colonize') return null;
    const fixed = fixedOf(tr);
    const all = allOf(tr);
    return { target: tr.target, res: RES.filter((r) => all.includes(r) || (fixed[r] ?? 0) > 0) };
  };
  for (const p of planets)
    for (const s of p.steps) {
      const inbound = inboundOf(p, s);
      if (!inbound) continue;
      const c = incoming.get(inbound.target) ?? { 901: 0, 902: 0, 903: 0 };
      for (const r of inbound.res) c[r]++;
      incoming.set(inbound.target, c);
    }
  const departed = new Set<string>();
  /** a transport of the lists left (or never will): it no longer counts as coming */
  const leave = (p: Planet, s: Step) => {
    const inbound = inboundOf(p, s);
    if (!inbound || departed.has(s.id)) return;
    departed.add(s.id);
    const c = incoming.get(inbound.target)!;
    for (const r of inbound.res) c[r]--;
  };

  // calibration: synced production against the formula for the synced levels
  const formulaSpeed = resourceSpeed || 1;
  const production = (p: Planet) =>
    p.type === 'moon' || !p.active
      ? { 901: 0, 902: 0, 903: 0, energy: 0, energyUsed: 0 }
      : productionOf({ levels: p.levels, research, temp: p.temp, factors: p.factors, resourceSpeed: formulaSpeed });
  const known: Record<number, number[]> = { 901: [], 902: [], 903: [] };
  hubPlanets.forEach((hp, i) => {
    const p = planets[i];
    if (p.type === 'moon' || !Object.keys(hp.planet.perHour).length) return;
    p.calibration = calibrate(hp.planet.perHour, production(p));
    for (const r of RES) if (hp.planet.perHour[r] != null && p.calibration[r] !== 1) known[r].push(p.calibration[r]);
  });
  hubPlanets.forEach((hp, i) => {
    const p = planets[i];
    if (p.type === 'moon' || Object.keys(hp.planet.perHour).length) return;
    // no synced production: the others' factor (speed unknown), else the formula
    for (const r of RES) p.calibration[r] = !resourceSpeed && known[r].length ? median(known[r]) : 1;
  });
  const ratesOf = (p: Planet): ProductionRates => {
    const prod = production(p);
    return { 901: Math.round(p.rate[901]), 902: Math.round(p.rate[902]), 903: Math.round(p.rate[903]), energy: Math.round(prod.energy - prod.energyUsed) };
  };
  /** energy left over of a planet, with its queued buildings and satellites and the queued research when `queued` */
  const energyOf = (p: Planet, queued = false): number | null => {
    if (p.type === 'moon' || !p.active) return null;
    let levels = p.levels;
    let res = research;
    if (queued) {
      levels = { ...p.levels };
      for (const q of p.build) levels[q.id] = q.level;
      for (const q of p.shipyard) if (q.id === SOLAR_SATELLITE) levels[q.id] = (levels[q.id] ?? 0) + q.count;
      res = { ...research };
      for (const q of researchQueue) res[q.id] = q.level;
    }
    const prod = productionOf({ levels, research: res, temp: p.temp, factors: p.factors, resourceSpeed: formulaSpeed });
    return Math.round(prod.energy - prod.energyUsed);
  };
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
  const stopIds = o.stop ? new Set(o.stop.ids) : null;
  let stopLeft = stopIds?.size ?? 0;
  let stopEnd = -Infinity;
  const record = (p: Planet, s: Step, r: Omit<StepResult, 'id' | 'planet'>) => {
    const out = { id: s.id, planet: p.key, ...r };
    leave(p, s);
    if (stopIds?.has(s.id) && !resultById.has(s.id)) {
      stopLeft--;
      if (r.end != null) stopEnd = Math.max(stopEnd, r.end);
    }
    resultById.set(s.id, out);
    results.push(out);
  };
  /** skips the head steps that need no simulation (done, queued, deactivated) */
  const skip = (p: Planet) => {
    while (p.head < p.steps.length) {
      const s = p.steps[p.head];
      const target = targets.get(s.id) ?? null;
      const done: DoneState = doneStateOf(s, target ?? undefined, p.key, hub);
      if (s.deactivated) record(p, s, { target, state: 'deactivated', start: null, end: null, cost: null, wait: null, transport: null, full: null });
      else if (done !== 'open') record(p, s, { target, state: done, start: null, end: null, cost: null, wait: null, transport: null, full: null });
      else return;
      p.head++;
    }
  };
  planets.forEach(skip);

  const levelOf = (p: Planet, id: number) => p.build.reduce((l, q) => (q.id === id ? q.level : l), p.levels[id] ?? 0);
  const researchLevelOf = (id: number) => researchQueue.reduce((l, q) => (q.id === id ? q.level : l), research[id] ?? 0);
  /**
   * When the resources for `cost` are there. More than the storage holds: production stops at the capacity, but
   * fleets may bring more (overflow); landing fleets, transports of the lists to the planet that have not left yet
   * and a storage being built are waited for, else the rest is assumed to come by transport once the storage is full
   * (`overflow`, the start books it).
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
        // not enough: still wait for what is landing and for transports yet to leave, assume only what is left after
        if (landing > 0 || (incoming.get(p.key)?.[r] ?? 0) > 0) return { ok: false, wait: 'storage' };
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
  /** Open research steps of `id` still ahead in the lists of the other planets (each raises it by one level). */
  const plannedResearch = (p: Planet, id: number) =>
    planets.reduce(
      (n, x) =>
        x === p
          ? n
          : n +
            x.steps
              .slice(x.head)
              .filter((s) => s.kind === 'research' && s.element === id && !s.deactivated && doneStateOf(s, targets.get(s.id) ?? undefined, x.key, hub) === 'open')
              .length,
      0,
    );
  /**
   * Requirements not met: whether what is running (build queue of the planet, research) or the research steps still
   * ahead in the other planets' lists can meet them; else the step can never start in this order. (Steps of other
   * lists that are stuck themselves end as invalid once nothing changes any more.)
   */
  const requirements = (p: Planet, id: number): Check => {
    const pending = requirementsOf(id, p.levels, research)
      .filter((r) => r.own < r.need)
      .every((r) =>
        r.id >= 100
          ? researchLevelOf(r.id) + plannedResearch(p, r.id) >= r.need
          : p.build.some((q) => q.id === r.id && q.level >= r.need),
      );
    return { ok: false, wait: 'requirements', never: !pending };
  };
  const labBuilding = () => planets.some((x) => x.build.some((q) => q.id === RESEARCH_LAB || q.id === TECHNO_DOME));

  /** Where a planet key lies: the simulated planet's coordinates, else the key's own (a planet of somebody else). */
  const coordsOf = (key: string): Coords | null => {
    const known = byKey.get(key);
    if (known) return known.coords;
    const [g, s, pos] = key.split(':').map(Number);
    return g > 0 ? [g, s, pos] : null;
  };
  /**
   * Flight of a transport leaving now: seconds, deuterium and the cargo space left for resources (null: unknown,
   * no ships named). Without ships, coordinates or universe settings the step's own flight time counts.
   */
  const flightOf = (p: Planet, tr: TransportSettings): { flight: number; fuel: number; capacity: number | null } => {
    const ships = tr.ships;
    if (!ships) return { flight: tr.flight, fuel: 0, capacity: null };
    const catalog = activeUnits();
    const capacity = fleetCapacity(ships, false, catalog.capacity);
    const to = tr.target ? coordsOf(tr.target) : null;
    const u = o.universe;
    const drives = drivesFromResearch(research);
    const slowest = slowestShip(ships, drives, catalog.drives);
    if (!u || !p.coords || !to || !slowest) return { flight: tr.flight, fuel: 0, capacity };
    const dist = distance(u, p.coords, to);
    const duration = flightDuration(u, dist, slowest.speed, tr.speed ?? 100);
    const fuel = fleetConsumption(u, ships, duration, dist, drives, 1, catalog.drives);
    return { flight: Math.floor(duration), fuel, capacity: capacity - fuel };
  };
  /**
   * What a transport loads: its fixed amounts, then of the resources in `all` what is on the planet (after the fuel
   * and the fixed amounts) up to the cargo space left, in the order metal, crystal, deuterium (the game's "max" links).
   */
  const loadOf = (p: Planet, tr: TransportSettings, f: { fuel: number; capacity: number | null }): Record<number, number> => {
    const fixed = fixedOf(tr);
    const out: Record<number, number> = { 901: fixed[901] ?? 0, 902: fixed[902] ?? 0, 903: fixed[903] ?? 0 };
    let space = (f.capacity ?? Infinity) - RES.reduce((n, r) => n + out[r], 0);
    for (const r of allOf(tr)) {
      const there = Math.max(0, Math.floor(p.res[r] - (r === 903 ? f.fuel : 0)));
      out[r] = Math.max(0, Math.min(there, space));
      space -= out[r];
    }
    return out;
  };
  /**
   * When the planet's shipyard has built the transport's ships it lacks (0: nothing to wait for). Ships it lacks
   * without any in the shipyard are not checked (they may come by fleet).
   */
  const shipsReady = (p: Planet, tr: TransportSettings) => {
    let at = 0;
    for (const [id, n] of Object.entries(tr.ships ?? {})) {
      let have = p.levels[id] ?? 0;
      if (have >= n) continue;
      for (const q of p.shipyard) {
        if (String(q.id) !== id) continue;
        have += q.count;
        if (have >= n) {
          at = Math.max(at, q.end);
          break;
        }
      }
    }
    return at;
  };
  const astroAt = (t: number) => researchQueue.reduce((l, q) => (q.id === ASTROPHYSICS && q.end <= t ? Math.max(l, q.level) : l), research[ASTROPHYSICS] ?? 0);
  /** planets the account has or is founding (`pending`: with the deferred colonizations) */
  const planetCount = (pending = true) =>
    planets.filter((x) => x.type === 'planet' && x.counts && (x.active || x.arrivals.some((a) => a.found) || (pending && x.founding))).length;
  /** whether the astrophysics running and still ahead in the lists (after `p`'s head) allow more than `count` planets */
  const astroAhead = (p: Planet, count: number) => {
    let level = researchLevelOf(ASTROPHYSICS);
    for (const x of planets)
      for (const s of x.steps.slice(x === p ? x.head + 1 : x.head))
        if (s.kind === 'research' && s.element === ASTROPHYSICS && !s.deactivated && doneStateOf(s, targets.get(s.id) ?? undefined, x.key, hub) === 'open') level++;
    return (planetLimit(o.universe!, level) ?? Infinity) > count;
  };
  /** colonizations that left before the astrophysics allowing their planet started, in order */
  const deferred: {
    from: Planet; target: Planet; at: number; load: Record<number, number>; fuel: number;
    /** flight at each speed (only the step's own when it has one), fastest first */
    options: { speed: number; flight: number; fuel: number }[];
    result: StepResult | null;
  }[] = [];
  /** sets the arrival of the deferred colonizations whose astrophysics is now running: right after it is done */
  const resolveDeferred = () => {
    while (deferred.length) {
      const d = deferred[0];
      const count = planetCount(false);
      const q = researchQueue.find((x) => x.id === ASTROPHYSICS && (planetLimit(o.universe!, x.level) ?? 0) > count);
      if (!q) return;
      deferred.shift();
      const want = q.end + ASTRO_MARGIN;
      const fastest = d.options[0];
      // the slowest speed that still makes it, leaving so late that it lands right after the research
      // (speeds come in steps of 10 %: the next slower one would land well after it); too far: full speed now
      const pick = [...d.options].reverse().find((x) => d.at + x.flight <= want) ?? fastest;
      const departure = Math.max(d.at, want - pick.flight);
      const arrival = departure + pick.flight;
      d.target.arrivals.push({ at: arrival, resources: d.load, found: true });
      d.target.founding = false;
      const r = d.result!;
      r.start = departure;
      r.end = arrival;
      if (pick.flight !== fastest.flight) r.speed = pick.speed;
      // a slower flight burns less deuterium: what is left stays on the planet
      const saved = d.fuel - pick.fuel;
      if (saved > 0) {
        d.from.res[903] += saved;
        r.fuel = pick.fuel;
        if (r.cost) r.cost[903] = (r.cost[903] ?? 0) - saved;
        if (r.after) r.after[903] = (r.after[903] ?? 0) + saved;
      }
    }
  };

  /** costs of building and research levels (the same few are asked for at every event) */
  const costs = new Map<number, Record<number, number>>();
  const unitCosts = new Map<number, Record<number, number>>();
  const levelCost = (id: number, level: number) => {
    const key = id * 1000 + level;
    let c = costs.get(key);
    if (!c) costs.set(key, (c = buildingCost(id, level, catchUp, records[id])));
    return c;
  };
  const stepCost = (p: Planet, s: Step): Record<number, number> => {
    if (s.kind === 'building') return levelCost(s.element!, levelOf(p, s.element!) + 1);
    if (s.kind === 'research') return levelCost(s.element!, researchLevelOf(s.element!) + 1);
    if (s.kind === 'ship' || s.kind === 'defense') {
      let unit = unitCosts.get(s.element!);
      if (!unit) unitCosts.set(s.element!, (unit = buildingCost(s.element!, 1)));
      return Object.fromEntries(Object.entries(unit).map(([r, v]) => [r, v * (s.count ?? 1)]));
    }
    if (s.kind === 'transport') {
      const f = flightOf(p, s.transport!);
      const load = loadOf(p, s.transport!, f);
      const cost: Record<number, number> = {};
      for (const r of RES) {
        const v = load[r] + (r === 903 ? f.fuel : 0);
        if (v > 0) cost[r] = v;
      }
      return cost;
    }
    return {};
  };

  const check = (p: Planet, s: Step, t: number): Check => {
    if (!p.active) return { ok: false, wait: 'colony' };
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
        if (!activeUnits().units[String(id)]) return { ok: false, wait: 'planet', never: true };
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
      case 'transport': {
        const tr = s.transport!;
        const f = flightOf(p, tr);
        if (f.capacity != null && (f.capacity < 0 || Object.values(fixedOf(tr)).reduce((n, v) => n + v, 0) > f.capacity)) return { ok: false, wait: 'cargo', never: true };
        const departure = Math.max(tr.notBefore ?? 0, tr.arriveAt != null ? tr.arriveAt - f.flight : 0);
        if (departure > t) return { ok: false, wait: 'time', readyAt: departure };
        const ships = shipsReady(p, tr);
        if (ships > t) return { ok: false, wait: 'shipyard', readyAt: ships };
        const target = tr.target ? byKey.get(tr.target) : undefined;
        if (target && !target.active && tr.mission !== 'colonize') {
          // a transport or deployment needs the planet to exist: it leaves once the colonization has landed
          const found = target.arrivals.find((a) => a.found);
          return { ok: false, wait: 'colony', ...(found ? { readyAt: Math.max(t + 1, found.at) } : {}) };
        }
        if (tr.mission === 'colonize' && target && !target.active && o.universe) {
          // the planet is only founded when astrophysics allows one more at the arrival
          const count = planetCount();
          const limit = (astro: number) => planetLimit(o.universe!, astro);
          const allowed = limit(astroAt(t + f.flight));
          if (allowed != null && count >= allowed) {
            const q = researchQueue.find((x) => x.id === ASTROPHYSICS && (limit(x.level) ?? 0) > count);
            if (q) return { ok: false, wait: 'astro', readyAt: Math.max(t + 1, q.end + ASTRO_MARGIN - f.flight) };
            if (!astroAhead(p, count)) return { ok: false, wait: 'astro' };
            // the astrophysics comes later in a list: leave without blocking it, the arrival follows the research
            const c = ready(p, stepCost(p, s), t);
            return c.ok ? { ok: true, wait: 'astro', defer: true } : c;
          }
        }
        break;
      }
    }
    return ready(p, stepCost(p, s), t);
  };

  const pay = (p: Planet, cost: Record<number, number>) => {
    for (const r of RES) p.res[r] = Math.max(0, p.res[r] - (cost[r] ?? 0));
  };

  const start = (p: Planet, s: Step, t: number, defer = false) => {
    const target = targets.get(s.id) ?? null;
    const cost = stepCost(p, s);
    const id = s.element!;
    let end = t;
    let fuel = 0;
    let rates: StepResult['production'];
    const lean = o.lean === true;
    const energyBefore = lean ? null : energyOf(p);
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
        const was = lean ? null : ratesOf(p);
        p.factors = { ...p.factors, ...s.prod!.factors };
        updateRate(p);
        if (was) rates = { before: was, after: ratesOf(p) };
        end = t + s.prod!.wait;
        p.waitUntil = end;
        break;
      }
      case 'transport': {
        const tr = s.transport!;
        const f = flightOf(p, tr);
        fuel = f.fuel;
        end = t + f.flight;
        const load: Record<number, number> = {};
        for (const r of RES) load[r] = Math.max(0, (cost[r] ?? 0) - (r === 903 ? fuel : 0));
        const target = tr.target ? byKey.get(tr.target) : undefined;
        if (target && defer) {
          target.founding = true;
          // no speed of its own: automatic, the slowest that still lands right after the astrophysics
          const options = (tr.speed != null ? [tr.speed] : SPEED_PERCENTS).map((speed) => ({ speed, ...flightOf(p, { ...tr, speed }) }));
          deferred.push({ from: p, target, at: t, load, fuel, options, result: null });
        } else if (target) target.arrivals.push({ at: end, resources: load, ...(tr.mission === 'colonize' && !target.active ? { found: true } : {}) });
        break;
      }
    }
    const snapshot = () => Object.fromEntries(RES.map((r) => [r, Math.floor(p.res[r] + 1e-9)])) as Record<number, number>;
    const before = lean ? null : snapshot();
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
    // copied per resource: spreading or for…in over these objects with numeric keys was the most expensive part of a
    // search's evaluation
    let costCopy: Record<number, number> | null = null;
    let shortOf: Record<number, number> | null = null;
    for (const r of RES) {
      if (cost[r] != null && !lean) (costCopy ??= {})[r] = cost[r];
      if (transport[r] != null) (shortOf ??= {})[r] = transport[r];
    }
    const r: Omit<StepResult, 'id' | 'planet'> = { target, state: 'planned', start: t, end, cost: costCopy, wait: p.wait, transport: shortOf, full: lean ? null : fullOf(p) };
    if (fuel) r.fuel = fuel;
    if (rates) r.production = rates;
    if (energyBefore != null) r.energy = { before: energyBefore, after: energyOf(p, true)! };
    if (before) {
      r.before = before;
      r.after = snapshot();
    }
    record(p, s, r);
    if (defer) deferred[deferred.length - 1].result = resultById.get(s.id)!;
    if (s.kind === 'research' && id === ASTROPHYSICS) resolveDeferred();
    p.wait = null;
    p.head++;
    skip(p);
  };

  /** the storages that ran full while the head waited (whole units lost), reset for the next step */
  const fullOf = (p: Planet) => {
    const out: Record<number, { since: number; lost: number }> = {};
    for (const r of RES) {
      const f = p.full[r];
      if (f && Math.floor(f.lost) > 0) out[r] = { since: f.since, lost: Math.floor(f.lost) };
    }
    p.full = {};
    return Object.keys(out).length ? out : null;
  };

  const invalid = (p: Planet, wait: WaitReason) => {
    const s = p.steps[p.head];
    record(p, s, { target: targets.get(s.id) ?? null, state: 'invalid', start: null, end: null, cost: null, wait, transport: null, full: null });
    p.full = {};
    p.wait = null;
    p.head++;
    skip(p);
  };

  // ------------------------------------------------------------------ event loop
  const advance = (t: number, dt: number) => {
    if (dt <= 0) return;
    for (const p of planets) {
      const waiting = p.head < p.steps.length;
      for (const r of RES) {
        if (p.rate[r] < 0) {
          p.res[r] = Math.max(0, p.res[r] + (p.rate[r] * dt) / 3600);
          continue;
        }
        const grown = p.res[r] + (p.rate[r] * dt) / 3600;
        if (grown > p.cap[r] && p.rate[r] > 0 && waiting && !o.lean) {
          // the storage runs full (or is full): what is produced beyond it is lost
          const since = p.res[r] < p.cap[r] ? t + ((p.cap[r] - p.res[r]) / p.rate[r]) * 3600 : t;
          const lost = grown - Math.max(p.res[r], p.cap[r]);
          const f = p.full[r];
          p.full[r] = { since: f ? f.since : Math.round(since), lost: (f ? f.lost : 0) + lost };
        }
        if (p.res[r] < p.cap[r]) p.res[r] = Math.min(p.cap[r], grown);
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
        if (STORAGE_IDS.has(q.id)) updateCap(p);
        updateRate(p);
      }
      while (p.shipyard[0] && p.shipyard[0].end <= t) {
        const q = p.shipyard.shift()!;
        p.levels[q.id] = (p.levels[q.id] ?? 0) + q.count;
        if (q.id === SOLAR_SATELLITE) updateRate(p);
      }
      for (let i = p.arrivals.length - 1; i >= 0; i--) {
        if (p.arrivals[i].at > t) continue;
        const a = p.arrivals[i];
        p.arrivals.splice(i, 1);
        if (a.found && !p.active) {
          p.active = true;
          for (const r of RES) p.res[r] += p.founded[r] ?? 0;
          updateRate(p);
          rates = true;
        }
        for (const r of RES) p.res[r] += a.resources[r] ?? 0;
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
  let stopped = false;
  complete(t);
  const maxEvents = o.maxEvents ?? MAX_EVENTS;
  while (events++ < maxEvents) {
    // start every head that can start now (one start may block or free another)
    let started = true;
    // the checks of the last pass (nothing started in it, so they hold for the next event)
    const checks = new Map<Planet, Check>();
    while (started) {
      started = false;
      for (const p of planets) {
        if (p.head >= p.steps.length) continue;
        const c = check(p, p.steps[p.head], t);
        checks.set(p, c);
        if (c.ok) {
          if (c.wait) p.wait = c.wait;
          start(p, p.steps[p.head], t, c.defer);
          started = true;
        } else if (c.never) {
          invalid(p, c.wait ?? 'requirements');
          started = true;
        } else p.wait = c.wait ?? null;
      }
    }
    if (stopIds && stopLeft <= 0 && (o.stop!.at === 'start' || t >= stopEnd)) {
      stopped = true;
      break;
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
      const c = checks.get(p) ?? check(p, p.steps[p.head], t);
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
    advance(t, next - t);
    t = next;
    complete(t);
  }
  const final: SimState | undefined = o.state
    ? {
        t, research: { ...research }, researchQueue: researchQueue.map((q) => ({ id: q.id, level: q.level, end: q.end })), resourceSpeed: formulaSpeed,
        planets: Object.fromEntries(planets.map((p) => [p.key, {
          type: p.type, active: p.active, levels: { ...p.levels }, build: p.build.map((q) => ({ ...q })), shipyard: p.shipyard.map((q) => ({ ...q })),
          res: { ...p.res }, rate: { ...p.rate }, cap: { ...p.cap }, temp: p.temp, factors: { ...p.factors }, calibration: { ...p.calibration },
        }])),
      }
    : undefined;
  // the event cap stopped the loop: the steps left are not a planet-type problem
  if (!stopped) for (const p of planets) while (p.head < p.steps.length) invalid(p, 'aborted');
  // colonizations whose astrophysics never started cannot found their planet
  for (const d of stopped ? [] : deferred) {
    const r = d.result!;
    Object.assign(r, { state: 'invalid', start: null, end: null, cost: null, wait: 'astro', transport: null, full: null });
    delete r.before;
    delete r.after;
    delete r.fuel;
  }

  // steps in list order per planet
  const steps: StepResult[] = [];
  const nextOf: Record<string, string | null> = {};
  for (const [key, list] of Object.entries(order.planets)) {
    nextOf[key] = null;
    for (const s of list) {
      if (stopped && !resultById.has(s.id)) continue;
      const r = resultById.get(s.id) ?? {
        id: s.id, planet: key, target: targets.get(s.id) ?? null, state: 'invalid' as const, start: null, end: null, cost: null, wait: 'planet' as const, transport: null, full: null,
      };
      steps.push(r);
      if (nextOf[key] == null && (r.state === 'planned' || r.state === 'invalid')) nextOf[key] = s.id;
    }
  }
  return { steps, next: nextOf, unscheduled, ...(final ? { final } : {}) };
}

/** The own colonization flying to `c` as the hub synced it, the one landing first. */
function colonizingTo(hub: HubState, c: { g: number; s: number; p: number }): NonNullable<HubState['colonizing']>[number] | null {
  const list = (hub.colonizing ?? []).filter((f) => f.coords.g === c.g && f.coords.s === c.s && f.coords.p === c.p);
  return list.sort((a, b) => a.at - b.at)[0] ?? null;
}

/**
 * The planned planets of the build order that are start planets (exist from the start: only while the hub has no
 * synced planet, the first `maxInitialPlanets` without a colonization by number) and those that are unscheduled
 * colonies (no start planet, no colonization; `colonized`: the planned planets a colonization flies or flew to).
 */
export function plannedRoles(
  order: BuildOrder, hub: HubState, colonized: Set<string>, universe?: Pick<UniverseSettings, 'maxInitialPlanets'>,
): { start: string[]; unscheduled: string[] } {
  const keys = Object.keys(order.planets)
    .filter((k) => isPlannedKey(k) && !colonized.has(k))
    .sort((a, b) => plannedNumber(a)! - plannedNumber(b)!);
  const synced = hub.planets.some((p) => p.type === 'planet' && !isPlannedKey(p.key));
  const start = synced ? [] : keys.slice(0, Math.max(1, universe?.maxInitialPlanets ?? 1));
  return { start, unscheduled: keys.filter((k) => !start.includes(k)) };
}

const levelOfQueue = (q: { level: number; destroy: boolean }) => (q.destroy ? q.level - 1 : q.level);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
