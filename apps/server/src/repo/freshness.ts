import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { latestEmpires } from './empire.js';
import { overviewTime } from './syncHints.js';

/**
 * Freshness of a member's own pages in the hub, 0–100: each page has a weight and loses its share with its age,
 * linearly from `full` (still fully fresh) to `zero` (worth nothing). Galaxy and buildings count per system around the
 * own planets and per own planet or moon, averaged; without an empire the hub knows neither, they count 0.
 */
export type FreshnessKey = 'empire' | 'overview' | 'galaxy' | 'buildings' | 'messages' | 'research';

export interface FreshnessPart {
  key: FreshnessKey;
  /** share of the total, all weights add up to 100 */
  weight: number;
  /** 0–1 */
  value: number;
  /** newest sync of the page; galaxy and buildings: the oldest of their systems or planets (null: one never synced) */
  time: number | null;
}

export interface Freshness {
  /** 0–100 */
  score: number;
  parts: FreshnessPart[];
}

const HOUR = 3600;
const DAY = 24 * HOUR;
/** weight, fully fresh until `full`, worth nothing from `zero` (seconds) */
export const FRESHNESS: Record<FreshnessKey, { weight: number; full: number; zero: number }> = {
  empire: { weight: 30, full: 6 * HOUR, zero: 3 * DAY },
  overview: { weight: 20, full: 6 * HOUR, zero: 2 * DAY },
  galaxy: { weight: 20, full: DAY, zero: 7 * DAY },
  buildings: { weight: 15, full: DAY, zero: 7 * DAY },
  messages: { weight: 10, full: DAY, zero: 7 * DAY },
  research: { weight: 5, full: 3 * DAY, zero: 14 * DAY },
};
/** Galaxy: systems around each own planet (± this many), like the sync hints. */
const GALAXY_AROUND = 2;

/** 1 until `full`, 0 from `zero`, linear between; never synced: 0. */
export function decay(age: number | null, full: number, zero: number): number {
  if (age == null) return 0;
  if (age <= full) return 1;
  if (age >= zero) return 0;
  return 1 - (age - full) / (zero - full);
}

/** Freshness of the given members (default: all of the group), by user id. */
export function freshnessOf(db: DB, ctx: GroupContext, userIds?: number[]): Map<number, Freshness> {
  const g = ctx.groupId;
  const t = ctx.now;
  const ids =
    userIds ?? (db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').pluck().all(g) as number[]);
  const empires = new Map(latestEmpires(db, ctx).map((e) => [e.userId, e]));
  const { systems } = ctx.universe.settings;
  const seen = new Map(
    (db.prepare("SELECT g || ':' || s AS k, seen_at FROM galaxy_views WHERE group_id = ?").all(g) as { k: string; seen_at: number }[]).map((r) => [r.k, r.seen_at]),
  );
  const pages = (table: string) => {
    const out = new Map<string, number>();
    for (const r of db.prepare(`SELECT user_id, g, s, p, planet_type, MAX(page_time) AS time FROM ${table} WHERE group_id = ? GROUP BY user_id, g, s, p, planet_type`).all(g) as {
      user_id: number; g: number; s: number; p: number; planet_type: string; time: number;
    }[]) out.set(`${r.user_id}:${r.g}:${r.s}:${r.p}:${r.planet_type}`, r.time);
    return out;
  };
  const buildings = pages('building_snapshots');
  const research = new Map(
    (db.prepare('SELECT user_id, MAX(page_time) AS time FROM research_snapshots WHERE group_id = ? GROUP BY user_id').all(g) as { user_id: number; time: number }[]).map((r) => [r.user_id, r.time]),
  );
  const messages = new Map(
    (db
      .prepare("SELECT user_id, MAX(created_at) AS time FROM raw_ingests WHERE group_id = ? AND page_type = 'messages' AND user_id IS NOT NULL GROUP BY user_id")
      .all(g) as { user_id: number; time: number }[]).map((r) => [r.user_id, r.time]),
  );

  const age = (time: number | null) => (time == null ? null : Math.max(0, t - time));
  const part = (key: FreshnessKey, time: number | null, value?: number): FreshnessPart => {
    const c = FRESHNESS[key];
    return { key, weight: c.weight, time, value: value ?? decay(age(time), c.full, c.zero) };
  };
  /** average freshness of several items (systems, planets) and the oldest of them */
  const averaged = (key: FreshnessKey, times: (number | null)[]): FreshnessPart => {
    if (!times.length) return part(key, null, 0);
    const c = FRESHNESS[key];
    const value = times.reduce<number>((sum, x) => sum + decay(age(x), c.full, c.zero), 0) / times.length;
    return part(key, times.includes(null) ? null : Math.min(...(times as number[])), value);
  };

  const out = new Map<number, Freshness>();
  for (const id of ids) {
    const empire = empires.get(id);
    const bodies = empire?.rec.planets ?? [];
    const around = new Set<string>();
    for (const p of bodies) {
      if (p.type !== 'planet') continue;
      for (let s = p.coords.s - GALAXY_AROUND; s <= p.coords.s + GALAXY_AROUND; s++) if (s >= 1 && s <= systems) around.add(`${p.coords.g}:${s}`);
    }
    const parts = [
      part('empire', empire?.time ?? null),
      part('overview', overviewTime(db, g, id)),
      averaged('galaxy', [...around].map((k) => seen.get(k) ?? null)),
      averaged('buildings', bodies.map((p) => buildings.get(`${id}:${p.coords.g}:${p.coords.s}:${p.coords.p}:${p.type}`) ?? null)),
      part('messages', messages.get(id) ?? null),
      part('research', research.get(id) ?? null),
    ];
    out.set(id, { score: Math.round(parts.reduce((sum, x) => sum + x.weight * x.value, 0)), parts });
  }
  return out;
}

/** Freshness of the viewer. */
export const myFreshness = (db: DB, ctx: GroupContext): Freshness => freshnessOf(db, ctx, [ctx.user.id]).get(ctx.user.id)!;
