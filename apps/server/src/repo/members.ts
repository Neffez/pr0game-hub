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

/**
 * Players of the own alliance: the members' players (and in-game names) and everyone in their in-game alliances, by
 * name (lower case) and planet ("g:s:p", incl. the members' own planets from their empire pages).
 */
export function alliance(db: DB, ctx: GroupContext): { names: Set<string>; coords: Set<string> } {
  const players = [...memberPlayers(db, ctx).values()].filter((id): id is number => id != null);
  const ids = players.length
    ? (db
        .prepare(
          `SELECT id FROM players WHERE group_id = ? AND (id IN (SELECT value FROM json_each(?))
             OR alliance_id IN (SELECT alliance_id FROM players WHERE id IN (SELECT value FROM json_each(?)) AND alliance_id IS NOT NULL))`,
        )
        .pluck()
        .all(ctx.groupId, JSON.stringify(players), JSON.stringify(players)) as number[])
    : [];
  const list = JSON.stringify(ids);
  const names = db.prepare('SELECT name FROM players WHERE id IN (SELECT value FROM json_each(?))').pluck().all(list) as string[];
  names.push(...(db.prepare('SELECT ingame_name FROM group_members WHERE group_id = ? AND ingame_name IS NOT NULL').pluck().all(ctx.groupId) as string[]));
  const coords = db.prepare('SELECT g, s, p FROM planets WHERE group_id = ? AND player_id IN (SELECT value FROM json_each(?))').all(ctx.groupId, list) as
    { g: number; s: number; p: number }[];
  for (const e of latestEmpires(db, ctx)) coords.push(...e.rec.planets.map((pl) => pl.coords));
  return { names: new Set(names.map((n) => n.toLowerCase())), coords: new Set(coords.map((c) => `${c.g}:${c.s}:${c.p}`)) };
}

export const memberPlayer = (db: DB, ctx: GroupContext, userId: number) => memberPlayers(db, ctx).get(userId) ?? null;
