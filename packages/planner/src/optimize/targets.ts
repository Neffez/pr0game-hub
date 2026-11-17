import { BUILDINGS, RESEARCH, RESEARCH_LAB } from '@pr0hub/core/buildings';
import { activeUnits } from '@pr0hub/core/units';

/**
 * Targets of the optimizer and their requirements (pr0plan `targets/expandTargets.js`): the levels and unit counts
 * the user asks for, plus every building and research level they need, recursively. Buildings a requirement names
 * count on the planet of the optimization (research runs there too, so the research lab is its building as well);
 * research is account wide.
 */

/** Target levels (buildings, research) and unit counts (ships, defense) of one planet, by element id. */
export interface OptimizeTargets {
  buildings?: Record<string, number>;
  research?: Record<string, number>;
  ships?: Record<string, number>;
  defense?: Record<string, number>;
}

/**
 * One target with a priority: a level (buildings, research) or a unit count on the planet (ships, defense), wanted by
 * `by` (epoch seconds, soft: `weight` seconds of penalty per second late, default 1).
 */
export interface TargetEntry {
  element: number;
  /** level of a building or research */
  level?: number;
  /** units of a ship or defense on the planet */
  count?: number;
  by?: number | null;
  weight?: number;
}

export type ElementKind = 'building' | 'research' | 'ship' | 'defense';

/** The targets as entries (the map form without deadlines, weight 1); entries with level or count 0 are dropped. */
export function targetEntries(targets: OptimizeTargets | TargetEntry[]): TargetEntry[] {
  if (Array.isArray(targets)) {
    for (const t of targets) {
      const v = t.level ?? t.count;
      if (!Number.isInteger(t.element) || typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new OptimizeError('targets: entries need an element and a whole level or count >= 0');
      if (t.weight != null && !(t.weight >= 0)) throw new OptimizeError('targets: weight must be >= 0');
    }
    return targets.filter((t) => (t.level ?? t.count)! > 0);
  }
  const out: TargetEntry[] = [];
  for (const group of ['buildings', 'research', 'ships', 'defense'] as const) {
    for (const [id, v] of Object.entries(targets[group] ?? {})) {
      if (!(v > 0)) continue;
      out.push(group === 'ships' || group === 'defense' ? { element: Number(id), count: v } : { element: Number(id), level: v });
    }
  }
  return out;
}

/** The entries as the map form (the highest level or count per element), for `expandTargets`. */
export function targetMap(entries: TargetEntry[]): OptimizeTargets {
  const out: Required<OptimizeTargets> = { buildings: {}, research: {}, ships: {}, defense: {} };
  for (const t of entries) {
    const kind = kindOf(t.element);
    const group = kind === 'building' ? out.buildings : kind === 'research' ? out.research : kind === 'ship' ? out.ships : out.defense;
    group[t.element] = Math.max(group[t.element] ?? 0, (t.level ?? t.count)!);
  }
  return out;
}

export class OptimizeError extends Error {}

export const kindOf = (id: number): ElementKind => (id < 100 ? 'building' : id < 200 ? 'research' : id < 400 ? 'ship' : 'defense');

/** requirements of an element (element id -> level), from the generated data and the active unit catalog */
export function requirementsOfElement(id: number): Record<string, number> {
  return (BUILDINGS[String(id)] ?? RESEARCH[String(id)] ?? activeUnits().units[String(id)])?.req ?? {};
}

/**
 * The flat targets (element id -> level or count) with all requirements merged in (the higher level wins). Throws
 * `OptimizeError` for unknown elements, wrong kinds and levels above the game's maximum.
 */
export function expandTargets(targets: OptimizeTargets, planetType: 'planet' | 'moon' = 'planet'): Record<number, number> {
  const out: Record<number, number> = {};
  const add = (kind: ElementKind, raw: Record<string, number> | undefined) => {
    for (const [key, value] of Object.entries(raw ?? {})) {
      const id = Number(key);
      if (!Number.isInteger(id) || kindOf(id) !== kind) throw new OptimizeError(`targets.${kind === 'defense' ? 'defense' : kind + 's'}: ${key} is not a ${kind}`);
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new OptimizeError(`targets: ${key} needs a whole number >= 0`);
      if (kind === 'building' && !BUILDINGS[key]) throw new OptimizeError(`targets.buildings: unknown building ${key}`);
      if (kind === 'research' && !RESEARCH[key]) throw new OptimizeError(`targets.research: unknown research ${key}`);
      if ((kind === 'ship' || kind === 'defense') && !activeUnits().units[key]) throw new OptimizeError(`targets: unknown unit ${key}`);
      if (value > 0) out[id] = Math.max(out[id] ?? 0, value);
    }
  };
  add('building', targets.buildings);
  add('research', targets.research);
  add('ship', targets.ships);
  add('defense', targets.defense);
  // fixed point over the small requirement graph; the cap guards against a cycle in the data
  for (let round = 0; round < 200; round++) {
    let changed = false;
    for (const [key, level] of Object.entries(out)) {
      if (level <= 0) continue;
      const id = Number(key);
      const req: Record<string, number> = { ...requirementsOfElement(id) };
      // research needs a lab on the planet it runs on
      if (kindOf(id) === 'research') req[RESEARCH_LAB] = Math.max(req[RESEARCH_LAB] ?? 0, 1);
      for (const [r, need] of Object.entries(req)) {
        if ((out[Number(r)] ?? 0) < need) {
          out[Number(r)] = need;
          changed = true;
        }
      }
    }
    if (!changed) break;
    if (round === 199) throw new OptimizeError('targets: the requirements do not converge');
  }
  for (const [key, level] of Object.entries(out)) {
    const id = Number(key);
    const kind = kindOf(id);
    if (kind === 'building') {
      const meta = BUILDINGS[key];
      if (level > meta.max) throw new OptimizeError(`targets: building ${key} goes up to level ${meta.max}`);
      if (!meta.on.includes(planetType)) throw new OptimizeError(`targets: building ${key} cannot be built on a ${planetType}`);
    } else if (kind === 'research') {
      if (level > RESEARCH[key].max) throw new OptimizeError(`targets: research ${key} goes up to level ${RESEARCH[key].max}`);
    }
  }
  return out;
}
