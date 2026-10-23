import type { EmpireRecord, GalaxyRecord, HubRecord, OverviewRecord, SpyReportRecord, StatsRecord } from '@pr0hub/core';
import type { DB } from './db.js';
import { Players } from './repo/players.js';

/** Below these sizes nothing is judged: a young group, a short page. */
const MIN_KNOWN = 50;
const MIN_ROWS = 20;
const MIN_ALLIANCES = 10;
const MIN_PLANETS = 5;
const MIN_REPORTS = 2;
/** share of a statistics page the group must know, share of compared planets with another owner */
const MIN_KNOWN_SHARE = 0.3;
const MAX_OTHER_OWNER = 0.7;

/**
 * Whether parsed pages contradict what the group already knows about its universe, i.e. come from another
 * universe: a statistics page names mostly players (or alliances) the group has never seen, galaxy views show
 * mostly other owners on planets the group knows, spy reports mostly other players than the known owners, an empire
 * page shows planets of several other players or none of the member's planets from their earlier pages, an overview
 * page a planet of another player. Works for plain text too, unlike the markers of the HTML.
 */
export function foreignRecords(db: DB, target: { groupId: number; userId: number }, records: HubRecord[]): boolean {
  const { groupId } = target;
  if (records.some((r) => r.kind === 'empire' && foreignEmpire(db, target, r))) return true;
  if (records.some((r) => r.kind === 'overview' && foreignOverview(db, target, r))) return true;
  const players = new Players(db, groupId);
  const stats = records.filter((r): r is StatsRecord => r.kind === 'stats');
  for (const r of stats) {
    if (r.rows.length < MIN_ROWS) continue;
    if (r.who === 'player') {
      if (count(db, 'players', groupId) < MIN_KNOWN) continue;
      const known = r.rows.filter((row) => players.byName(row.name) != null).length;
      if (known / r.rows.length < MIN_KNOWN_SHARE) return true;
    } else {
      if (count(db, 'alliances', groupId) < MIN_ALLIANCES) continue;
      const byName = db.prepare('SELECT 1 FROM alliances WHERE group_id = ? AND name = ?');
      const known = r.rows.filter((row) => byName.get(groupId, row.name)).length;
      if (known / r.rows.length < MIN_KNOWN_SHARE) return true;
    }
  }

  const owner = db.prepare(
    `SELECT p.id FROM planets pl JOIN players p ON p.id = pl.player_id
     WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ? AND pl.destroyed = 0`,
  ).pluck();
  let compared = 0;
  let other = 0;
  for (const r of records.filter((x): x is GalaxyRecord => x.kind === 'galaxy')) {
    for (const row of r.rows) {
      if (!row.playerName || row.destroyed) continue;
      const known = owner.get(groupId, r.g, r.s, row.position) as number | undefined;
      if (known == null) continue;
      compared++;
      if (players.byName(row.playerName) !== known) other++;
    }
  }
  if (compared >= MIN_PLANETS && other / compared > MAX_OTHER_OWNER) return true;

  // spy reports name the planet's owner
  compared = 0;
  other = 0;
  for (const r of records.filter((x): x is SpyReportRecord => x.kind === 'spy')) {
    if (!r.playerName) continue;
    const known = owner.get(groupId, r.coords.g, r.coords.s, r.coords.p) as number | undefined;
    if (known == null) continue;
    compared++;
    if (players.byName(r.playerName) !== known) other++;
  }
  return compared >= MIN_REPORTS && other / compared > MAX_OTHER_OWNER;
}

/**
 * An overview page of another universe: its planet is none of the member's stored empire planets and belongs to
 * another player than those in the galaxy data. A new colony (not on an empire page yet) without owner data passes.
 */
function foreignOverview(db: DB, target: { groupId: number; userId: number }, r: OverviewRecord): boolean {
  if (!r.current) return false;
  const planets = storedPlanets(db, target);
  const c = r.current.coords;
  if (!planets.length || planets.some((p) => p.g === c.g && p.s === c.s && p.p === c.p)) return false;
  const owner = db.prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND player_id IS NOT NULL').pluck();
  const at = owner.get(target.groupId, c.g, c.s, c.p) as number | undefined;
  if (at == null) return false;
  const own = new Set(planets.map((p) => owner.get(target.groupId, p.g, p.s, p.p) as number | undefined).filter((id) => id != null));
  return own.size > 0 && !own.has(at);
}

/** Planets on the member's stored empire pages. */
function storedPlanets(db: DB, target: { groupId: number; userId: number }) {
  const stored = db.prepare('SELECT data FROM empire_snapshots WHERE group_id = ? AND user_id = ?').pluck().all(target.groupId, target.userId) as string[];
  return stored.flatMap((d) => ((JSON.parse(d) as Partial<EmpireRecord>).planets ?? []).map((p) => p.coords));
}

/**
 * An empire page of another universe: its planets belong to several other players in the group's galaxy data
 * (in the right universe they all have one owner, the member), or it shares no planet with the member's stored
 * empire pages (the home planet can't be given up).
 */
function foreignEmpire(db: DB, target: { groupId: number; userId: number }, r: EmpireRecord): boolean {
  const planets = r.planets.filter((p) => p.type === 'planet');
  if (!planets.length) return false;
  const owner = db.prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND player_id IS NOT NULL').pluck();
  const owners = new Map<number, number>();
  for (const p of planets) {
    const id = owner.get(target.groupId, p.coords.g, p.coords.s, p.coords.p) as number | undefined;
    if (id != null) owners.set(id, (owners.get(id) ?? 0) + 1);
  }
  const known = [...owners.values()].reduce((a, b) => a + b, 0);
  if (known >= 2 && Math.max(...owners.values()) <= known / 2) return true;

  const key = (c: { g: number; s: number; p: number }) => `${c.g}:${c.s}:${c.p}`;
  const before = new Set(storedPlanets(db, target).map(key));
  return before.size > 0 && !planets.some((p) => before.has(key(p.coords)));
}

const count = (db: DB, table: 'players' | 'alliances', groupId: number) =>
  db.prepare(`SELECT COUNT(*) FROM ${table} WHERE group_id = ?`).pluck().get(groupId) as number;
