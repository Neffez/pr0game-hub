import { CLASS_FLEET, elementPoints } from '@pr0hub/core/tech';
import { withUnits } from '@pr0hub/core/units';
import { catalogOf, type GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { latestEmpires } from './empire.js';
import { flightLines, sharedFleets, type StoredFleet } from './fleets.js';
import { hostileAttacks } from './hostile.js';
import { memberPlayers } from './members.js';
import { likeTerm } from './sql.js';
import { FLEET_DAYS } from './threats.js';

/**
 * The fleet a player has or last had (player page): every sighting the hub knows, with all ships (spy probes, solar
 * satellites and transporters too, unlike the defense advisor's attacking fleets), without an age limit:
 * - `spy`: the newest spy report with a fleet section per planet or moon (an empty section: no ships there),
 * - `spySum`: those reports of several bodies close in time added up, checked against the fleet points of the
 *   statistics (a fleet that moved between two spy reports would count twice),
 * - `battle`: the ships the player brought into one of their newest battles (battle hall, members' messages),
 * - `battles`: the most of each ship type over their battles of `FLEET_DAYS` up to the newest one,
 * - `incoming`: a fleet of theirs on its way to a member now,
 * - `empire`: for a member's player the ships on their planets and moons from their newest empire page (visible to the
 *   members on the fleet page anyway), plus their fleets in flight then from their fleet list as they share it, when
 *   that list was synced at most `FLIGHT_BEFORE` before the empire page or `FLIGHT_SLACK` after it.
 * `fleet` is the strongest sighting of the last `FLEET_DAYS` before the newest one (a sum only when it fits the
 * statistics): what they have at least, unless they lost ships meanwhile. The empire page is exact: with one, only
 * itself and newer sightings count.
 */

/** Spy reports of different bodies at most this far apart are added up (`spySum`). */
export const SUM_HOURS = 12;
/** Battles listed one by one, the newest. */
const BATTLES = 5;
/** A sum above the statistics by more than this share (plus rounding) counts ships twice; below `UNDER` part of the fleet is unseen. */
const OVER = 1.1;
const UNDER = 0.8;
/**
 * A fleet list synced this long after the empire page still tells the fleets in flight at the empire page (both pages
 * synced in one go); a later one may hold fleets launched since, which the empire page still shows on their planet.
 */
export const FLIGHT_SLACK = 15 * 60;
/** An older fleet list misses the fleets launched since; up to this age it still stands for the fleets in flight. */
export const FLIGHT_BEFORE = 3600;

type Body = { g: number; s: number; p: number; type: 'planet' | 'moon' };

export interface FleetSighting {
  source: 'spy' | 'spySum' | 'battle' | 'battles' | 'incoming' | 'empire';
  time: number;
  units: Record<string, number>;
  points: number;
  /** spy: the body spied on; battle: where it took place (null in the battle hall); incoming: where the fleet started */
  body: Body | null;
  /** spySum: bodies added up; battles: battles taken into account; empire: fleets in flight added (null: not known) */
  count: number | null;
  /** battle: the battle report (hub page `battle-hall/:id`) */
  reportId: string | null;
}

export interface FleetSum extends FleetSighting {
  /** fleet points of the statistics update nearest to the newest report of the sum */
  stat: { points: number; time: number } | null;
  /** `match`: fits the statistics; `over`: more than the statistics (ships counted twice); `under`: part of the fleet unseen */
  check: 'match' | 'over' | 'under' | null;
}

export interface PlayerFleet {
  fleet: FleetSighting | null;
  sum: FleetSum | null;
  /** all sightings, the newest first */
  sightings: FleetSighting[];
  /** newest fleet points of the statistics */
  fleetPoints: { points: number; time: number } | null;
}

const isShip = (id: number) => id >= 200 && id < 300;

export function playerFleet(db: DB, ctx: GroupContext, playerId: number, name: string, aliases: string[] = []): PlayerFleet {
  return withUnits(catalogOf(ctx.universe), () => {
    const points = (units: Record<string, number>) => Math.round(Object.entries(units).reduce((s, [id, n]) => s + elementPoints(id, n), 0));
    const sighting = (s: Omit<FleetSighting, 'points' | 'count' | 'reportId'> & Partial<Pick<FleetSighting, 'count' | 'reportId'>>): FleetSighting => ({
      count: null, reportId: null, ...s, points: points(s.units),
    });
    const sightings: FleetSighting[] = [];

    // spy reports: per body the newest one with a fleet section
    const reports = db
      .prepare(
        `SELECT g, s, p, planet_type, report_time, json_extract(sections, '$."${CLASS_FLEET}"') AS fleet FROM spy_reports
         -- by id (players belong to one group) or by the name in the report
         WHERE id IN (SELECT id FROM spy_reports WHERE player_id = ? UNION SELECT id FROM spy_reports WHERE group_id = ? AND player_name = ? COLLATE NOCASE)
           AND json_extract(sections, '$."${CLASS_FLEET}"') IS NOT NULL
         ORDER BY report_time DESC`,
      )
      .all(playerId, ctx.groupId, name) as { g: number; s: number; p: number; planet_type: 'planet' | 'moon'; report_time: number; fleet: string }[];
    const position = db.prepare('SELECT player_id, destroyed FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ?');
    const bodies = new Map<string, FleetSighting>();
    for (const r of reports) {
      const key = `${r.g}:${r.s}:${r.p}:${r.planet_type}`;
      if (bodies.has(key)) continue;
      // a position taken over by someone else (or destroyed) no longer holds this player's ships
      const at = position.get(ctx.groupId, r.g, r.s, r.p) as { player_id: number | null; destroyed: number } | undefined;
      if (at && (at.destroyed || (at.player_id != null && at.player_id !== playerId))) continue;
      const units = Object.fromEntries(Object.entries(JSON.parse(r.fleet) as Record<string, number>).filter(([id, n]) => isShip(Number(id)) && n > 0));
      bodies.set(key, sighting({ source: 'spy', time: r.report_time, units, body: { g: r.g, s: r.s, p: r.p, type: r.planet_type } }));
    }
    sightings.push(...bodies.values());

    // the sum of the bodies spied on close to the newest of them
    let sum: FleetSum | null = null;
    const spied = [...bodies.values()].sort((a, b) => b.time - a.time);
    if (spied.length >= 2) {
      const newest = spied[0].time;
      const parts = spied.filter((x) => x.time >= newest - SUM_HOURS * 3600);
      if (parts.length >= 2) {
        const units: Record<string, number> = {};
        for (const x of parts) for (const [id, n] of Object.entries(x.units)) units[id] = (units[id] ?? 0) + n;
        const stat =
          (db
            .prepare(
              `SELECT points, stat_time AS time FROM player_scores WHERE player_id = ? AND type = 2 AND stat_time IS NOT NULL
               ORDER BY ABS(stat_time - ?) LIMIT 1`,
            )
            .get(playerId, newest) as { points: number; time: number } | undefined) ?? null;
        const s = sighting({ source: 'spySum', time: newest, units, body: null, count: parts.length });
        const check = !stat ? null : s.points > stat.points * OVER + 5 ? 'over' : s.points < stat.points * UNDER ? 'under' : 'match';
        sum = { ...s, stat, check };
        sightings.push(s);
      }
    }

    // battle reports: the ships brought into each battle, by the current name or an earlier one
    const names = [...new Set([name, ...aliases].map((n) => n.toLowerCase()))];
    type BattleRow = { report_id: string; time: number; g: number | null; s: number | null; p: number | null; planet_type: 'planet' | 'moon' | null; fleets: string };
    const battleRows = new Map<string, BattleRow>();
    const byName = db.prepare(
      `SELECT report_id, time, g, s, p, planet_type, fleets FROM combat_reports WHERE group_id = ? AND time IS NOT NULL AND fleets LIKE ? ESCAPE '\\'`,
    );
    for (const n of new Set([name, ...aliases])) {
      // the name as it stands in the JSON, its LIKE wildcards (`_` is common in names) escaped
      for (const r of byName.all(ctx.groupId, likeTerm(JSON.stringify(n))) as BattleRow[]) battleRows.set(r.report_id, r);
    }
    const battles: FleetSighting[] = [];
    for (const r of battleRows.values()) {
      const units: Record<string, number> = {};
      for (const [, who, list] of JSON.parse(r.fleets) as [number, string, [number, number, number][]][]) {
        if (!who || !names.includes(who.toLowerCase())) continue;
        for (const [id, before] of list) if (isShip(id) && before > 0) units[id] = (units[id] ?? 0) + before;
      }
      if (!Object.keys(units).length) continue;
      const body = r.g != null && r.s != null && r.p != null ? { g: r.g, s: r.s, p: r.p, type: r.planet_type ?? 'planet' } : null;
      battles.push(sighting({ source: 'battle', time: r.time, units, body, reportId: r.report_id }));
    }
    battles.sort((a, b) => b.time - a.time);
    sightings.push(...battles.slice(0, BATTLES));
    if (battles.length >= 2) {
      const recent = battles.filter((b) => b.time >= battles[0].time - FLEET_DAYS * 86400);
      if (recent.length >= 2) {
        const units: Record<string, number> = {};
        for (const b of recent) for (const [id, n] of Object.entries(b.units)) units[id] = Math.max(units[id] ?? 0, n);
        sightings.push(sighting({ source: 'battles', time: battles[0].time, units, body: null, count: recent.length }));
      }
    }

    // fleets on their way to a member
    for (const a of hostileAttacks(db, ctx)) {
      if (!a.player || (a.player.id !== playerId && !names.includes(a.player.name.toLowerCase()))) continue;
      const units: Record<string, number> = {};
      for (const f of a.fleets) for (const [id, n] of Object.entries(f.ships)) if (n > 0) units[id] = (units[id] ?? 0) + n;
      if (Object.keys(units).length) sightings.push(sighting({ source: 'incoming', time: a.seen, units, body: { g: a.from.g, s: a.from.s, p: a.from.p, type: a.from.type } }));
    }

    // a member's player: their own empire page, with the fleets in flight then
    let empire: FleetSighting | null = null;
    const member = [...memberPlayers(db, ctx)].find(([, p]) => p === playerId)?.[0];
    const page = member != null ? latestEmpires(db, ctx).find((e) => e.userId === member) : undefined;
    if (member != null && page) {
      const units: Record<string, number> = {};
      for (const pl of page.rec.planets) for (const [id, n] of Object.entries(pl.values)) if (isShip(Number(id)) && n > 0) units[id] = (units[id] ?? 0) + n;
      let flights: number | null = null;
      const list = sharedFleets(db, ctx.groupId, member, ctx.user.id);
      if (list && list.time <= page.time + FLIGHT_SLACK && list.time >= page.time - FLIGHT_BEFORE) {
        flights = 0;
        // each flight once (outward, holding and return lines), away at the empire page: back only after it
        const own = list.data.filter((f) => f.owner === 'own').sort((a, b) => a.arrival - b.arrival);
        const counted = new Set<StoredFleet>();
        for (const f of own) {
          if (counted.has(f)) continue;
          const lines = flightLines(own, f);
          for (const l of lines) counted.add(l);
          if (lines[lines.length - 1].arrival <= page.time || !Object.keys(f.ships).length) continue;
          for (const [id, n] of Object.entries(f.ships)) if (n > 0) units[id] = (units[id] ?? 0) + n;
          flights++;
        }
      }
      empire = sighting({ source: 'empire', time: page.time, units, body: null, count: flights });
      sightings.push(empire);
    }

    sightings.sort((a, b) => b.time - a.time || b.points - a.points);
    const newest = sightings[0]?.time ?? 0;
    const fleet =
      sightings
        .filter((x) => (empire ? x.time >= empire.time : x.time >= newest - FLEET_DAYS * 86400) && (x.source !== 'spySum' || sum?.check !== 'over'))
        .reduce<FleetSighting | null>((best, x) => (!best || x.points > best.points ? x : best), null);
    const fleetPoints =
      (db
        .prepare('SELECT points, stat_time AS time FROM player_scores WHERE player_id = ? AND type = 2 AND stat_time IS NOT NULL ORDER BY stat_time DESC LIMIT 1')
        .get(playerId) as { points: number; time: number } | undefined) ?? null;
    return { fleet, sum, sightings, fleetPoints };
  });
}
