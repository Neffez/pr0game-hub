import { BUILDINGS, RESEARCH, SHIPS } from '@pr0hub/core/buildings';
import type { Base, BuildOrder, Step, StepKind } from './types.js';

/** Limits of a stored build order. */
export const MAX_STEPS = 3000;
export const MAX_PLANETS = 30;

const KINDS: StepKind[] = ['building', 'research', 'ship', 'defense', 'prod', 'transport'];
const KEY = /^\d{1,2}:\d{1,4}:\d{1,2}:(planet|moon)$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown, max = 1e9) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;

/** A build order from untrusted JSON (request body): the cleaned order, or the reason it is not one. */
export function validateBuildOrder(raw: unknown): { order: BuildOrder } | { error: string } {
  if (!isObject(raw) || !isObject(raw.planets) || !isObject(raw.base)) return { error: 'Expected base and planets' };
  const base = validateBase(raw.base);
  if (!base) return { error: 'Invalid base' };
  const entries = Object.entries(raw.planets);
  if (entries.length > MAX_PLANETS) return { error: 'Too many planets' };
  const planets: Record<string, Step[]> = {};
  const ids = new Set<string>();
  let total = 0;
  for (const [key, list] of entries) {
    if (!KEY.test(key) || !Array.isArray(list)) return { error: `Invalid planet ${key}` };
    total += list.length;
    if (total > MAX_STEPS) return { error: 'Too many steps' };
    const steps: Step[] = [];
    for (const s of list) {
      const step = validateStep(s);
      if (!step || ids.has(step.id)) return { error: `Invalid step on ${key}` };
      ids.add(step.id);
      steps.push(step);
    }
    planets[key] = steps;
  }
  return { order: { base, planets } };
}

function levels(raw: unknown): Record<string, number> | null {
  if (!isObject(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^\d{1,3}$/.test(k) || !count(v)) return null;
    out[k] = Math.floor(v as number);
  }
  return out;
}

function validateBase(raw: Record<string, unknown>): Base | null {
  const research = levels(raw.research);
  if (!research || !isObject(raw.planets)) return null;
  const planets: Base['planets'] = {};
  for (const [key, l] of Object.entries(raw.planets)) {
    const v = levels(l);
    if (!KEY.test(key) || !v) return null;
    planets[key] = v;
  }
  return { planets, research };
}

function validateStep(raw: unknown): Step | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !/^[\w-]{1,40}$/.test(raw.id) || !KINDS.includes(raw.kind as StepKind)) return null;
  const kind = raw.kind as StepKind;
  const step: Step = { id: raw.id, kind };
  if (raw.deactivated === true) step.deactivated = true;
  if (raw.done === true) step.done = true;
  const element = raw.element;
  switch (kind) {
    case 'building':
    case 'research':
    case 'ship':
    case 'defense': {
      const table = kind === 'building' ? BUILDINGS : kind === 'research' ? RESEARCH : SHIPS;
      if (typeof element !== 'number' || !table[String(element)]) return null;
      if (kind === 'ship' && element >= 400) return null;
      if (kind === 'defense' && element < 400) return null;
      step.element = element;
      if (kind === 'ship' || kind === 'defense') {
        if (!count(raw.count, 1e7) || (raw.count as number) < 1) return null;
        step.count = Math.floor(raw.count as number);
      }
      return step;
    }
    case 'prod': {
      const p = raw.prod;
      if (!isObject(p) || !isObject(p.factors) || !count(p.wait, 365 * 86400)) return null;
      const factors: Record<string, number> = {};
      for (const [k, v] of Object.entries(p.factors)) {
        if (!['1', '2', '3', '4', '12', '212'].includes(k) || !count(v, 1)) return null;
        factors[k] = v as number;
      }
      step.prod = { factors, awaitBuilding: p.awaitBuilding === true, awaitResearch: p.awaitResearch === true, awaitShipyard: p.awaitShipyard === true, wait: Math.floor(p.wait as number) };
      return step;
    }
    case 'transport': {
      const tr = raw.transport;
      if (!isObject(tr) || !count(tr.flight, 30 * 86400) || !isObject(tr.resources)) return null;
      if (tr.target !== null && (typeof tr.target !== 'string' || !KEY.test(tr.target))) return null;
      const resources: Record<string, number> = {};
      for (const [k, v] of Object.entries(tr.resources)) {
        if (!['901', '902', '903'].includes(k) || !count(v, 1e13)) return null;
        resources[k] = v as number;
      }
      step.transport = { target: tr.target as string | null, resources, flight: Math.floor(tr.flight as number) };
      return step;
    }
  }
}
