import { bashRuleOf } from '@pr0hub/core/universe';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { REPORT_SLACK } from '../store.js';
import { memberPlayer } from './members.js';

/** Own attacks on one planet or moon within the bash window. */
export interface BashTarget {
  g: number;
  s: number;
  p: number;
  planet_type: 'planet' | 'moon';
  /** owner of the planet (galaxy data), null when unknown */
  playerId: number | null;
  /** when each counted attack stops counting (impact + window), oldest first */
  resets: number[];
}

/** The caller's bash limit: the universe's rule and their attacks that still count. */
export interface BashLimits {
  hours: number;
  /** attacks per planet or moon; 0 = no limit */
  planetLimit: number;
  /** attacks per player; 0 = no limit */
  playerLimit: number;
  players: { playerId: number; resets: number[] }[];
  targets: BashTarget[];
}

type Row = { time: number; g: number; s: number; p: number; planet_type: 'planet' | 'moon'; report_id: string | null; player_id: number | null };

/**
 * The bash limit of a member, as the game counts it at the launch of an attack: their attacks whose impact lies less
 * than the universe's window (default 24 hours) back, per planet or moon and per owner. An attack is a battle message
 * the member synced (the attacker and the syncer are the same person; other members have their own limits), at a
 * target that is not their own and without them on the defending side of the archived report (holding an ally's
 * planet). Null when the universe has no bash limit.
 */
export function bashLimits(db: DB, ctx: GroupContext, userId = ctx.user.id): BashLimits | null {
  const rule = bashRuleOf(ctx.universe.settings);
  if (!rule) return null;
  const window = rule.hours * 3600;
  const own = memberPlayer(db, ctx, userId);
  const rows = db
    .prepare(
      `SELECT b.time, b.g, b.s, b.p, b.planet_type, b.report_id, pl.player_id
       FROM battle_reports b LEFT JOIN planets pl ON pl.group_id = b.group_id AND pl.g = b.g AND pl.s = b.s AND pl.p = b.p
       WHERE b.group_id = ? AND b.user_id = ? AND b.time > ? AND b.time <= ? ORDER BY b.time`,
    )
    .all(ctx.groupId, userId, ctx.now - window, ctx.now) as Row[];
  if (!rows.length) return { hours: rule.hours, planetLimit: rule.planet, playerLimit: rule.player, players: [], targets: [] };

  // names of the member in archived reports: defending in one means they held someone else's planet
  const names = new Set(
    (
      db
        .prepare(
          `SELECT name FROM players WHERE id = ? AND group_id = ?
           UNION SELECT ingame_name FROM group_members WHERE group_id = ? AND user_id = ? AND ingame_name IS NOT NULL`,
        )
        .pluck()
        .all(own, ctx.groupId, ctx.groupId, userId) as string[]
    ).map((n) => n.toLowerCase()),
  );
  const report = db.prepare(
    `SELECT fleets FROM combat_reports WHERE group_id = ? AND (report_id = ? OR (g = ? AND s = ? AND p = ? AND planet_type = ? AND ABS(time - ?) <= ?))
     ORDER BY report_id = ? DESC LIMIT 1`,
  );
  const defending = (r: Row) => {
    const fleets = report.pluck().get(ctx.groupId, r.report_id, r.g, r.s, r.p, r.planet_type, r.time, REPORT_SLACK, r.report_id) as string | undefined;
    if (!fleets) return false;
    const sides = new Set((JSON.parse(fleets) as [number, string][]).filter(([, n]) => names.has(String(n).toLowerCase())).map(([side]) => side));
    return sides.has(1) && !sides.has(0);
  };

  const targets = new Map<string, BashTarget>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (own != null && r.player_id === own) continue;
    // the same battle stored twice (e.g. as HTML and as text without message id)
    const key = `${r.g}:${r.s}:${r.p}:${r.planet_type}`;
    if (seen.has(`${key}@${r.time}`)) continue;
    seen.add(`${key}@${r.time}`);
    if (defending(r)) continue;
    let t = targets.get(key);
    if (!t) targets.set(key, (t = { g: r.g, s: r.s, p: r.p, planet_type: r.planet_type, playerId: r.player_id, resets: [] }));
    t.resets.push(r.time + window);
  }
  const players = new Map<number, number[]>();
  for (const t of targets.values()) if (t.playerId != null) players.set(t.playerId, [...(players.get(t.playerId) ?? []), ...t.resets]);
  return {
    hours: rule.hours,
    planetLimit: rule.planet,
    playerLimit: rule.player,
    players: [...players].map(([playerId, resets]) => ({ playerId, resets: resets.sort((a, b) => a - b) })),
    targets: [...targets.values()],
  };
}

/** Only what concerns one player (their profile) or one solar system (galaxy view). */
export function bashOf(limits: BashLimits | null, keep: { playerId?: number; g?: number; s?: number }): BashLimits | null {
  if (!limits) return null;
  const targets = limits.targets.filter((t) =>
    keep.playerId != null ? t.playerId === keep.playerId : t.g === keep.g && t.s === keep.s,
  );
  const ids = new Set(keep.playerId != null ? [keep.playerId] : targets.map((t) => t.playerId));
  return { ...limits, players: limits.players.filter((p) => ids.has(p.playerId)), targets };
}
