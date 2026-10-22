import { UNIVERSE_JSON_STATUS } from '@pr0hub/core';
import type { DB } from './db.js';
import { placeholderAlliance, placeholderPlayer } from './repo/players.js';

/**
 * Builds a universe.json exactly like pr0game's own galaxy export (scripts/game/galaxy.js `export_json`):
 * `[universe, playerids, allyids]` with universe = { "G:S": { "1".."N": null | slot, timepoint: ms } }.
 * Only systems with a galaxy view are exported: for those the hub knows every position.
 */

interface Slot {
  planetname: string;
  hasmoon: boolean;
  playerid: number;
  name: string;
  allianceid: number;
  alliancename: string;
  special: string;
}
type Named = Record<string, { name: string; timepoint: number }>;

function special(statusJson: string): string {
  const status = new Set(JSON.parse(statusJson || '[]') as string[]);
  // pr0game flags a long inactive player as inactive too ("Ii"); the hub stores only "longinactive".
  if (status.has('longinactive')) status.add('inactive');
  return UNIVERSE_JSON_STATUS.filter(([s]) => status.has(s)).map(([, c]) => c).join('');
}

export function buildUniverseJson(db: DB, groupId: number, positions: number): string {
  const views = db.prepare('SELECT g, s, seen_at FROM galaxy_views WHERE group_id = ? ORDER BY g, s').all(groupId) as {
    g: number;
    s: number;
    seen_at: number;
  }[];
  const planets = db
    .prepare(
      `SELECT pl.g, pl.s, pl.p, pl.name, pl.has_moon, p.ingame_id AS player_id, p.name AS player_name, p.status,
         a.ingame_id AS ally_id, a.name AS ally_name
       FROM planets pl JOIN players p ON p.id = pl.player_id LEFT JOIN alliances a ON a.id = p.alliance_id
       WHERE pl.group_id = ? AND pl.destroyed = 0 AND p.ingame_id IS NOT NULL`,
    )
    .all(groupId) as {
    g: number; s: number; p: number; name: string | null; has_moon: number;
    player_id: number; player_name: string; status: string; ally_id: number | null; ally_name: string | null;
  }[];
  const byCoords = new Map(planets.map((r) => [`${r.g}:${r.s}:${r.p}`, r]));

  const universe: Record<string, Record<string, Slot | null | number>> = {};
  const players: Named = {};
  const allies: Named = {};
  const remember = (map: Named, id: number, name: string, timepoint: number) => {
    if (!map[id] || map[id].timepoint < timepoint) map[id] = { name, timepoint };
  };

  for (const v of views) {
    const timepoint = v.seen_at * 1000;
    const system: Record<string, Slot | null | number> = {};
    for (let pos = 1; pos <= positions; pos++) {
      const r = byCoords.get(`${v.g}:${v.s}:${pos}`);
      if (!r) {
        system[pos] = null;
        continue;
      }
      // placeholder of a player only known by id (see Ingester.playerById) -> "-" like unknown names in the export
      const name = r.player_name === placeholderPlayer(r.player_id) ? '-' : r.player_name;
      const allianceid = r.ally_id ?? -1;
      const alliancename = r.ally_id != null && r.ally_name !== placeholderAlliance(r.ally_id) ? (r.ally_name ?? '-') : '-';
      system[pos] = {
        planetname: r.name ?? '-',
        hasmoon: !!r.has_moon,
        playerid: r.player_id,
        name,
        allianceid,
        alliancename,
        special: special(r.status),
      };
      remember(players, r.player_id, name, timepoint);
      remember(allies, allianceid, alliancename, timepoint);
    }
    system.timepoint = timepoint;
    universe[`${v.g}:${v.s}`] = system;
  }
  return JSON.stringify([universe, players, allies]);
}
