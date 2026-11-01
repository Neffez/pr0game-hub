import type { FastifyRequest } from 'fastify';
import { HttpError, requireUser, type SessionUser } from './auth.js';
import { UNIVERSE_DEFAULTS, type UniverseSettings } from './config.js';
import { now, type DB } from './db.js';
import { DEFAULT_DECK, type DeckCard } from '@pr0hub/core';

export interface Universe {
  id: number;
  slug: string;
  name: string;
  settings: UniverseSettings;
  deck: DeckCard[];
  isDefault: boolean;
  /** scheduled start (epoch): before it the universe is announced but takes no data; null = active since creation */
  startsAt: number | null;
  /** end (epoch, may be scheduled ahead): from then on it is frozen at this time and read-only; null = no end */
  endedAt: number | null;
}

export interface GroupContext {
  user: SessionUser;
  universe: Universe;
  groupId: number;
  groupName: string;
  role: 'member' | 'admin';
  /** the time of the universe: now, or the end of an ended universe (reads show the data as it was then) */
  now: number;
}

type UniverseRow = { id: number; slug: string; name: string; settings: string; deck_config: string | null; is_default?: number; starts_at?: number | null; ended_at?: number | null };

export function toUniverse(row: UniverseRow): Universe {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    settings: { ...UNIVERSE_DEFAULTS, ...JSON.parse(row.settings || '{}') },
    deck: row.deck_config ? JSON.parse(row.deck_config) : DEFAULT_DECK,
    isDefault: !!row.is_default,
    startsAt: row.starts_at ?? null,
    endedAt: row.ended_at ?? null,
  };
}

/** The time of a universe: now, or the end of an ended universe. */
export const universeNow = (u: Pick<Universe, 'endedAt'>, t = now()) => (u.endedAt != null ? Math.min(t, u.endedAt) : t);

/** The universe has reached its end (a scheduled end still ahead does not count). */
export const isEnded = (u: Pick<Universe, 'endedAt'>, t = now()) => u.endedAt != null && u.endedAt <= t;

/** The universe has started (no scheduled start, or it has passed). */
export const isStarted = (u: Pick<Universe, 'startsAt'>, t = now()) => u.startsAt == null || u.startsAt <= t;

/** Started and not ended: data is taken in and notifications go out. */
export const isRunning = (u: Pick<Universe, 'startsAt' | 'endedAt'>, t = now()) => isStarted(u, t) && !isEnded(u, t);

/** Writes are refused before the start and after the end of a universe (an ended one stays readable). */
export function requireRunning(u: Pick<Universe, 'startsAt' | 'endedAt'>, t = now()) {
  if (!isStarted(u, t)) throw new HttpError(409, 'universe_not_started', 'The universe has not started yet');
  if (isEnded(u, t)) throw new HttpError(409, 'universe_ended', 'The universe has ended: its data is read-only');
}

export function getUniverse(db: DB, slug: string): Universe {
  const row = db.prepare('SELECT * FROM universes WHERE slug = ?').get(slug) as UniverseRow | undefined;
  if (!row) throw new HttpError(404, 'universe_not_found', 'Universe not found');
  return toUniverse(row);
}

/**
 * Resolves the group a request acts on. Every game-data query must go through
 * this: data is only ever visible to members of the owning group.
 * The group is chosen via `X-Hub-Group` header or `group` query param, else the
 * user's first group in that universe.
 */
export function groupContext(db: DB, req: FastifyRequest, uniSlug: string): GroupContext {
  const user = requireUser(req);
  const universe = getUniverse(db, uniSlug);
  const wanted = Number(req.headers['x-hub-group'] ?? (req.query as Record<string, string>)?.group ?? 0) || null;
  return resolveGroup(db, user, universe, wanted);
}

export function resolveGroup(db: DB, user: SessionUser, universe: Universe, wanted: number | null): GroupContext {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, m.role FROM groups g JOIN group_members m ON m.group_id = g.id
       WHERE g.universe_id = ? AND m.user_id = ? ORDER BY g.id`,
    )
    .all(universe.id, user.id) as { id: number; name: string; role: 'member' | 'admin' }[];
  const row = wanted ? rows.find((r) => r.id === wanted) : rows[0];
  if (!row) throw new HttpError(403, 'no_group', 'No alliance in this universe');
  return { user, universe, groupId: row.id, groupName: row.name, role: row.role, now: universeNow(universe) };
}
