import { CLASS_BUILDINGS, CLASS_DEFENSE, CLASS_FLEET, CLASS_RESEARCH, CLASS_RESOURCES, sectionPoints } from '@pr0hub/core/tech';
import { positionTemp, projectResources, SOLAR_SATELLITE } from '@pr0hub/core/production';
import { unitCost, withUnits, type UnitCatalog } from '@pr0hub/core/units';
import { defenseIds, shipIds, type RiskInput, type RiskResult } from '@pr0hub/battle';
import { HttpError } from '../auth.js';
import { runRiskInWorker, simSettingsOf, throttle } from '../battle.js';
import { catalogOf, type GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { rateOf } from './defense.js';
import { economyOf } from './economy.js';
import { latestEmpire } from './empire.js';
import { inactivities, type Inactivity } from './inactivity.js';
import { memberPlayer, memberPlayers } from './members.js';
import { latestScores } from './stats.js';

/** Units that don't defend a planet in the farm finder's quick check: solar satellites, spy probes, missiles. */
const HARMLESS = new Set([210, 212, 502, 503]);
const DAY = 86400;
/** Espionage technology */
const ESPIONAGE = 106;
/** Units left out of the combat strength: civil ships (cargos, colony ship, recycler, probe, solar satellite) and missiles. */
const NON_COMBAT = new Set([202, 203, 208, 209, 210, 212, 502, 503]);
/** Ships the farm simulation sends besides the combat ships: the cargos (loot and fodder). */
const SIM_CARGO = new Set([202, 203]);
/** Weapons, shields and armour technology */
const COMBAT_TECHS = [109, 110, 111];

/** Points (game formula) of the units of a section that fight. */
export function combatPoints(values: Record<string, number>, catalog: UnitCatalog): number {
  const fighting = Object.fromEntries(Object.entries(values).filter(([id, n]) => !NON_COMBAT.has(Number(id)) && catalog.units[id] && n > 0));
  return withUnits(catalog, () => sectionPoints(fighting) ?? 0);
}

/**
 * Combat strength of a target, the farm finder's risk: fleet and defense from the newest report that shows them plus
 * what the player's statistics gained in that category since (a report that is out of date counts as stronger), else
 * the player's statistics (all planets together: an upper bound; 0 means none anywhere).
 */
export interface FarmStrength {
  fleet: number | null;
  fleetFrom: 'report' | 'stats' | null;
  defense: number | null;
  defenseFrom: 'report' | 'stats' | null;
  /** fleet or defense points gained since the report are included */
  grown: boolean;
}

/** The viewer's combat fleet: ships of the newest own empire page (in flight included), else the fleet statistics. */
export interface OwnFleet {
  points: number | null;
  from: 'empire' | 'stats' | null;
  time: number | null;
  /** combat ships of the empire page (their speeds give the fleet's flight time), null without one */
  ships: Record<string, number> | null;
}

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
  strength: FarmStrength;
  /** debris field of the ships in the newest report with a fleet (universe's debris share), null without one */
  fleetDebris: { 901: number; 902: number } | null;
}

/** Ships of the newest own empire page, on the planets and in flight. */
function empireShips(db: DB, ctx: GroupContext, catalog: UnitCatalog) {
  const empire = latestEmpire(db, ctx, ctx.user.id);
  if (!empire) return null;
  const ships: Record<string, number> = {};
  const add = (values: Record<string | number, number> | undefined) => {
    for (const [id, n] of Object.entries(values ?? {})) if (catalog.ships.includes(Number(id)) && n > 0) ships[id] = (ships[id] ?? 0) + n;
  };
  for (const pl of empire.rec.planets) add(pl.values);
  add(empire.rec.flyingShips);
  return { ships, research: empire.rec.research as Record<string, number>, time: empire.time };
}

/** The viewer's combat fleet points: the newest empire page when it shows combat ships, else the fleet statistics. */
export function ownFleet(db: DB, ctx: GroupContext, catalog: UnitCatalog): OwnFleet {
  const empire = empireShips(db, ctx, catalog);
  const points = empire ? combatPoints(empire.ships, catalog) : 0;
  const ships = empire ? Object.fromEntries(Object.entries(empire.ships).filter(([id]) => !NON_COMBAT.has(Number(id)))) : null;
  if (empire && points > 0) return { points, from: 'empire', time: empire.time, ships };
  const mine = memberPlayer(db, ctx, ctx.user.id);
  const stat = mine != null ? latestScores(db, ctx.groupId, [mine], [2]).get(mine)?.[2] : undefined;
  if (stat) return { points: stat.points, from: 'stats', time: stat.time, ships };
  return empire ? { points: 0, from: 'empire', time: empire.time, ships } : { points: null, from: null, time: null, ships: null };
}

/**
 * The newest spy report with resources (since `since`) of every spied planet or moon, with its owner now: the
 * galaxy's, else the report's; positions destroyed or with a different owner since are left out. `players`: those
 * owners (name, status, alliance).
 */
export function spiedTargets(db: DB, ctx: GroupContext, since: number) {
  const g = ctx.groupId;
  const newest = db
    .prepare(
      `SELECT g, s, p, planet_type, planet_name, player_id, player_name, MAX(report_time) AS report_time, json_extract(sections, ?) AS res, COUNT(*) AS count
       FROM spy_reports WHERE group_id = ? AND report_time >= ? AND p <= ? AND json_extract(sections, ?) IS NOT NULL GROUP BY g, s, p, planet_type`,
    )
    .all(`$."${CLASS_RESOURCES}"`, g, since, ctx.universe.settings.positions, `$."${CLASS_RESOURCES}"`) as {
    g: number; s: number; p: number; planet_type: 'planet' | 'moon'; planet_name: string | null; player_id: number | null; player_name: string | null;
    report_time: number; res: string; count: number;
  }[];
  const positions = new Map(
    (newest.length
      ? (db.prepare('SELECT g, s, p, player_id, destroyed, has_moon, moon_diameter FROM planets WHERE group_id = ?').all(g) as {
          g: number; s: number; p: number; player_id: number | null; destroyed: number; has_moon: number; moon_diameter: number | null;
        }[])
      : []
    ).map((r) => [`${r.g}:${r.s}:${r.p}`, r]),
  );
  const owned = newest.flatMap((r) => {
    const pos = positions.get(`${r.g}:${r.s}:${r.p}`);
    if (pos && (pos.destroyed || (r.planet_type === 'moon' && !pos.has_moon))) return [];
    const playerId = pos?.player_id ?? r.player_id;
    if (playerId == null || (r.player_id != null && playerId !== r.player_id)) return [];
    return [{ ...r, playerId }];
  });
  const ids = [...new Set(owned.map((r) => r.playerId))];
  const players = new Map(
    (ids.length
      ? (db
          .prepare(
            `SELECT p.id, p.name, p.status, p.alliance_id, a.tag AS ally_tag FROM json_each(?) id
             JOIN players p ON p.id = id.value AND p.group_id = ? LEFT JOIN alliances a ON a.id = p.alliance_id`,
          )
          .all(JSON.stringify(ids), g) as { id: number; name: string; status: string; alliance_id: number | null; ally_tag: string | null }[])
      : []
    ).map((p) => [p.id, p]),
  );
  return { newest, positions, owned, players };
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
  const own = ownFleet(db, ctx, catalog);
  const rate = rateOf(db, ctx);
  const debrisShare = simSettingsOf(settings, {}).fleetDebris / 100;

  // the own alliance: members' players and the in-game alliance of the viewer's player
  const members = new Set([...memberPlayers(db, ctx).values()].filter((id): id is number => id != null));
  const mine = memberPlayer(db, ctx, ctx.user.id);
  const ownAlly = mine != null ? ((db.prepare('SELECT alliance_id FROM players WHERE id = ? AND group_id = ?').pluck().get(mine, g) as number | null) ?? null) : null;

  const { newest, positions, owned, players } = spiedTargets(db, ctx, since);
  if (!newest.length) return { targets: [] as FarmTarget[], resourceSpeed, speedSource, storageFactor, own, rate: { ...rate.value, source: rate.source } };

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
  const battles = new Map(
    (db
      .prepare('SELECT g, s, p, planet_type, MAX(COALESCE(time, created_at)) AS last FROM battle_reports WHERE group_id = ? GROUP BY g, s, p, planet_type')
      .all(g) as { g: number; s: number; p: number; planet_type: string; last: number }[]).map((r) => [key(r), r.last]),
  );

  const ids = [...players.keys()];
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
    const defense = defenses.get(k);
    const stats = scores.get(player.id);
    const side = (sec: { time: number; values: Record<string, number> } | undefined, type: 2 | 5) => {
      if (sec) {
        const gained = Math.max(0, changesOf(player.id, sec.time)[type] ?? 0);
        return { value: combatPoints(sec.values, catalog) + gained, from: 'report' as const, grown: gained > 0 };
      }
      const stat = stats?.[type];
      return stat ? { value: stat.points, from: 'stats' as const, grown: false } : { value: null, from: null, grown: false };
    };
    const fleetSide = side(fleet, 2);
    const defenseSide = side(defense, 5);
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
      defense: sectionOf(defense),
      lastBattle: battles.get(k) ?? null,
      inactivity: inactive.get(player.id) ?? null,
      changes: changesOf(player.id, r.report_time),
      espionage: research.get(player.id)?.[ESPIONAGE] ?? null,
      ...(r.planet_type === 'moon' ? { moonDiameter: positions.get(`${r.g}:${r.s}:${r.p}`)?.moon_diameter ?? null } : {}),
      strength: { fleet: fleetSide.value, fleetFrom: fleetSide.from, defense: defenseSide.value, defenseFrom: defenseSide.from, grown: fleetSide.grown || defenseSide.grown },
      fleetDebris: fleet ? fleetDebrisOf(fleet.values, catalog, debrisShare) : null,
    });
  }
  return { targets, resourceSpeed, speedSource, storageFactor, own, rate: { ...rate.value, source: rate.source } };
}

/** Debris field of the ships of a report section: the universe's share of their metal and crystal. */
function fleetDebrisOf(values: Record<string, number>, catalog: UnitCatalog, share: number) {
  let m = 0;
  let k = 0;
  for (const [id, n] of Object.entries(values)) {
    const cost = catalog.ships.includes(Number(id)) && n > 0 ? unitCost(id, catalog) : undefined;
    if (!cost) continue;
    m += cost[0] * n;
    k += cost[1] * n;
  }
  return { 901: Math.floor(m * share), 902: Math.floor(k * share) };
}

// ---- farm simulation: the own fleet against the first targets of the list ------------------------------------------

export const FARM_SIM_MAX = 25;
const SIM_RUNS = 6;
const SIM_WORK = 40_000_000;

export interface FarmSimTarget {
  g: number;
  s: number;
  p: number;
  type: 'planet' | 'moon';
  /** resources expected on the target (the client's projection), else the newest report's */
  resources: { metal: number; crystal: number; deuterium: number } | null;
}

export interface FarmSimRequest {
  targets: FarmSimTarget[];
  /** send only the combat ships (the fleet finder), the cargos too when there are none */
  combatOnly: boolean;
}

/** Parses the request body of the farm simulation (400 on anything else). */
export function parseFarmSim(body: unknown, positions: number): FarmSimRequest {
  const bad = (m: string) => new HttpError(400, 'farm_sim_invalid', m);
  const combatOnly = (body as { combatOnly?: unknown } | null)?.combatOnly ?? false;
  if (typeof combatOnly !== 'boolean') throw bad('combatOnly: boolean');
  const list = (body as { targets?: unknown } | null)?.targets;
  if (!Array.isArray(list) || !list.length || list.length > FARM_SIM_MAX) throw bad(`targets: 1-${FARM_SIM_MAX} entries`);
  const int = (v: unknown, min: number, max: number, what: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(`${what}: integer ${min}-${max}`);
    return v;
  };
  const targets = list.map((x: unknown): FarmSimTarget => {
    if (!x || typeof x !== 'object') throw bad('target: object');
    const o = x as Record<string, unknown>;
    const type = o.type === 'moon' ? 'moon' : o.type === 'planet' || o.type == null ? 'planet' : null;
    if (!type) throw bad('type: planet or moon');
    const r = o.resources as Record<string, unknown> | null | undefined;
    const max = Number.MAX_SAFE_INTEGER;
    return {
      g: int(o.g, 1, 99, 'g'),
      s: int(o.s, 1, 999, 's'),
      p: int(o.p, 1, positions, 'p'),
      type,
      resources: r ? { metal: int(r.metal, 0, max, 'metal'), crystal: int(r.crystal, 0, max, 'crystal'), deuterium: int(r.deuterium, 0, max, 'deuterium') } : null,
    };
  });
  return { targets, combatOnly };
}

/**
 * The own fleet (combat ships and cargos of the newest empire page, in flight included, with its research; with
 * `combatOnly` the combat ships alone when there are any) against each target as the newest reports show it: fleet,
 * defense, the player's combat research. A target without a report of its fleet or defense is not simulated
 * (`reason: no_report`); one left out for the engine budget gets `budget`.
 */
export async function farmSimulation(db: DB, ctx: GroupContext, { targets: list, combatOnly }: FarmSimRequest) {
  const catalog = catalogOf(ctx.universe);
  const empire = empireShips(db, ctx, catalog);
  const pick = (cargo: boolean) =>
    empire ? Object.fromEntries(Object.entries(empire.ships).filter(([id]) => !NON_COMBAT.has(Number(id)) || (cargo && SIM_CARGO.has(Number(id))))) : {};
  const combat = combatOnly ? pick(false) : {};
  const units = Object.keys(combat).length ? combat : pick(true);
  if (!empire || !Object.keys(units).length) throw new HttpError(409, 'no_fleet', 'No ships in the newest own empire page');
  const research = Object.fromEntries(COMBAT_TECHS.map((id) => [id, empire.research[id] ?? 0]));
  // costs of the attacking fleet: the losses as a share of it
  const cost = Object.entries(units).reduce((sum, [id, n]) => {
    const c = unitCost(id, catalog);
    return sum + (c ? (c[0] + c[1] + c[2]) * n : 0);
  }, 0);

  const g = ctx.groupId;
  const newestSection = db.prepare(
    `SELECT json_extract(sections, ?) AS v, player_id FROM spy_reports
     WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ? AND json_extract(sections, ?) IS NOT NULL ORDER BY report_time DESC LIMIT 1`,
  );
  const playerResearch = db
    .prepare(`SELECT json_extract(sections, ?) FROM spy_reports WHERE group_id = ? AND player_id = ? AND json_extract(sections, ?) IS NOT NULL ORDER BY report_time DESC LIMIT 1`)
    .pluck();
  const fighting = new Set([...shipIds(catalog), ...defenseIds(catalog)]);

  const planets: RiskInput['planets'] = [];
  const keyOf = (t: FarmSimTarget) => `${t.g}:${t.s}:${t.p}:${t.type}`;
  for (const t of list) {
    const sec = (cls: number) => newestSection.get(`$."${cls}"`, g, t.g, t.s, t.p, t.type, `$."${cls}"`) as { v: string; player_id: number | null } | undefined;
    const fleet = sec(CLASS_FLEET);
    const def = sec(CLASS_DEFENSE);
    if (!fleet && !def) continue;
    const res = t.resources ? null : sec(CLASS_RESOURCES);
    const playerId = fleet?.player_id ?? def?.player_id ?? null;
    const techs = playerId != null ? (playerResearch.get(`$."${CLASS_RESEARCH}"`, g, playerId, `$."${CLASS_RESEARCH}"`) as string | undefined) : undefined;
    const values: Record<string, number> = { ...JSON.parse(fleet?.v ?? '{}'), ...JSON.parse(def?.v ?? '{}') };
    const theirs = JSON.parse(techs ?? '{}') as Record<string, number>;
    const r = res ? (JSON.parse(res.v) as Record<string, number>) : null;
    planets.push({
      key: keyOf(t),
      planet: {
        units: Object.fromEntries(Object.entries(values).filter(([id, n]) => fighting.has(Number(id)) && n > 0)),
        research: Object.fromEntries(COMBAT_TECHS.map((id) => [id, theirs[id] ?? 0])),
      },
      resources: t.resources ?? { metal: r?.[901] ?? 0, crystal: r?.[902] ?? 0, deuterium: r?.[903] ?? 0 },
      threats: [{ key: 'own', units, research, fuel: 0 }],
    });
  }

  let result: RiskResult | null = null;
  if (planets.length) {
    throttle(ctx.user.id);
    result = await runRiskInWorker(
      { planets, rate: rateOf(db, ctx).value, debris: true, runs: SIM_RUNS, work: SIM_WORK },
      simSettingsOf(ctx.universe.settings, {}),
      ctx.universe.units,
    );
  }
  const outcomes = new Map((result?.planets ?? []).map((p) => [p.key, p]));
  return {
    fleet: { units, research, time: empire.time, cost },
    runs: result?.runs ?? 0,
    results: list.map((t) => {
      const o = outcomes.get(keyOf(t));
      const w = o?.worst ?? null;
      return {
        g: t.g,
        s: t.s,
        p: t.p,
        type: t.type,
        reason: !o ? ('no_report' as const) : !w ? ('budget' as const) : null,
        outcome: w
          ? {
              wins: w.wins,
              profit: Math.round(w.profit),
              loot: w.loot,
              debris: w.debris,
              lost: w.lost,
              lostShare: cost > 0 ? (w.lost.metal + w.lost.crystal + w.lost.deuterium) / cost : 0,
              defenderLost: w.defenderLost,
            }
          : null,
      };
    }),
  };
}
