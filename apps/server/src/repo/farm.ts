import { CLASS_BUILDINGS, CLASS_DEFENSE, CLASS_FLEET, CLASS_RESEARCH, CLASS_RESOURCES, sectionPoints } from '@pr0hub/core/tech';
import { positionTemp, projectResources, SOLAR_SATELLITE } from '@pr0hub/core/production';
import { withUnits } from '@pr0hub/core/units';
import { catalogOf, type GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { economyOf } from './economy.js';
import { inactivities, type Inactivity } from './inactivity.js';
import { memberPlayer, memberPlayers } from './members.js';
import { latestScores } from './stats.js';

/** Units that don't defend a planet in the farm finder's quick check: solar satellites, spy probes, missiles. */
const HARMLESS = new Set([210, 212, 502, 503]);
const DAY = 86400;
/** Espionage technology */
const ESPIONAGE = 106;

export interface FarmSection {
  time: number;
  /** points of the section (game formula), null for an empty one */
  points: number | null;
  /** units that fight (solar satellites, probes and missiles left out) */
  units: number;
}

export interface FarmTarget {
  g: number;
  s: number;
  p: number;
  type: 'planet' | 'moon';
  name: string | null;
  player: { id: number; name: string; status: string[]; ally_tag: string | null; points: number | null };
  /** newest report with resources: when and what it showed */
  report: { time: number; resources: Record<number, number>; count: number };
  /** mines, power plants and storages from the newest report with buildings; null when no report showed them */
  levels: { time: number; values: Record<string, number> } | null;
  /** expected resources now: production since the report (from the levels), capped by the storages */
  projected: Record<number, number>;
  perHour: Record<number, number>;
  full: Record<number, boolean>;
  /** loot of a won attack: at most half of each resource */
  loot: Record<number, number>;
  fleet: FarmSection | null;
  defense: FarmSection | null;
  lastBattle: number | null;
  inactivity: Inactivity | null;
  /** points gained per category (1 total, 2 fleet, 5 defense) since the report, null without statistics on both sides */
  changes: Record<1 | 2 | 5, number | null>;
  /** the player's espionage level from the newest report with research */
  espionage: number | null;
  /** moons: the diameter from the galaxy view (moon destruction calculator), null when unknown */
  moonDiameter?: number | null;
}

/**
 * Farm finder: every spied planet or moon of players outside the own alliance with what it is worth now, from the
 * newest spy report with resources (within `days`) plus the production since then. Positions that changed owner or
 * were destroyed since the report are left out. Sorting and the flight math are the web app's.
 */
export function farmTargets(db: DB, ctx: GroupContext, days: number) {
  const g = ctx.groupId;
  const settings = ctx.universe.settings;
  const catalog = catalogOf(ctx.universe);
  const since = ctx.now - days * DAY;

  const { resourceSpeed, speedSource, storageFactor } = economyOf(db, ctx);

  // the own alliance: members' players and the in-game alliance of the viewer's player
  const members = new Set([...memberPlayers(db, ctx).values()].filter((id): id is number => id != null));
  const mine = memberPlayer(db, ctx, ctx.user.id);
  const ownAlly = mine != null ? ((db.prepare('SELECT alliance_id FROM players WHERE id = ? AND group_id = ?').pluck().get(mine, g) as number | null) ?? null) : null;

  const newest = db
    .prepare(
      `SELECT g, s, p, planet_type, planet_name, player_id, player_name, MAX(report_time) AS report_time, json_extract(sections, ?) AS res, COUNT(*) AS count
       FROM spy_reports WHERE group_id = ? AND report_time >= ? AND p <= ? AND json_extract(sections, ?) IS NOT NULL GROUP BY g, s, p, planet_type`,
    )
    .all(`$."${CLASS_RESOURCES}"`, g, since, settings.positions, `$."${CLASS_RESOURCES}"`) as {
    g: number; s: number; p: number; planet_type: 'planet' | 'moon'; planet_name: string | null; player_id: number | null; player_name: string | null;
    report_time: number; res: string; count: number;
  }[];
  if (!newest.length) return { targets: [] as FarmTarget[], resourceSpeed, speedSource, storageFactor };

  const key = (r: { g: number; s: number; p: number; planet_type: string }) => `${r.g}:${r.s}:${r.p}:${r.planet_type}`;
  /** per position the newest report that has the section (any age: buildings change slowly) */
  const section = (cls: number) =>
    new Map(
      (db
        .prepare(
          `SELECT g, s, p, planet_type, json_extract(sections, ?) AS v, MAX(report_time) AS time FROM spy_reports
           WHERE group_id = ? AND p <= ? AND json_extract(sections, ?) IS NOT NULL GROUP BY g, s, p, planet_type`,
        )
        .all(`$."${cls}"`, g, settings.positions, `$."${cls}"`) as { g: number; s: number; p: number; planet_type: string; v: string; time: number }[]).map((r) => [
        key(r),
        { time: r.time, values: JSON.parse(r.v) as Record<string, number> },
      ]),
    );
  const buildings = section(CLASS_BUILDINGS);
  const fleets = section(CLASS_FLEET);
  const defenses = section(CLASS_DEFENSE);
  const research = new Map(
    (db
      .prepare(
        `SELECT player_id, json_extract(sections, ?) AS v, MAX(report_time) AS time FROM spy_reports
         WHERE group_id = ? AND player_id IS NOT NULL AND json_extract(sections, ?) IS NOT NULL GROUP BY player_id`,
      )
      .all(`$."${CLASS_RESEARCH}"`, g, `$."${CLASS_RESEARCH}"`) as { player_id: number; v: string }[]).map((r) => [r.player_id, JSON.parse(r.v) as Record<string, number>]),
  );
  const positions = new Map(
    (db.prepare('SELECT g, s, p, player_id, destroyed, has_moon, moon_diameter FROM planets WHERE group_id = ?').all(g) as {
      g: number; s: number; p: number; player_id: number | null; destroyed: number; has_moon: number; moon_diameter: number | null;
    }[]).map((r) => [`${r.g}:${r.s}:${r.p}`, r]),
  );
  const battles = new Map(
    (db
      .prepare('SELECT g, s, p, planet_type, MAX(COALESCE(time, created_at)) AS last FROM battle_reports WHERE group_id = ? GROUP BY g, s, p, planet_type')
      .all(g) as { g: number; s: number; p: number; planet_type: string; last: number }[]).map((r) => [key(r), r.last]),
  );

  // the target's owner now: the galaxy's, else the report's
  const owned = newest.flatMap((r) => {
    const pos = positions.get(`${r.g}:${r.s}:${r.p}`);
    if (pos && (pos.destroyed || (r.planet_type === 'moon' && !pos.has_moon))) return [];
    const playerId = pos?.player_id ?? r.player_id;
    if (playerId == null || (r.player_id != null && playerId !== r.player_id)) return [];
    return [{ ...r, playerId }];
  });
  const ids = [...new Set(owned.map((r) => r.playerId))];
  const players = new Map(
    (db
      .prepare(
        `SELECT p.id, p.name, p.status, p.alliance_id, a.tag AS ally_tag FROM json_each(?) id
         JOIN players p ON p.id = id.value AND p.group_id = ? LEFT JOIN alliances a ON a.id = p.alliance_id`,
      )
      .all(JSON.stringify(ids), g) as { id: number; name: string; status: string; alliance_id: number | null; ally_tag: string | null }[]).map((p) => [p.id, p]),
  );
  const scores = latestScores(db, g, ids, [1, 2, 5]);
  // the score of a category at the last statistics update before a report (index player_scores_history)
  const scoreAt = db.prepare(
    `SELECT ps.points FROM player_scores ps JOIN players p ON p.id = ps.player_id AND p.group_id = ?
     WHERE ps.player_id = ? AND ps.type = ? AND ps.stat_time <= ? ORDER BY ps.stat_time DESC LIMIT 1`,
  ).pluck();
  const changesOf = (playerId: number, time: number) => {
    const now = scores.get(playerId);
    const out = { 1: null, 2: null, 5: null } as Record<1 | 2 | 5, number | null>;
    for (const type of [1, 2, 5] as const) {
      const cur = now?.[type];
      if (!cur || cur.time <= time) continue;
      const before = scoreAt.get(g, playerId, type, time) as number | undefined;
      if (before != null) out[type] = cur.points - before;
    }
    return out;
  };
  const inactive = inactivities(db, ctx, ids);

  const sectionOf = (s: { time: number; values: Record<string, number> } | undefined): FarmSection | null =>
    s
      ? {
          time: s.time,
          points: withUnits(catalog, () => sectionPoints(s.values)),
          units: Object.entries(s.values).reduce((n, [id, v]) => n + (HARMLESS.has(Number(id)) ? 0 : Number(v) || 0), 0),
        }
      : null;

  const targets: FarmTarget[] = [];
  for (const r of owned) {
    const player = players.get(r.playerId);
    if (!player || members.has(player.id) || (ownAlly != null && player.alliance_id === ownAlly)) continue;
    const k = key(r);
    const resources = JSON.parse(r.res) as Record<number, number>;
    const built = buildings.get(k);
    const fleet = fleets.get(k);
    // moons have no mines: what the report showed is what there is
    const levels = r.planet_type === 'planet' && built ? { ...built.values, [SOLAR_SATELLITE]: fleet?.values[SOLAR_SATELLITE] ?? 0 } : null;
    const proj = projectResources({
      resources,
      levels: levels ?? {},
      research: research.get(player.id),
      temp: positionTemp(r.p),
      resourceSpeed: levels ? resourceSpeed : 0,
      storageFactor,
      hours: (ctx.now - r.report_time) / 3600,
    });
    const projected = levels ? proj.resources : { 901: resources[901] ?? 0, 902: resources[902] ?? 0, 903: resources[903] ?? 0 };
    targets.push({
      g: r.g, s: r.s, p: r.p, type: r.planet_type, name: r.planet_name,
      player: { id: player.id, name: player.name, status: JSON.parse(player.status || '[]'), ally_tag: player.ally_tag, points: scores.get(player.id)?.[1]?.points ?? null },
      report: { time: r.report_time, resources: { 901: resources[901] ?? 0, 902: resources[902] ?? 0, 903: resources[903] ?? 0 }, count: r.count },
      levels: built && levels ? { time: built.time, values: levels } : null,
      projected: { 901: Math.floor(projected[901]), 902: Math.floor(projected[902]), 903: Math.floor(projected[903]) },
      perHour: levels ? { 901: Math.round(proj.perHour[901]), 902: Math.round(proj.perHour[902]), 903: Math.round(proj.perHour[903]) } : { 901: 0, 902: 0, 903: 0 },
      full: levels ? proj.full : { 901: false, 902: false, 903: false },
      loot: { 901: Math.floor(projected[901] / 2), 902: Math.floor(projected[902] / 2), 903: Math.floor(projected[903] / 2) },
      fleet: sectionOf(fleet),
      defense: sectionOf(defenses.get(k)),
      lastBattle: battles.get(k) ?? null,
      inactivity: inactive.get(player.id) ?? null,
      changes: changesOf(player.id, r.report_time),
      espionage: research.get(player.id)?.[ESPIONAGE] ?? null,
      ...(r.planet_type === 'moon' ? { moonDiameter: positions.get(`${r.g}:${r.s}:${r.p}`)?.moon_diameter ?? null } : {}),
    });
  }
  return { targets, resourceSpeed, speedSource, storageFactor };
}
