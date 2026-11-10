import type { DB } from '../db.js';

/** The web app's built-in presets: shown under their name in the viewer's language, whatever `name` holds. */
export const BUILTIN_PRESETS = ['night', 'work'] as const;
export type BuiltinPreset = (typeof BUILTIN_PRESETS)[number];

/** An offline window preset of the fleet save planner: a name and times of day "HH:MM". */
export interface FleetSavePreset {
  name: string;
  from: string;
  to: string;
  /** one of the web app's built-in presets (its name is translated when shown) */
  builtin?: BuiltinPreset;
}

export const MAX_FLEETSAVE_PRESETS = 20;
const MAX_NAME = 40;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Checks presets sent by the web app: a list of at most 20 entries with a name (trimmed, 1–40 characters, unique,
 * the later entry wins), two times of day and optionally the mark of a built-in preset. Null when the input is no
 * valid list.
 */
export function parseFleetSavePresets(input: unknown): FleetSavePreset[] | null {
  if (!Array.isArray(input) || input.length > MAX_FLEETSAVE_PRESETS) return null;
  const byName = new Map<string, FleetSavePreset>();
  for (const p of input) {
    if (!p || typeof p !== 'object') return null;
    const { name, from, to, builtin } = p as Record<string, unknown>;
    if (typeof name !== 'string' || typeof from !== 'string' || typeof to !== 'string') return null;
    if (builtin != null && !(BUILTIN_PRESETS as readonly unknown[]).includes(builtin)) return null;
    const label = name.trim();
    if (!label || label.length > MAX_NAME || !TIME.test(from) || !TIME.test(to)) return null;
    byName.delete(label);
    byName.set(label, { name: label, from, to, ...(builtin != null ? { builtin: builtin as BuiltinPreset } : {}) });
  }
  return [...byName.values()];
}

/** The user's stored presets; null when they never changed them (the web app shows its built-ins then). */
export function fleetSavePresets(db: DB, userId: number): FleetSavePreset[] | null {
  const raw = db.prepare('SELECT fleetsave_presets FROM users WHERE id = ?').pluck().get(userId) as string | null | undefined;
  if (raw == null) return null;
  try {
    return parseFleetSavePresets(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function setFleetSavePresets(db: DB, userId: number, presets: FleetSavePreset[]) {
  db.prepare('UPDATE users SET fleetsave_presets = ? WHERE id = ?').run(JSON.stringify(presets), userId);
}
