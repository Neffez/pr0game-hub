import costData from './data/costs.json' with { type: 'json' };
import techData from './data/tech.json' with { type: 'json' };
import { activeUnits, type UnitCatalog } from './units.js';
import type { Lang } from './util.js';

/** Element classes as used by the game (`$spyData[class][id]`). */
export const CLASS_RESOURCES = 900;
export const CLASS_FLEET = 200;
export const CLASS_DEFENSE = 400;
export const CLASS_BUILDINGS = 0;
export const CLASS_RESEARCH = 100;
export const SPY_CLASSES = [CLASS_RESOURCES, CLASS_FLEET, CLASS_DEFENSE, CLASS_BUILDINGS, CLASS_RESEARCH] as const;
export type SpyClass = (typeof SPY_CLASSES)[number];

/** Element ids the hub looks at directly. */
export const MOON_BASE = 41;
export const PHALANX = 42;
export const METAL = 901;
export const CRYSTAL = 902;
export const DEUTERIUM = 903;
export const RESOURCES = [METAL, CRYSTAL, DEUTERIUM] as const;
/** Storage building per resource. */
export const STORAGE: Record<number, number> = { [METAL]: 22, [CRYSTAL]: 23, [DEUTERIUM]: 24 };

export const TECH_NAMES: Record<Lang, Record<string, string>> = techData;

/** Names of units that only universes know (or name differently), registered by `registerUnitNames`. */
const EXTRA_NAMES: Record<'de' | 'en', Record<string, string>> = { de: {}, en: {} };

/** Name of an element; units by the active catalog, then by the registered universe names. */
export function techName(id: number | string, lang: Lang = 'de'): string {
  const l: 'de' | 'en' = lang === 'en' ? 'en' : 'de';
  const unit = activeUnits().units[String(id)];
  if (unit) return unit.name[l];
  return TECH_NAMES[lang][String(id)] ?? EXTRA_NAMES[l][String(id)] ?? `#${id}`;
}

/** Class of an element id (0 buildings, 100 research, 200 fleet, 400 defense incl. missiles, 900 resources). */
export function classOf(id: number): SpyClass {
  if (id >= 900) return CLASS_RESOURCES;
  if (id >= 400) return CLASS_DEFENSE;
  if (id >= 200) return CLASS_FLEET;
  if (id >= 100) return CLASS_RESEARCH;
  return CLASS_BUILDINGS;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

const NAMES = techData as Record<string, Record<string, string>>;

/**
 * name (lowercased; German, English and the German based pirate language "pi" of the SetSail theme)
 * -> element id; class headers (0,100,200,400,900) included. The first language wins on equal names.
 */
const NAME_TO_ID = new Map<string, number>();
for (const lang of ['de', 'en', 'pi']) {
  for (const [id, name] of Object.entries(NAMES[lang] ?? {})) {
    const key = norm(name);
    if (!NAME_TO_ID.has(key)) NAME_TO_ID.set(key, Number(id));
  }
}
/** English names before the renaming in the game (2026-08), so older pages still parse. */
const LEGACY_NAMES: Record<string, number> = {
  'deuterium power plant': 12,
  'phalanx sensor': 42,
  'mineral research': 131,
  'semi-crystals research': 132,
  'fuel research': 133,
};
for (const [name, id] of Object.entries(LEGACY_NAMES)) if (!NAME_TO_ID.has(name)) NAME_TO_ID.set(name, id);

/** Names and short names of a catalog's units (lowercased), built once per catalog. */
interface CatalogNames {
  names: Map<string, number>;
  shorts: Map<string, number>;
}
const catalogNames = new WeakMap<UnitCatalog, CatalogNames>();

function namesOf(catalog: UnitCatalog): CatalogNames {
  let c = catalogNames.get(catalog);
  if (c) return c;
  c = { names: new Map(), shorts: new Map() };
  const placeholder = (id: number, s: string) => !s || s === `#${id}`;
  for (const unit of Object.values(catalog.units)) {
    for (const l of ['de', 'en'] as const) {
      if (!placeholder(unit.id, unit.name[l])) {
        const key = norm(unit.name[l]);
        if (!c.names.has(key)) c.names.set(key, unit.id);
      }
    }
  }
  for (const unit of Object.values(catalog.units)) {
    for (const l of ['de', 'en'] as const) {
      if (placeholder(unit.id, unit.short[l])) continue;
      const key = norm(unit.short[l]);
      // a short that is the full name of another element stays that element (see SHORT_TO_ID)
      const full = c.names.get(key) ?? NAME_TO_ID.get(key);
      if (full != null && full !== unit.id) continue;
      if (!c.shorts.has(key)) c.shorts.set(key, unit.id);
    }
  }
  catalogNames.set(catalog, c);
  return c;
}

/**
 * Element id by name (German, English or pirate language). Units resolve by the catalog first (default: the active
 * one), so a universe's own names win over the defaults and never leak into another universe.
 */
export function idByName(name: string, catalog: UnitCatalog = activeUnits()): number | null {
  const key = norm(name);
  return namesOf(catalog).names.get(key) ?? NAME_TO_ID.get(key) ?? null;
}

/** Names a parser expected to resolve as a unit and could not (drained into `unknown_unit` on parsePage). */
const unknownUnits = new Set<string>();

export function noteUnknownUnit(name: string) {
  const n = name.replace(/\s+/g, ' ').trim();
  if (n) unknownUnits.add(n);
}

export function takeUnknownUnits(): string[] {
  const names = [...unknownUnits];
  unknownUnits.clear();
  return names;
}

/**
 * Makes the unit names of a universe known to `techName` when another catalog is active (lists across universes).
 * Parsers do not use these: they resolve names by the catalog of the universe (`idByName`).
 */
export function registerUnitNames(catalog: UnitCatalog): void {
  for (const unit of Object.values(catalog.units)) {
    for (const l of ['de', 'en'] as const) {
      const name = unit.name[l];
      if (!name || name === `#${unit.id}`) continue;
      if (TECH_NAMES[l][String(unit.id)] !== name) EXTRA_NAMES[l][String(unit.id)] = name;
    }
  }
}

export function isClassHeader(id: number): id is SpyClass {
  return (SPY_CLASSES as readonly number[]).includes(id);
}

/** element id -> [metal, crystal, deuterium, factor] (generated by scripts/gen-costs.mjs) */
export const ELEMENT_COSTS: Record<string, [number, number, number, number]> = costData as any;

/** Costs of an element [metal, crystal, deuterium, factor]: units from the active catalog (factor 1). */
export function costOf(id: number | string): readonly [number, number, number, number] | undefined {
  const unit = activeUnits().units[String(id)];
  if (unit) return [unit.cost[0], unit.cost[1], unit.cost[2], 1];
  const n = Number(id);
  return n >= 200 && n < 900 ? undefined : ELEMENT_COSTS[String(id)];
}

/** Points of an element like the game's Statbuilder: levels for buildings/research, amounts for ships/defense. */
export function elementPoints(id: number | string, amount: number): number {
  const c = costOf(id);
  if (!c || amount <= 0) return 0;
  const base = c[0] + c[1] + c[2];
  const cls = classOf(Number(id));
  if (cls === CLASS_FLEET || cls === CLASS_DEFENSE) return (base * amount) / 1000;
  // sum of base * factor^(i-1) for i = 1..level
  const sum = c[3] === 1 ? amount : (Math.pow(c[3], amount) - 1) / (c[3] - 1);
  return (base * sum) / 1000;
}

/** Points of a spy report section (element id -> level/amount). */
export function sectionPoints(values: Record<string, number> | undefined | null): number | null {
  if (!values) return null;
  let total = 0;
  for (const [id, n] of Object.entries(values)) total += elementPoints(id, n);
  return total;
}

/** Storage capacity of a metal/crystal/deuterium store (game formula), times the universe storage factor. */
export function storageCapacity(level: number, multiplier = 1): number {
  return Math.floor(2.5 * Math.pow(1.8331954764, level)) * 5000 * multiplier;
}

/**
 * Short names of battle reports. A short name that is the full name of another element is skipped:
 * the pirate language gives the colony ship (208) the short name "Fregatte", the full name of 215.
 */
const SHORT_TO_ID = new Map<string, number>();
for (const key of ['deShort', 'enShort', 'piShort']) {
  for (const [id, short] of Object.entries(NAMES[key] ?? {})) {
    const k = norm(short);
    const full = NAME_TO_ID.get(k);
    if (full != null && full !== Number(id)) continue;
    if (!SHORT_TO_ID.has(k)) SHORT_TO_ID.set(k, Number(id));
  }
}

/**
 * Element id by the short name used in battle reports ("Kl. Transporter"): the game's shorts first, then the
 * catalog's (default: the active one; units a universe added, such as "Bunk"), then the full name. The catalog's
 * shorts are column labels, so they never override the game's battle-report shorts.
 */
export function idByShortName(name: string, catalog: UnitCatalog = activeUnits()): number | null {
  const key = norm(name);
  const id = SHORT_TO_ID.get(key) ?? namesOf(catalog).shorts.get(key) ?? idByName(name, catalog);
  if (id == null) noteUnknownUnit(name);
  return id;
}
