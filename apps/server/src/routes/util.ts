import type { FastifyRequest } from 'fastify';
import { groupContext } from '../context.js';
import type { DB } from '../db.js';

export type Q = Record<string, string | undefined>;

/** Integer query parameter within [min, max]; missing or invalid values give the default. */
export const clampInt = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Math.trunc(Number(v ?? def));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

/** Escapes LIKE wildcards of user input (use with ESCAPE '\\'). */
export const likeTerm = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

/** Members are shown with their in-game name (falls back to the hub username). */
export const DISPLAY = 'COALESCE(gm.ingame_name, u.username)';

export const MEMBER = (t: string) => `LEFT JOIN group_members gm ON gm.group_id = ${t}.group_id AND gm.user_id = ${t}.user_id`;

/** The request's group context (see `groupContext`) for the routes below /api/:uni. */
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
