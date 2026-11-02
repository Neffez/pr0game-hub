import type { Base, BuildOrder, ProdSettings, Step, StepKind, TransportSettings } from './types.js';

/**
 * Import of pr0plan (pr0sync.pages.dev) build orders: the JSON its "download" buttons export, either the build order
 * alone (`{ "1": [actions] }`) or with the planner's settings (`{ buildOrder, settings }`). pr0plan names elements by
 * keys and counts time in hours; the hub uses game ids and seconds.
 */

export const PR0PLAN_BUILDINGS: Record<string, number> = {
  metalMine: 1, crystalMine: 2, deuteriumSynthesizer: 3, solarPlant: 4, fusionReactor: 12, robotFactory: 14, naniteFactory: 15, hangar: 21,
  metalStorage: 22, crystalStorage: 23, deutStorage: 24, researchLab: 31, repairDock: 35, silo: 44,
};
export const PR0PLAN_RESEARCH: Record<string, number> = {
  spioTech: 106, compTech: 108, weaponTech: 109, shieldTech: 110, armourTech: 111, energyTech: 113, hyperTech: 114, combustionEngine: 115,
  impulseEngine: 117, hyperEngine: 118, laserTech: 120, ionTech: 121, plasmaTech: 122, igrnTech: 123, astroTech: 124, metTech: 131, crysTech: 132,
  deutTech: 133, graviton: 199,
};
export const PR0PLAN_SHIPS: Record<string, number> = {
  smallCargo: 202, bigCargo: 203, lightFighter: 204, heavyFighter: 205, cruiser: 206, battleShip: 207, colonyShip: 208, recycler: 209, spyProbe: 210,
  bomber: 211, solarSatelite: 212, starFighter: 213, rip: 214, battleCruiser: 215, stormTransporter: 225,
};
export const PR0PLAN_DEFENSE: Record<string, number> = {
  rocketLauncher: 401, lightLaser: 402, heavyLaser: 403, gaussCannon: 404, ionCannon: 405, plasmaTurret: 406, smallShieldDome: 407, largeShieldDome: 408,
  antiBallisticMissile: 502, interplanetaryMissile: 503,
};

/** A step as imported: a transport names its target by pr0plan planet id. */
export type ImportedStep = Omit<Step, 'id' | 'transport'> & { transport?: Omit<TransportSettings, 'target'> & { target: string | null } };

export interface Pr0planPlanet {
  /** pr0plan planet id ("1" is the home planet) */
  id: string;
  name: string | null;
  temp: number | null;
  steps: ImportedStep[];
}

export interface Pr0planSettings {
  /** pr0plan's multipliers (1 = game speed 2500) */
  resourceSpeed: number;
  buildSpeed: number;
  researchSpeed: number;
  planets: Record<string, { name: string | null; temp: number | null; levels: Record<string, number> }>;
  research: Record<string, number>;
}

export interface Pr0planImport {
  planets: Pr0planPlanet[];
  settings: Pr0planSettings | null;
  /** actions or keys the hub does not know, left out ("RESEARCH foo") */
  skipped: string[];
}

export class ImportError extends Error {
  constructor(readonly code: 'json' | 'format' | 'empty') {
    super(code);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const HOUR = 3600;

/** Parses a pr0plan export (string or parsed JSON). */
export function parsePr0plan(input: unknown): Pr0planImport {
  let json = input;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input);
    } catch {
      throw new ImportError('json');
    }
  }
  if (!isObject(json)) throw new ImportError('format');
  const order = isObject(json.buildOrder) ? json.buildOrder : json;
  const rawSettings = isObject(json.settings) ? json.settings : null;
  const lists = Object.entries(order).filter(([, v]) => Array.isArray(v)) as [string, unknown[]][];
  if (!lists.length || lists.length !== Object.keys(order).length) throw new ImportError('format');

  const skipped: string[] = [];
  const settings = rawSettings ? settingsOf(rawSettings, skipped) : null;
  const planets: Pr0planPlanet[] = lists.map(([id, actions]) => ({
    id,
    name: settings?.planets[id]?.name ?? null,
    temp: settings?.planets[id]?.temp ?? null,
    steps: actions.map((a) => stepOf(a, skipped)).filter((s): s is ImportedStep => s != null),
  }));
  if (!planets.some((p) => p.steps.length)) throw new ImportError('empty');
  return { planets, settings, skipped: [...new Set(skipped)] };
}

function stepOf(action: unknown, skipped: string[]): ImportedStep | null {
  if (!isObject(action) || !isObject(action.payload)) {
    skipped.push('?');
    return null;
  }
  const p = action.payload;
  const deactivated = action.deactivated === true ? { deactivated: true } : {};
  const element = (kind: StepKind, table: Record<string, number>, key: unknown, extra: Partial<ImportedStep> = {}): ImportedStep | null => {
    const id = typeof key === 'string' ? table[key] : undefined;
    if (id == null) {
      skipped.push(`${String(action.type)} ${String(key)}`);
      return null;
    }
    return { kind, element: id, ...extra, ...deactivated };
  };
  const count = Math.max(1, Math.floor(num(p.count, 1)));
  switch (action.type) {
    case 'UPGRADE_BUILDING':
      return element('building', PR0PLAN_BUILDINGS, p.building);
    case 'RESEARCH':
      return element('research', PR0PLAN_RESEARCH, p.tech);
    case 'BUILD_SHIP':
      return element('ship', PR0PLAN_SHIPS, p.ship, { count });
    case 'BUILD_DEFENSE':
      return element('defense', PR0PLAN_DEFENSE, p.defense, { count });
    case 'SET_PROD': {
      const s = isObject(p.settings) ? p.settings : {};
      const prod: ProdSettings = {
        factors: { 1: num(s.metalMine, 1), 2: num(s.crystalMine, 1), 3: num(s.deuteriumSynthesizer, 1) },
        awaitBuilding: s.awaitBuilding === true,
        awaitResearch: s.awaitResearch === true,
        awaitShipyard: s.awaitHangar === true,
        wait: Math.max(0, Math.round(num(s.extra_wait) * HOUR)),
      };
      return { kind: 'prod', prod, ...deactivated };
    }
    case 'TRANSPORT': {
      const s = isObject(p.settings) ? p.settings : {};
      const target = s.target == null || String(s.target) === '0' ? null : String(s.target);
      return {
        kind: 'transport',
        transport: {
          target,
          resources: { 901: Math.max(0, num(s.metal)), 902: Math.max(0, num(s.crystal)), 903: Math.max(0, num(s.deuterium)) },
          flight: Math.max(0, Math.round(num(s.flight_time) * HOUR)),
        },
        ...deactivated,
      };
    }
    default:
      skipped.push(String(action.type));
      return null;
  }
}

function settingsOf(s: Record<string, unknown>, skipped: string[]): Pr0planSettings {
  const levels = (raw: unknown, table: Record<string, number>, out: Record<string, number>) => {
    if (!isObject(raw)) return;
    for (const [key, v] of Object.entries(raw)) {
      const id = table[key];
      if (id == null) {
        if (num(v)) skipped.push(key);
        continue;
      }
      if (num(v)) out[id] = num(v);
    }
  };
  const planets: Pr0planSettings['planets'] = {};
  for (const [id, raw] of Object.entries(isObject(s.planets) ? s.planets : {})) {
    if (!isObject(raw)) continue;
    const l: Record<string, number> = {};
    levels(raw.buildings, PR0PLAN_BUILDINGS, l);
    levels(raw.ships, PR0PLAN_SHIPS, l);
    levels(raw.defenses, PR0PLAN_DEFENSE, l);
    planets[id] = { name: typeof raw.name === 'string' ? raw.name : null, temp: typeof raw.temperature === 'number' ? raw.temperature : null, levels: l };
  }
  const research: Record<string, number> = {};
  levels(s.research, PR0PLAN_RESEARCH, research);
  return { resourceSpeed: num(s.ressSpeed, 1), buildSpeed: num(s.buildSpeed, 1), researchSpeed: num(s.researchSpeed, 1), planets, research };
}

/** The file's start levels as a base, on the hub planets they are mapped to. */
export function baseFromFile(imp: Pr0planImport, mapping: Record<string, string | null>): Base {
  const base: Base = { planets: {}, research: { ...(imp.settings?.research ?? {}) } };
  for (const [id, key] of Object.entries(mapping)) {
    if (key && imp.settings?.planets[id]) base.planets[key] = { ...imp.settings.planets[id].levels };
  }
  return base;
}

/**
 * The build order on the hub planets: `mapping` pr0plan planet id -> hub planet key (null: left out); transports to
 * a left out planet keep their resources leaving. `newId` gives the step ids.
 */
export function toBuildOrder(imp: Pr0planImport, mapping: Record<string, string | null>, base: Base, newId: () => string): BuildOrder {
  const planets: Record<string, Step[]> = {};
  for (const p of imp.planets) {
    const key = mapping[p.id];
    if (!key) continue;
    const list = (planets[key] ??= []);
    for (const s of p.steps) {
      const step: Step = { ...s, id: newId() } as Step;
      if (s.transport) step.transport = { ...s.transport, target: s.transport.target ? (mapping[s.transport.target] ?? null) : null };
      list.push(step);
    }
  }
  return { base, planets };
}
