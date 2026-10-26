import { Worker } from 'node:worker_threads';
import { DEFENSE_IDS, encodeShare, SHIP_IDS, type BattleSetup, type SimSettings, type SimSummary } from '@pr0hub/battle';
import { distance, drivesFromResearch, fleetConsumption, flightDuration, slowestShip } from '@pr0hub/flight';
import { HttpError } from './auth.js';
import type { UniverseSettings } from './config.js';

/**
 * Limits of the simulator API, counted in pieces (ships and defense units, not resource units): the engine handles
 * each piece, the work grows with pieces × runs (about 0.2 µs per piece and run).
 */
export const BATTLE_LIMITS = {
  maxRuns: 100,
  defaultRuns: 20,
  maxSlots: 16,
  maxUnits: 5_000_000,
  maxWork: 50_000_000,
  timeoutMs: 20_000,
  concurrent: 2,
  perMinute: 20,
};

const TOOLS_URL = 'https://pr0game.neffez.dev/battle-simulator/';
const TECHS = [109, 110, 111, 115, 117, 118, 134];
const COMBAT_TECHS = [109, 110, 111];

type Coords = [number, number, number];

export interface ApiSlot {
  units: Record<string, number>;
  research: Record<string, number>;
  from: Coords | null;
  speed: number;
  carried: number;
}

export interface BattleRequest {
  attackers: ApiSlot[];
  /** the planet first (null: from the newest spy report of `target`), then fleets holding there */
  defenders: (ApiSlot | null)[];
  target: Coords | null;
  planetType: 'planet' | 'moon';
  resources: { metal: number; crystal: number; deuterium: number } | null;
  runs: number;
  settings: Partial<SimSettings>;
  report: boolean;
}

const bad = (message: string) => new HttpError(400, 'battle_invalid', message);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function count(v: unknown, what: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw bad(`${what}: integer 0-${max}`);
  return v;
}

function coords(v: unknown, what: string): Coords | null {
  if (v == null) return null;
  const m = typeof v === 'string' ? v.match(/^(\d+):(\d+):(\d+)$/) : null;
  const c = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : v;
  if (!Array.isArray(c) || c.length !== 3 || !c.every((n) => Number.isInteger(n) && n > 0)) throw bad(`${what}: "g:s:p" or [g, s, p]`);
  return [c[0], c[1], c[2]];
}

function slot(v: unknown, what: string, allowed: number[]): ApiSlot {
  if (!isObject(v)) throw bad(`${what}: object with units`);
  const units: Record<string, number> = {};
  for (const [id, n] of Object.entries(isObject(v.units) ? v.units : {})) {
    if (!allowed.includes(Number(id))) throw bad(`${what}.units: unknown unit ${id}`);
    if (count(n, `${what}.units.${id}`)) units[id] = n as number;
  }
  const research: Record<string, number> = {};
  for (const [id, n] of Object.entries(isObject(v.research) ? v.research : {})) {
    if (!TECHS.includes(Number(id))) throw bad(`${what}.research: only ${TECHS.join(', ')}`);
    if (count(n, `${what}.research.${id}`, 99)) research[id] = n as number;
  }
  const speed = v.speed == null ? 100 : count(v.speed, `${what}.speed`, 100);
  if (speed < 10 || speed % 10) throw bad(`${what}.speed: 10, 20, … 100`);
  return { units, research, from: coords(v.from, `${what}.from`), speed, carried: v.carried == null ? 0 : count(v.carried, `${what}.carried`) };
}

/** Checks and normalizes the request body. */
export function parseBattleRequest(body: unknown): BattleRequest {
  if (!isObject(body)) throw bad('JSON object expected');
  const attackerIds = SHIP_IDS.filter((id) => id !== 212);
  if (!Array.isArray(body.attackers) || !body.attackers.length || body.attackers.length > BATTLE_LIMITS.maxSlots) {
    throw bad(`attackers: 1-${BATTLE_LIMITS.maxSlots} fleets`);
  }
  const attackers = body.attackers.map((a, i) => slot(a, `attackers[${i}]`, attackerIds));
  const rawDefenders = body.defenders == null ? [null] : body.defenders;
  if (!Array.isArray(rawDefenders) || !rawDefenders.length || rawDefenders.length > BATTLE_LIMITS.maxSlots) {
    throw bad(`defenders: 1-${BATTLE_LIMITS.maxSlots} fleets (the planet first)`);
  }
  const defenders = rawDefenders.map((d, i) => (i === 0 && d == null ? null : slot(d, `defenders[${i}]`, i === 0 ? [...SHIP_IDS, ...DEFENSE_IDS] : SHIP_IDS)));
  const target = coords(body.target, 'target');
  if (!defenders[0] && !target) throw bad('defenders[0] or target (newest spy report of the group) is needed');
  let resources: BattleRequest['resources'] = null;
  if (body.resources != null) {
    if (!isObject(body.resources)) throw bad('resources: { metal, crystal, deuterium }');
    const r = body.resources;
    resources = { metal: count(r.metal ?? 0, 'resources.metal'), crystal: count(r.crystal ?? 0, 'resources.crystal'), deuterium: count(r.deuterium ?? 0, 'resources.deuterium') };
  }
  const runs = body.runs == null ? BATTLE_LIMITS.defaultRuns : count(body.runs, 'runs', BATTLE_LIMITS.maxRuns);
  if (runs < 1) throw bad(`runs: 1-${BATTLE_LIMITS.maxRuns}`);
  const settings: Partial<SimSettings> = {};
  if (body.settings != null) {
    if (!isObject(body.settings)) throw bad('settings: object');
    const s = body.settings;
    const percent = (v: unknown, what: string) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw bad(`settings.${what}: 0-100`);
      return v;
    };
    if (s.fleetDebrisPercent != null) settings.fleetDebris = percent(s.fleetDebrisPercent, 'fleetDebrisPercent');
    if (s.defenseDebrisPercent != null) settings.defenseDebris = percent(s.defenseDebrisPercent, 'defenseDebrisPercent');
    if (s.moonFactor != null) settings.moonFactor = percent(s.moonFactor, 'moonFactor');
    if (s.maxMoonChance != null) settings.maxMoonChance = percent(s.maxMoonChance, 'maxMoonChance');
    if (s.bigShields != null) {
      if (typeof s.bigShields !== 'boolean') throw bad('settings.bigShields: boolean');
      settings.bigShields = s.bigShields;
    }
  }
  return { attackers, defenders, target, planetType: body.planetType === 'moon' ? 'moon' : 'planet', resources, runs, settings, report: body.report === true };
}

/** The planet slot from spy report values: ships, defense, combat research; resources when the request has none. */
export function planetFromSpy(values: Record<string, number>): { planet: ApiSlot; resources: BattleRequest['resources'] } {
  const units = Object.fromEntries([...SHIP_IDS, ...DEFENSE_IDS].filter((id) => values[id] > 0).map((id) => [id, values[id]]));
  const research = Object.fromEntries(COMBAT_TECHS.filter((id) => values[id] > 0).map((id) => [id, values[id]]));
  return {
    planet: { units, research, from: null, speed: 100, carried: 0 },
    resources: { metal: values[901] ?? 0, crystal: values[902] ?? 0, deuterium: values[903] ?? 0 },
  };
}

/** Universe settings of the hub as simulator settings, overridden by the request. */
export function simSettingsOf(u: UniverseSettings, own: Partial<SimSettings>): SimSettings {
  const s = u as UniverseSettings & { fleetDebrisPercent?: number; defenseDebrisPercent?: number; bigShields?: boolean };
  return {
    fleetDebris: s.fleetDebrisPercent ?? 30,
    defenseDebris: s.defenseDebrisPercent ?? 0,
    moonFactor: 1,
    maxMoonChance: 20,
    bigShields: s.bigShields ?? false,
    ...own,
  };
}

const sumUnits = (slots: { units: Record<string, number> }[]) => slots.reduce((n, s) => n + Object.values(s.units).reduce((a, b) => a + b, 0), 0);

/** Refuses battles above the limits (413). */
export function checkSize(setup: BattleSetup, runs: number) {
  const units = sumUnits(setup.attackers) + sumUnits(setup.defenders);
  if (!sumUnits(setup.attackers)) throw bad('attackers: no units');
  if (units > BATTLE_LIMITS.maxUnits || units * runs > BATTLE_LIMITS.maxWork) {
    throw new HttpError(413, 'battle_too_large', `Too large: at most ${BATTLE_LIMITS.maxUnits} pieces (ships and defense) and ${BATTLE_LIMITS.maxWork} pieces × runs`);
  }
}

/** Flight time and deuterium of the attackers with a start (and the target known). */
export function flights(u: UniverseSettings, attackers: ApiSlot[], target: Coords | null) {
  if (!target) return [];
  return attackers.flatMap((a, slot) => {
    if (!a.from) return [];
    const drives = drivesFromResearch(a.research);
    const slowest = slowestShip(a.units, drives);
    if (!slowest) return [];
    const dist = distance(u, a.from, target);
    const duration = flightDuration(u, dist, slowest.speed, a.speed);
    return [{ slot, distance: dist, duration: Math.floor(duration), deuterium: fleetConsumption(u, a.units, duration, dist, drives) }];
  });
}

/** Link into the battle simulator page with the same battle (like the hub's `battleSimLink`). */
export function toolsLink(u: UniverseSettings, req: BattleRequest, planet: ApiSlot, settings: SimSettings): string {
  const flightUrl = (u as UniverseSettings & { flightCalculatorUrl?: string }).flightCalculatorUrl;
  const base = flightUrl ? new URL('../battle-simulator/', flightUrl.split('#')[0]).href : TOOLS_URL;
  const hash = encodeShare({
    attackers: req.attackers.map((a) => ({ units: a.units, research: a.research, from: a.from, speed: a.speed })),
    defenders: [planet, ...(req.defenders.slice(1) as ApiSlot[])].map((d) => ({ units: d.units, research: d.research })),
    target: req.target,
    resources: req.resources,
    uni: {
      fd: settings.fleetDebris, dd: settings.defenseDebris, mf: settings.moonFactor, mc: settings.maxMoonChance, bs: settings.bigShields ? 1 : 0,
      ut: u.circularGalaxies ? 1 : 0, gt: u.circularSystems ? 1 : 0, mg: u.galaxies, ms: u.systems, mp: u.positions,
      gdf: u.galaxyDistanceFactor, sdf: u.systemDistanceFactor, sd: u.systemDistance, pdf: u.planetDistanceFactor, pd: u.planetDistance,
      gs: u.fleetSpeed / 2500,
    },
    runs: req.runs,
  });
  return `${base}#${hash}`;
}

// ---- running ------------------------------------------------------------------------------------------------------

let running = 0;
const recent = new Map<number, number[]>();

/** At most `perMinute` simulations per user and `concurrent` at a time on the server (429). */
export function throttle(userId: number, at = Date.now()) {
  const list = (recent.get(userId) ?? []).filter((t) => at - t < 60_000);
  if (list.length >= BATTLE_LIMITS.perMinute) throw new HttpError(429, 'battle_rate_limit', `At most ${BATTLE_LIMITS.perMinute} simulations per minute`);
  if (running >= BATTLE_LIMITS.concurrent) throw new HttpError(429, 'battle_busy', 'The simulator is busy, try again in a moment');
  list.push(at);
  recent.set(userId, list);
  if (recent.size > 10000) for (const [k, v] of recent) if (!v.some((t) => at - t < 60_000)) recent.delete(k);
}

/** Runs the battle in a worker thread with a time limit (503 when it takes longer). */
export function runInWorker(setup: BattleSetup, runs: number, settings: SimSettings): Promise<SimSummary> {
  running++;
  return new Promise<SimSummary>((resolve, reject) => {
    const worker = new Worker(new URL('../battle-worker.mjs', import.meta.url), { workerData: { setup, runs, settings } });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new HttpError(503, 'battle_timeout', 'The simulation took too long'));
    }, BATTLE_LIMITS.timeoutMs);
    worker.once('message', (summary: SimSummary) => resolve(summary));
    worker.once('error', (err) => reject(err));
    worker.once('exit', () => clearTimeout(timer));
  }).finally(() => {
    running--;
  });
}
