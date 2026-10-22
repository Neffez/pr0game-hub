import type { EmpireRecord } from '@pr0hub/core';
import { MOON_BASE } from '@pr0hub/core/tech';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';

export /**
 * Snapshots stored before moon detection have no planet type: a moon shares the
 * coordinates of the planet listed before it and is the one with a moon base (41).
 */
function withMoonTypes(rec: EmpireRecord): EmpireRecord {
  const seen = new Set<string>();
  for (const p of rec.planets) {
    const key = `${p.coords.g}:${p.coords.s}:${p.coords.p}`;
    if (!p.type) p.type = seen.has(key) || (p.values[MOON_BASE] ?? 0) > 0 ? 'moon' : 'planet';
    seen.add(key);
  }
  return rec;
}

export type LatestEmpire = { userId: number; time: number; rec: EmpireRecord };

const empireCache = new WeakMap<GroupContext, LatestEmpire[]>();

export /** Newest empire page of every member, loaded and parsed once per request (the context is per request). */
function latestEmpires(db: DB, ctx: GroupContext): LatestEmpire[] {
  let list = empireCache.get(ctx);
  if (!list) {
    const rows = db
      .prepare(
        `SELECT user_id, created_at, data FROM (SELECT user_id, created_at, data,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS n FROM empire_snapshots WHERE group_id = ?)
         WHERE n = 1`,
      )
      .all(ctx.groupId) as { user_id: number; created_at: number; data: string }[];
    list = rows.map((r) => ({ userId: r.user_id, time: r.created_at, rec: withMoonTypes(JSON.parse(r.data) as EmpireRecord) }));
    empireCache.set(ctx, list);
  }
  return list;
}

export /** Own planet coordinates per user from their latest empire snapshot (to tell raids from defenses). */
function ownCoords(db: DB, ctx: GroupContext): Map<number, Set<string>> {
  return new Map(
    latestEmpires(db, ctx).map((e) => [e.userId, new Set(e.rec.planets.map((p) => `${p.coords.g}:${p.coords.s}:${p.coords.p}`))]),
  );
}

/** Newest empire page of one member (from `latestEmpires`), null without one. */
export const latestEmpire = (db: DB, ctx: GroupContext, userId: number) => latestEmpires(db, ctx).find((e) => e.userId === userId) ?? null;
