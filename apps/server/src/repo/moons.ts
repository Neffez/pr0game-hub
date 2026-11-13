import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { DISPLAY } from '../routes/util.js';
import { memberPlayers } from './members.js';

const DAY = 86400;

export interface MoonBattle {
  reportId: string;
  time: number;
  g: number | null;
  s: number | null;
  p: number | null;
  /** chance in percent (plus the cascading extra), capped at 100 */
  chance: number;
  extra: number;
  created: boolean;
  attackers: string[];
  defenders: string[];
  /** the side a member fought on (by in-game names), null when no member took part */
  memberSide: 'attacker' | 'defender' | null;
  /** the position has a moon now (galaxy), with its diameter when known */
  moon: { diameter: number | null } | null;
}

export interface MoonMember {
  name: string;
  /** battles with a moon chance a member fought in */
  battles: number;
  /** expected moons: sum of the chances */
  expected: number;
  created: number;
}

/**
 * Moon chances (backlog B-6): battles of the group's combat reports within `days` that had a moon chance or created a
 * moon, with the sides, whether a member took part and whether the position has a moon now; per member the battles,
 * the expected moons (sum of the chances) and the moons created; moons that appeared at members' planets in the
 * galaxy within the period (also those whose battle report the hub doesn't have).
 */
export function moonChances(db: DB, ctx: GroupContext, days: number) {
  const g = ctx.groupId;
  const since = ctx.now - days * DAY;
  // members by their in-game name, hub username and linked player: lower-case game name -> hub display name
  const players = memberPlayers(db, ctx);
  const memberIds = [...players.values()].filter((id): id is number => id != null);
  const names = new Map<string, string>();
  for (const r of db
    .prepare(
      `SELECT m.user_id, m.ingame_name, u.username, ${DISPLAY} AS display FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?`,
    )
    .all(g) as { user_id: number; ingame_name: string | null; username: string; display: string }[]) {
    names.set(r.username.toLowerCase(), r.display);
    if (r.ingame_name) names.set(r.ingame_name.toLowerCase(), r.display);
    const player = players.get(r.user_id);
    const playerName = player != null ? (db.prepare('SELECT name FROM players WHERE id = ? AND group_id = ?').pluck().get(player, g) as string | undefined) : undefined;
    if (playerName) names.set(playerName.toLowerCase(), r.display);
  }

  const rows = db
    .prepare(
      `SELECT c.report_id, c.time, c.g, c.s, c.p, c.moon_chance, c.moon_extra, c.moon_created, c.fleets, pl.has_moon, pl.moon_diameter
       FROM combat_reports c
       LEFT JOIN planets pl ON pl.group_id = c.group_id AND pl.g = c.g AND pl.s = c.s AND pl.p = c.p
       WHERE c.group_id = ? AND c.time >= ? AND (c.moon_chance > 0 OR c.moon_created = 1) ORDER BY c.time DESC`,
    )
    .all(g, since) as {
    report_id: string; time: number; g: number | null; s: number | null; p: number | null; moon_chance: number | null; moon_extra: number; moon_created: number;
    fleets: string; has_moon: number | null; moon_diameter: number | null;
  }[];

  const perMember = new Map<string, MoonMember>();
  const battles: MoonBattle[] = rows.map((r) => {
    const fleets = JSON.parse(r.fleets) as [number, string, unknown][];
    const side = (n: number) => [...new Set(fleets.filter((f) => f[0] === n).map((f) => f[1]))];
    const attackers = side(0);
    const defenders = side(1);
    const chance = Math.min(100, (r.moon_chance ?? 0) + r.moon_extra);
    const inAttack = attackers.map((n) => names.get(n.toLowerCase())).filter((n): n is string => !!n);
    const inDefense = defenders.map((n) => names.get(n.toLowerCase())).filter((n): n is string => !!n);
    for (const name of new Set([...inAttack, ...inDefense])) {
      const m = perMember.get(name) ?? { name, battles: 0, expected: 0, created: 0 };
      m.battles++;
      m.expected += chance / 100;
      if (r.moon_created) m.created++;
      perMember.set(name, m);
    }
    return {
      reportId: r.report_id, time: r.time, g: r.g, s: r.s, p: r.p, chance, extra: r.moon_extra, created: !!r.moon_created, attackers, defenders,
      memberSide: inAttack.length ? 'attacker' : inDefense.length ? 'defender' : null,
      moon: r.has_moon ? { diameter: r.moon_diameter } : null,
    };
  });

  // moons that appeared at members' planets (galaxy syncs), with their diameter now
  const newMoons = db
    .prepare(
      `SELECT a.time, a.g, a.s, a.p, pr.name AS player, pl.moon_diameter AS diameter FROM activity_log a
       JOIN players pr ON pr.id = a.player_id
       LEFT JOIN planets pl ON pl.group_id = a.group_id AND pl.g = a.g AND pl.s = a.s AND pl.p = a.p AND pl.has_moon = 1
       WHERE a.group_id = ? AND a.kind = 'moon_new' AND a.time >= ? AND a.player_id IN (SELECT value FROM json_each(?)) ORDER BY a.time DESC`,
    )
    .all(g, since, JSON.stringify(memberIds)) as { time: number; g: number; s: number; p: number; player: string; diameter: number | null }[];

  const members = [...perMember.values()].map((m) => ({ ...m, expected: Math.round(m.expected * 100) / 100 })).sort((a, b) => b.expected - a.expected);
  return { battles, members, newMoons };
}
