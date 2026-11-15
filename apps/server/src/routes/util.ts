import type { FastifyRequest } from 'fastify';
import { groupContext } from '../context.js';
import type { DB } from '../db.js';

export type Q = Record<string, string | undefined>;

/** An integer query parameter within `min`..`max`; missing, empty or not a number gives `def`. */
export const clampInt = (v: string | undefined, def: number, min: number, max: number) => {
  const n = v == null || v.trim() === '' ? def : Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

// SQL fragments of the data layer, for the routes (see repo/sql.ts for the identity rule)
export { DISPLAY, displayNameOf, displayOf, likeTerm } from '../repo/sql.js';

/** The request's group context (see `groupContext`) for the routes below /api/:uni. */
/**
 * Closes every unreleased claim of a target before a new one is inserted (at most one unreleased claim per target,
 * see the unique index): an active one now, an expired one at its expiry.
 */
export const releaseTargetClaims = (db: DB, groupId: number, t: { g: number; s: number; p: number; type: string }, time: number) =>
  db
    .prepare(
      `UPDATE target_claims SET released_at = MIN(expires_at, ?)
       WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ? AND released_at IS NULL`,
    )
    .run(time, groupId, t.g, t.s, t.p, t.type);

export const contextOf = (db: DB) => (req: FastifyRequest<{ Params: { uni: string } }>) => groupContext(db, req, req.params.uni);

/** Time range of a list (default: the last 8 days). */
export function range(q: Q) {
  const to = Number(q.to) || Math.floor(Date.now() / 1000) + 86400;
  const from = Number(q.from) || to - 86400 * 8;
  return { from, to };
}

export function parseSections(r: any) {
  return { ...r, sections: JSON.parse(r.sections) };
}

export function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}
