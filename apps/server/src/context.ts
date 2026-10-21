import type { FastifyRequest } from 'fastify';
import { HttpError, requireUser, type SessionUser } from './auth.js';
import { UNIVERSE_DEFAULTS, type UniverseSettings } from './config.js';
import type { DB } from './db.js';
import { DEFAULT_DECK, type DeckCard } from '@pr0hub/core';

export interface Universe {
  id: number;
  slug: string;
  name: string;
  settings: UniverseSettings;
  deck: DeckCard[];
}

export interface GroupContext {
  user: SessionUser;
  universe: Universe;
  groupId: number;
  groupName: string;
  role: 'member' | 'admin';
}

type UniverseRow = { id: number; slug: string; name: string; settings: string; deck_config: string | null };

export function toUniverse(row: UniverseRow): Universe {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    settings: { ...UNIVERSE_DEFAULTS, ...JSON.parse(row.settings || '{}') },
    deck: row.deck_config ? JSON.parse(row.deck_config) : DEFAULT_DECK,
  };
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
  return { user, universe, groupId: row.id, groupName: row.name, role: row.role };
}
