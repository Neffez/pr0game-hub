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

function userReferences(db: DB): { table: string; column: string }[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
  return tables.flatMap((t) =>
    (db.pragma(`foreign_key_list(${JSON.stringify(t)})`) as { table: string; from: string }[])
      .filter((fk) => fk.table === 'users')
      .map((fk) => ({ table: t, column: fk.from })),
  );
}

/** Moves all rows referencing `from` to `into`, then deletes the placeholder user. */
export function mergeUser(db: DB, from: number, into: number) {
  if (from === into) return;
  db.transaction(() => {
    for (const { table, column } of userReferences(db)) {
      db.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`).run(into, from);
    }
    for (const row of db
      .prepare('SELECT group_id, role, ingame_name FROM group_members WHERE user_id = ?')
      .all(from) as { group_id: number; role: string; ingame_name: string | null }[]) {
      const existing = db
        .prepare('SELECT role, ingame_name FROM group_members WHERE group_id = ? AND user_id = ?')
        .get(row.group_id, into) as { role: string; ingame_name: string | null } | undefined;
      if (existing) {
        db.prepare('UPDATE group_members SET ingame_name = COALESCE(ingame_name, ?) WHERE group_id = ? AND user_id = ?').run(
          row.ingame_name,
          row.group_id,
          into,
        );
      } else {
        db.prepare('INSERT INTO group_members (group_id, user_id, role, ingame_name) VALUES (?, ?, ?, ?)').run(
          row.group_id,
          into,
          row.role,
          row.ingame_name,
        );
      }
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(from);
  })();
}
