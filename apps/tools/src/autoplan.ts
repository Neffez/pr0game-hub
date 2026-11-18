/* Auto plan tool: the state of the page (planet, research, targets, search settings, the universe's economy values),
   its share link and the input of the search of @pr0hub/planner for one planet without a hub (`standaloneInput`). The
   search itself runs in Web Workers (../auto-plan/worker.js, `startOptimizePool`). */
import { buildingsFor, RESEARCH } from '@pr0hub/core/buildings';
import { activeUnits } from '@pr0hub/core/units';
import { startResourcesOf, universeSettings } from '@pr0hub/core/universe';
import { standaloneInput, type OptimizeInput, type OptimizeOptions, type OptimizeResult, type Step, type TargetEntry } from '@pr0hub/planner';

/** Search budgets in seconds to choose from. */
export const BUDGETS = [15, 30, 60, 120, 300];
/** Economy buildings the search may insert (and the user may forbid). */
export const ECONOMY = [1, 2, 3, 4, 12, 22, 23, 24];
export const MAX_TARGETS = 30;

export type Kind = 'building' | 'research' | 'ship' | 'defense';
export const KINDS: Kind[] = ['building', 'research', 'ship', 'defense'];

export interface Target {
  element: number;
  /** level (building, research) or count (ship, defense) */
  value: number;
}

export interface Settings {
  /** seconds of search */
  budget: number;
  economy: boolean;
  throttle: boolean;
  forbid: number[];
  /** max. levels crystal below metal and deuterium below crystal, null: no ratio */
  mineRatio: [number, number] | null;
  /** local hours [from, to] no step should start in, null: none */
  quietHours: [number, number] | null;
  workers: number;
}

export interface PlanState {
  /** max. temperature of the planet, null: the game's start planet */
  temp: number | null;
  /** building levels of the planet (element id -> level), empty: a new planet */
  levels: Record<string, number>;
  research: Record<string, number>;
  /** resources at the start (metal, crystal, deuterium), null: the universe's start resources */
  resources: [number, number, number] | null;
  targets: Target[];
  /** epoch seconds the plan starts, null: now */
  start: number | null;
  settings: Settings;
}

/** The universe's economy values as the tools store them (multipliers: 1 = the game's 2500). */
export interface EconomyUni {
  building_speed: number;
  research_speed: number;
  shipyard_speed: number;
  resource_multiplier: number;
  storage_multiplier: number;
  factor_university: number;
}

export const ECONOMY_DEFAULTS: EconomyUni = {
  building_speed: 1, research_speed: 1, shipyard_speed: 1, resource_multiplier: 1, storage_multiplier: 1, factor_university: 8,
};

export function defaultWorkers(cores: number): number {
  return Math.min(4, Math.max(1, (cores || 2) - 1));
}

export function emptySettings(cores = 2): Settings {
  return { budget: 30, economy: true, throttle: true, forbid: [], mineRatio: null, quietHours: null, workers: defaultWorkers(cores) };
}

export function emptyState(cores = 2): PlanState {
  return { temp: null, levels: {}, research: {}, resources: null, targets: [], start: null, settings: emptySettings(cores) };
}

// ---- elements ---------------------------------------------------------------------------------------------------

export const kindOf = (id: number): Kind => (id < 100 ? 'building' : id < 200 ? 'research' : id < 400 ? 'ship' : 'defense');
export const isUnit = (kind: Kind) => kind === 'ship' || kind === 'defense';
export const maxValue = (kind: Kind) => (isUnit(kind) ? 10_000_000 : 255);

/** Elements of a kind on a planet (ships and defense of the active unit catalog). */
export function elementsOf(kind: Kind): number[] {
  if (kind === 'building') return buildingsFor('planet');
  if (kind === 'research') return Object.keys(RESEARCH).map(Number);
  const u = activeUnits();
  return [...(kind === 'ship' ? u.ships : u.defense)];
}

const known = (id: number) => elementsOf(kindOf(id)).includes(id);

// ---- clean ------------------------------------------------------------------------------------------------------

const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

function cleanLevels(o: unknown, kind: 'building' | 'research'): Record<string, number> {
  const out: Record<string, number> = {};
  if (!o || typeof o !== 'object') return out;
  const ids = elementsOf(kind);
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const level = int(v, 0, 255);
    if (level && ids.includes(Number(k))) out[k] = level;
  }
  return out;
}

function cleanTargets(list: unknown): Target[] {
  if (!Array.isArray(list)) return [];
  const out: Target[] = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const element = int((t as Target).element, 1, 999);
    if (element == null || !known(element)) continue;
    const value = int((t as Target).value, 1, maxValue(kindOf(element))) ?? 1;
    out.push({ element, value });
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}

function cleanSettings(o: unknown, cores: number): Settings {
  const s = emptySettings(cores);
  if (!o || typeof o !== 'object') return s;
  const v = o as Partial<Settings>;
  if (BUDGETS.includes(v.budget as number)) s.budget = v.budget!;
  if (typeof v.economy === 'boolean') s.economy = v.economy;
  if (typeof v.throttle === 'boolean') s.throttle = v.throttle;
  if (Array.isArray(v.forbid)) s.forbid = ECONOMY.filter((id) => v.forbid!.includes(id));
  if (Array.isArray(v.mineRatio)) {
    const a = int(v.mineRatio[0], 0, 50);
    const b = int(v.mineRatio[1], 0, 50);
    s.mineRatio = a != null && b != null ? [a, b] : null;
  }
  if (Array.isArray(v.quietHours)) {
    const a = num(v.quietHours[0], 0, 24);
    const b = num(v.quietHours[1], 0, 24);
    s.quietHours = a != null && b != null ? [a, b] : null;
  }
  s.workers = int(v.workers, 1, 64) ?? s.workers;
  return s;
}

/** A stored state with every field present and in range (older or broken data falls back to the defaults). */
export function cleanState(saved: unknown, cores = 2): PlanState {
  const s = emptyState(cores);
  if (!saved || typeof saved !== 'object') return s;
  const o = saved as Partial<PlanState>;
  s.temp = int(o.temp, -300, 300);
  s.levels = cleanLevels(o.levels, 'building');
  s.research = cleanLevels(o.research, 'research');
  if (Array.isArray(o.resources) && o.resources.length === 3) {
    const r = o.resources.map((x) => int(x, 0, 1e15));
    s.resources = r.every((x) => x != null) ? (r as [number, number, number]) : null;
  }
  s.targets = cleanTargets(o.targets);
  s.start = int(o.start, 0, 4e9);
  s.settings = cleanSettings(o.settings, cores);
  return s;
}

/** Economy values with every field present and in range. */
export function cleanEconomy(o: Partial<Record<keyof EconomyUni, unknown>> | null | undefined): EconomyUni {
  const out = { ...ECONOMY_DEFAULTS };
  for (const key of Object.keys(ECONOMY_DEFAULTS) as (keyof EconomyUni)[]) {
    const v = num(o?.[key], key === 'factor_university' ? 0 : 0.01, key === 'factor_university' ? 100 : 10000);
    if (v != null) out[key] = v;
  }
  return out;
}

// ---- share link -------------------------------------------------------------------------------------------------

/** Hash keys of the universe's economy values (multipliers), like the other tools' universe keys. */
export const ECONOMY_HASH: Record<keyof EconomyUni, string> = {
  building_speed: 'bsp', research_speed: 'rsp', shipyard_speed: 'ysp', resource_multiplier: 'rmu', storage_multiplier: 'smu', factor_university: 'fu',
};

const pairs = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(',');
const unpairs = (text: string | null): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const part of (text ?? '').split(',')) {
    const [k, v] = part.split(':');
    if (k && v) out[k] = Number(v);
  }
  return out;
};

/**
 * Hash of a share link: t (targets id:value), l (building levels), r (research), tp (temperature), rs (start
 * resources m,k,d), st (start, epoch seconds), b (budget), e/th (economy, production settings; 0 off), fb (forbidden),
 * mr (mine ratio), qh (quiet hours), and the economy values of the universe.
 */
export function encodeHash(s: PlanState, uni: EconomyUni): string {
  const p = new URLSearchParams();
  if (s.targets.length) p.set('t', s.targets.map((x) => `${x.element}:${x.value}`).join(','));
  if (Object.keys(s.levels).length) p.set('l', pairs(s.levels));
  if (Object.keys(s.research).length) p.set('r', pairs(s.research));
  if (s.temp != null) p.set('tp', String(s.temp));
  if (s.resources) p.set('rs', s.resources.join(','));
  if (s.start != null) p.set('st', String(s.start));
  const o = s.settings;
  if (o.budget !== 30) p.set('b', String(o.budget));
  if (!o.economy) p.set('e', '0');
  if (!o.throttle) p.set('th', '0');
  if (o.forbid.length) p.set('fb', o.forbid.join(','));
  if (o.mineRatio) p.set('mr', o.mineRatio.join(','));
  if (o.quietHours) p.set('qh', o.quietHours.join(','));
  for (const key of Object.keys(ECONOMY_HASH) as (keyof EconomyUni)[]) {
    if (uni[key] !== ECONOMY_DEFAULTS[key]) p.set(ECONOMY_HASH[key], String(uni[key]));
  }
  return p.toString();
}

/**
 * Applies a share link hash to the state and the economy values; false when it holds nothing of this tool. A link
 * with targets or levels replaces the planet and the targets.
 */
export function applyHash(s: PlanState, uni: EconomyUni, hash: string): boolean {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  let any = false;
  if (p.has('t') || p.has('l') || p.has('r')) {
    s.targets = cleanTargets((p.get('t') ?? '').split(',').map((x) => x.split(':')).map(([e, v]) => ({ element: Number(e), value: Number(v) })));
    s.levels = cleanLevels(unpairs(p.get('l')), 'building');
    s.research = cleanLevels(unpairs(p.get('r')), 'research');
    s.temp = int(p.get('tp'), -300, 300);
    const rs = (p.get('rs') ?? '').split(',').map((x) => int(x, 0, 1e15));
    s.resources = rs.length === 3 && rs.every((x) => x != null) ? (rs as [number, number, number]) : null;
    s.start = int(p.get('st'), 0, 4e9);
    any = true;
  }
  const list = (key: string) => (p.get(key) ?? '').split(',').filter(Boolean).map(Number);
  if (p.has('b') || p.has('e') || p.has('th') || p.has('fb') || p.has('mr') || p.has('qh')) {
    s.settings = cleanSettings({
      ...s.settings,
      budget: p.has('b') ? Number(p.get('b')) : s.settings.budget,
      economy: p.get('e') !== '0',
      throttle: p.get('th') !== '0',
      forbid: list('fb'),
      mineRatio: p.has('mr') ? list('mr') : null,
      quietHours: p.has('qh') ? list('qh') : null,
    }, 2);
    any = true;
  }
  for (const key of Object.keys(ECONOMY_HASH) as (keyof EconomyUni)[]) {
    if (!p.has(ECONOMY_HASH[key])) continue;
    Object.assign(uni, cleanEconomy({ ...uni, [key]: p.get(ECONOMY_HASH[key]) }));
    any = true;
  }
  return any;
}

// ---- input of the search ----------------------------------------------------------------------------------------

/** The planner's universe settings from the tools' economy values (game config: 2500 = 1×). */
export function universeOf(uni: EconomyUni, timezone?: string) {
  return universeSettings({
    buildingSpeed: Math.round(uni.building_speed * 2500),
    researchSpeed: Math.round(uni.research_speed * 2500),
    shipyardSpeed: Math.round(uni.shipyard_speed * 2500),
    resourceMultiplier: Math.round(uni.resource_multiplier * 2500),
    storageMultiplier: uni.storage_multiplier,
    universityFactor: uni.factor_university,
    ...(timezone ? { timezone } : {}),
  });
}

/** The universe's start resources of a new planet (metal, crystal, deuterium). */
export function startResources(): [number, number, number] {
  const r = startResourcesOf({});
  return [r[901], r[902], r[903]];
}

export function targetEntries(targets: Target[]): TargetEntry[] {
  return targets.filter((t) => known(t.element) && t.value >= 1).map((t) => (isUnit(kindOf(t.element)) ? { element: t.element, count: t.value } : { element: t.element, level: t.value }));
}

export function optimizeOptions(s: Settings): OptimizeOptions {
  return {
    economy: s.economy,
    throttle: s.throttle,
    forbid: s.forbid.length ? [...s.forbid] : undefined,
    mineRatio: s.mineRatio ? { crystalBelowMetal: s.mineRatio[0], deutBelowCrystal: s.mineRatio[1] } : null,
    quietHours: s.quietHours ? { from: s.quietHours[0], to: s.quietHours[1] } : null,
  };
}

/** The search's input (without the unit catalog, which the workers rebuild from the overrides). */
export function planInput(s: PlanState, uni: EconomyUni, now: number, timezone?: string): Omit<OptimizeInput, 'units'> {
  const universe = universeOf(uni, timezone);
  const res = s.resources ?? startResources();
  return standaloneInput({
    universe,
    levels: { ...s.levels },
    research: { ...s.research },
    resources: { 901: res[0], 902: res[1], 903: res[2] },
    temp: s.temp,
    targets: targetEntries(s.targets),
    options: optimizeOptions(s.settings),
    now: s.start ?? now,
  });
}

// ---- result -----------------------------------------------------------------------------------------------------

export interface PlanRow {
  step: Step;
  /** level after the step (building, research) */
  level: number | null;
  start: number | null;
  end: number | null;
}

/** The result's steps with the level each reaches, in order. */
export function planRows(s: PlanState, result: OptimizeResult): PlanRow[] {
  const levels: Record<string, number> = { ...s.levels, ...s.research };
  const times = new Map(result.timeline.map((x) => [x.id, x]));
  return result.steps.map((step) => {
    let level: number | null = null;
    if ((step.kind === 'building' || step.kind === 'research') && step.element != null) {
      level = (levels[step.element] ?? 0) + 1;
      levels[step.element] = level;
    }
    const tl = times.get(step.id);
    return { step, level, start: tl?.start ?? null, end: tl?.end ?? null };
  });
}

/** Production setting of a prod step as text: "M 90 % · K 100 % · D 80 %" with the given letters. */
export function prodText(step: Step, letters: [string, string, string]): string {
  const f = step.prod?.factors ?? {};
  return ['1', '2', '3'].map((id, i) => `${letters[i]} ${Math.round((f[id] ?? 1) * 100)} %`).join(' · ');
}

/** Duration as "3d 4h 5m" (minutes rounded). */
export function span(sec: number): string {
  const s = Math.max(0, Math.round(sec / 60) * 60);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}

/** Number of building, research and unit steps per kind (prod steps apart). */
export function stepCounts(steps: Step[]): Record<Step['kind'], number> {
  const out = { building: 0, research: 0, ship: 0, defense: 0, prod: 0, transport: 0 } as Record<Step['kind'], number>;
  for (const s of steps) out[s.kind]++;
  return out;
}
