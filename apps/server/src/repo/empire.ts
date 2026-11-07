import type { EmpireRecord } from '@pr0hub/core';
import { CLASS_BUILDINGS, CLASS_DEFENSE, CLASS_FLEET, CLASS_RESEARCH } from '@pr0hub/core/tech';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';

export type LatestEmpire = { userId: number; time: number; rec: EmpireRecord };

const empireCache = new WeakMap<GroupContext, LatestEmpire[]>();

/** Parsed empire pages kept across requests (newest used ones last). */
const PARSED_KEEP = 500;

/**
 * Parsed empire pages by snapshot id. A snapshot row is never changed after its insert (only deleted), so a parsed
 * page stays valid as long as its id is current. Which ids are current comes from the database on every call with the
 * request's group (see `latestEmpires`); the entry's group is checked again, so a page is only ever handed out for
 * the group that owns it. The records are frozen: a caller that changes one would fail instead of changing it for
 * every later request.
 */
const parsed = new Map<number, { groupId: number; rec: EmpireRecord }>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Drops the parsed pages kept across requests (tests). */
export function clearEmpireCache() {
  parsed.clear();
}

/**
 * Newest empire page of every member, once per request (the context is per request). The ids of the newest pages come
 * from the index alone; only pages not parsed before are read in full.
 */
export function latestEmpires(db: DB, ctx: GroupContext): LatestEmpire[] {
  let list = empireCache.get(ctx);
  if (list) return list;
  const newest = db
    .prepare(
      `SELECT e.id, e.user_id, e.created_at FROM empire_snapshots e
       JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS n FROM empire_snapshots WHERE group_id = ?) l
         ON l.id = e.id
       WHERE l.n = 1 AND e.group_id = ?`,
    )
    .all(ctx.groupId, ctx.groupId) as { id: number; user_id: number; created_at: number }[];
  const missing = newest.filter((r) => parsed.get(r.id)?.groupId !== ctx.groupId).map((r) => r.id);
  if (missing.length) {
    const rows = db
      .prepare('SELECT id, data FROM empire_snapshots WHERE group_id = ? AND id IN (SELECT value FROM json_each(?))')
      .all(ctx.groupId, JSON.stringify(missing)) as { id: number; data: string }[];
    for (const r of rows) parsed.set(r.id, { groupId: ctx.groupId, rec: deepFreeze(JSON.parse(r.data) as EmpireRecord) });
  }
  list = [];
  for (const r of newest) {
    const hit = parsed.get(r.id);
    if (!hit || hit.groupId !== ctx.groupId) continue;
    // used again: to the end of the eviction order
    parsed.delete(r.id);
    parsed.set(r.id, hit);
    list.push({ userId: r.user_id, time: r.created_at, rec: hit.rec });
  }
  for (const id of parsed.keys()) {
    if (parsed.size <= PARSED_KEEP) break;
    parsed.delete(id);
  }
  empireCache.set(ctx, list);
  return list;
}

/** Own planet coordinates per user from their latest empire snapshot (to tell raids from defenses). */
export function ownCoords(db: DB, ctx: GroupContext): Map<number, Set<string>> {
  return new Map(
    latestEmpires(db, ctx).map((e) => [e.userId, new Set(e.rec.planets.map((p) => `${p.coords.g}:${p.coords.s}:${p.coords.p}`))]),
  );
}

/** Newest empire page of one member (from `latestEmpires`), null without one. */
export const latestEmpire = (db: DB, ctx: GroupContext, userId: number) => latestEmpires(db, ctx).find((e) => e.userId === userId) ?? null;

export type SpyPlanet = EmpireRecord['planets'][number] & { time: number };
export type SpyEmpire = { time: number; research: Record<string, number>; researchTime: number | null; planets: SpyPlanet[] };

/** Classes of a spy report that make up an empire page (resources are no part of it). */
const EMPIRE_CLASSES = [CLASS_BUILDINGS, CLASS_FLEET, CLASS_DEFENSE];

/**
 * Empire of a player put together from the spy reports (for members who don't sync their own empire page): per
 * planet/moon each section from the newest report that has it, research from the newest report showing it. Positions
 * now owned by someone else or destroyed are left out. Null without any report showing one of these sections.
 */
export function spyEmpire(db: DB, ctx: GroupContext, playerId: number, name: string): SpyEmpire | null {
  const reports = db
    .prepare(
      `SELECT g, s, p, planet_type, planet_name, report_time, sections FROM spy_reports
       -- by id (players belong to one group) or by the name in the report
       WHERE id IN (SELECT id FROM spy_reports WHERE player_id = ? UNION SELECT id FROM spy_reports WHERE group_id = ? AND player_name = ? COLLATE NOCASE)
       ORDER BY report_time DESC`,
    )
    .all(playerId, ctx.groupId, name) as { g: number; s: number; p: number; planet_type: 'planet' | 'moon'; planet_name: string | null; report_time: number; sections: string }[];
  const position = db.prepare('SELECT name, player_id, destroyed FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ?');
  const planets = new Map<string, SpyPlanet & { seen: Set<number> }>();
  let research: Record<string, number> | null = null;
  let researchTime: number | null = null;
  for (const r of reports) {
    const sections = JSON.parse(r.sections) as Record<string, Record<string, number>>;
    if (!research && sections[CLASS_RESEARCH]) {
      research = sections[CLASS_RESEARCH];
      researchTime = r.report_time;
    }
    if (!EMPIRE_CLASSES.some((cls) => sections[cls])) continue;
    const key = `${r.g}:${r.s}:${r.p}:${r.planet_type}`;
    let pl = planets.get(key);
    if (!pl) {
      const at = position.get(ctx.groupId, r.g, r.s, r.p) as { name: string | null; player_id: number | null; destroyed: number } | undefined;
      if (at && (at.destroyed || (at.player_id != null && at.player_id !== playerId))) continue;
      const label = r.planet_name ?? (r.planet_type === 'planet' ? at?.name : null) ?? '';
      pl = { name: label, coords: { g: r.g, s: r.s, p: r.p }, type: r.planet_type, values: {}, time: r.report_time, seen: new Set() };
      planets.set(key, pl);
    }
    for (const cls of EMPIRE_CLASSES) {
      if (!sections[cls] || pl.seen.has(cls)) continue;
      pl.seen.add(cls);
      Object.assign(pl.values, sections[cls]);
    }
  }
  if (!planets.size && !research) return null;
  const list = [...planets.values()].map(({ seen, ...pl }) => pl);
  return { time: Math.max(researchTime ?? 0, ...list.map((p) => p.time)), research: research ?? {}, researchTime, planets: list };
}
