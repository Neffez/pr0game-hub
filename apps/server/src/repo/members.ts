import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { latestEmpires } from './empire.js';
import { Players } from './players.js';

const cache = new WeakMap<GroupContext, Map<number, number | null>>();

/**
 * Hub player of every alliance member: owner (galaxy data) of a planet on their newest empire page, otherwise the
 * player with their in-game name, without one the player with their hub username (current or former names). One
 * rule for every view: own row in the statistics, imperium, own planets in the overview, player details.
 * Computed once per request (the context is per request).
 */
export function memberPlayers(db: DB, ctx: GroupContext): Map<number, number | null> {
  let map = cache.get(ctx);
  if (map) return map;
  const players = new Players(db, ctx.groupId);
  const empires = new Map(latestEmpires(db, ctx).map((e) => [e.userId, e.rec]));
  const members = db
    .prepare('SELECT m.user_id, m.ingame_name, u.username FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
    .all(ctx.groupId) as { user_id: number; ingame_name: string | null; username: string }[];
  const owner = db.prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND player_id IS NOT NULL');
  map = new Map();
  for (const m of members) {
    let id: number | null = null;
    for (const p of empires.get(m.user_id)?.planets ?? []) {
      id = (owner.pluck().get(ctx.groupId, p.coords.g, p.coords.s, p.coords.p) as number | undefined) ?? null;
      if (id) break;
    }
    map.set(m.user_id, id ?? players.byName(m.ingame_name ?? m.username));
  }
  cache.set(ctx, map);
  return map;
}

export const memberPlayer = (db: DB, ctx: GroupContext, userId: number) => memberPlayers(db, ctx).get(userId) ?? null;
