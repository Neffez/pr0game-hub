import type { CombatFleet, CombatReportRecord } from '@pr0hub/core/combat';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { memberPlayers } from './members.js';

/** Battles count for a plan from an hour before its time until an hour after its (day/hour) window (as in the draft). */
const BATTLE_SLACK = 3600;
/** Fleet rows per plan (as in the raid planner). */
const MAX_FLEETS = 32;
/** Hold fleets land 1 s before the impact (as in the raid planner). */
const HOLD_OFFSET = -1;

type Body = { g: number; s: number; p: number; type: 'planet' | 'moon' };
const lower = (s: string) => s.trim().toLowerCase();
const bodyOf = (f: CombatFleet): Body | null => (f.from ? { ...f.from.coords, type: f.from.type } : null);
const shipsOf = (f: CombatFleet) => Object.fromEntries(Object.entries(f.start).filter(([id, n]) => Number(id) >= 200 && Number(id) < 300 && n > 0));

/** Member by a name in a battle report: in-game name, hub name or the name of the member's player in the galaxy data. */
export function memberByName(db: DB, ctx: GroupContext): (name: string) => number | null {
  const players = memberPlayers(db, ctx);
  const playerName = db.prepare('SELECT name FROM players WHERE id = ?').pluck();
  const byName = new Map<string, number>();
  const members = db
    .prepare('SELECT m.user_id, m.ingame_name, u.username FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
    .all(ctx.groupId) as { user_id: number; ingame_name: string | null; username: string }[];
  for (const m of members) {
    const player = players.get(m.user_id);
    if (player != null) {
      const name = playerName.get(player) as string | undefined;
      if (name) byName.set(lower(name), m.user_id);
    }
    if (m.ingame_name) byName.set(lower(m.ingame_name), m.user_id);
    byName.set(lower(m.username), m.user_id);
  }
  return (name) => byName.get(lower(name)) ?? null;
}

/** Member of a battle report fleet: by the name (`memberByName`), else by the owner of the planet it comes from. */
function memberOfFleet(db: DB, ctx: GroupContext): (f: CombatFleet) => number | null {
  const byName = memberByName(db, ctx);
  const players = memberPlayers(db, ctx);
  const byPlayer = new Map([...players].filter(([, player]) => player != null).map(([userId, player]) => [player!, userId]));
  const owner = db.prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND player_id IS NOT NULL').pluck();
  return (f) => {
    const named = byName(f.name);
    if (named != null) return named;
    if (!f.from) return null;
    const player = owner.get(ctx.groupId, f.from.coords.g, f.from.coords.s, f.from.coords.p) as number | undefined;
    return player != null ? (byPlayer.get(player) ?? null) : null;
  };
}

export type ReportMission = 'attack' | 'hold';
export type ReportPlanResult =
  | { ok: true; id: number; existing: boolean; mission: ReportMission }
  | { ok: false; code: 'report_no_target' | 'report_no_member' };

/**
 * Raid plan for a battle report after the fact, to settle it: an attack when members attacked, a hold when members
 * defended (`mission` decides when given). A plan at the same target around that time with the same mission is taken
 * instead of a new one. The new plan is done; members' fleets are launched with their start planet and the ships before
 * the battle (speed 100 %, so the draft computes their deuterium), non-members are guests. A hold keeps the attacked
 * member (first defender) and the attackers as the enemy.
 */
export function planFromReport(
  db: DB, ctx: GroupContext, report: CombatReportRecord, time: number, mission: ReportMission | null,
): ReportPlanResult {
  const target = report.target;
  if (!target) return { ok: false, code: 'report_no_target' };
  const memberOf = memberOfFleet(db, ctx);
  const attackers = report.fleets.filter((f) => f.side === 'attacker');
  const defenders = report.fleets.filter((f) => f.side === 'defender');
  const kind: ReportMission | null =
    mission ?? (attackers.some((f) => memberOf(f) != null) ? 'attack' : defenders.some((f) => memberOf(f) != null) ? 'hold' : null);
  if (!kind) return { ok: false, code: 'report_no_member' };
  const ours = kind === 'attack' ? attackers : defenders;
  if (!ours.some((f) => memberOf(f) != null)) return { ok: false, code: 'report_no_member' };
  const t = target.coords;

  const existing = db
    .prepare(
      `SELECT id FROM attack_plans WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ? AND mission = ? AND status <> 'cancelled'
         AND ? BETWEEN target_time - ${BATTLE_SLACK}
           AND target_time + (CASE time_precision WHEN 'day' THEN 86400 WHEN 'hour' THEN 3600 ELSE 0 END) + ${BATTLE_SLACK}
       ORDER BY ABS(target_time - ?) LIMIT 1`,
    )
    .pluck()
    .get(ctx.groupId, t.g, t.s, t.p, target.type, kind, time, time) as number | undefined;
  if (existing != null) return { ok: true, id: existing, existing: true, mission: kind };

  const playerQuery = db.prepare('SELECT id, name FROM players WHERE group_id = ? AND name = ? COLLATE NOCASE');
  const playerByName = (name: string) => (playerQuery.get(ctx.groupId, name) as { id: number; name: string } | undefined) ?? null;
  // the attacked member of a hold stands on the target: no fleet of theirs
  const attacked = kind === 'hold' ? memberOf(defenders[0]) : null;
  const fleets: { userId: number; from: Body; ships: Record<string, number> }[] = [];
  const guests: { player: { id: number; name: string } | null; name: string; from: Body; mission: number | null; ships: Record<string, number> }[] = [];
  ours.forEach((f, i) => {
    const from = bodyOf(f);
    const ships = shipsOf(f);
    if (!from || !Object.keys(ships).length || (kind === 'hold' && i === 0)) return;
    const userId = memberOf(f);
    if (userId != null) {
      if (fleets.length < MAX_FLEETS) fleets.push({ userId, from, ships });
      return;
    }
    const player = playerByName(f.name);
    guests.push({ player, name: f.name, from, mission: kind === 'hold' ? 5 : attackers.length > 1 ? 2 : 1, ships });
  });

  const playerId =
    kind === 'attack'
      ? ((db.prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ?').pluck().get(ctx.groupId, t.g, t.s, t.p) as
          | number
          | null
          | undefined) ?? playerByName(defenders[0]?.name ?? '')?.id ?? null)
      : null;
  const id = db.transaction(() => {
    const planId = Number(
      db
        .prepare(
          `INSERT INTO attack_plans (group_id, user_id, player_id, g, s, p, planet_type, target_time, time_precision, mission, status, guests)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'exact', ?, 'done', ?)`,
        )
        .run(ctx.groupId, ctx.user.id, playerId, t.g, t.s, t.p, target.type, time, kind, guests.length ? JSON.stringify(guests) : null).lastInsertRowid,
    );
    const insert = db.prepare(
      `INSERT INTO attack_plan_fleets (plan_id, user_id, g, s, p, planet_type, ships, status, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'launched', ?)`,
    );
    for (const f of fleets) {
      insert.run(planId, f.userId, f.from.g, f.from.s, f.from.p, f.from.type, JSON.stringify(f.ships), f.userId === ctx.user.id ? null : ctx.user.id);
    }
    if (kind === 'hold') {
      const lead = attackers[0];
      const from = (lead && bodyOf(lead)) ?? { ...t, type: target.type };
      const enemy = attackers.map((f) => ({ mission: attackers.length > 1 ? 2 : 1, ships: shipsOf(f) }));
      db.prepare(
        `INSERT INTO attack_plan_enemy (plan_id, member_id, from_g, from_s, from_p, from_type, to_g, to_s, to_p, to_type, fleets, follow,
           arrival, first_seen, drives, buffer, hold_offset, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '{}', 1, ?, ?)`,
      ).run(planId, attacked, from.g, from.s, from.p, from.type, t.g, t.s, t.p, target.type, JSON.stringify(enemy), time, time, HOLD_OFFSET, ctx.user.id);
    }
    return planId;
  })();
  return { ok: true, id, existing: false, mission: kind };
}
