import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { DISPLAY, MEMBER } from '../routes/util.js';
import type { StoredFleet } from './fleets.js';
import { shipsKey } from './hostile.js';
import { SHARED } from './messages.js';

/**
 * Evidence of when a player was online, for their activity pattern: stored reports (espionage on members, battles,
 * messages, point gains) read when served, and `player_activity` for what would be lost otherwise (galaxy activity
 * marks, fleet launches and recalls) or is entered by hand.
 */
export type ActivitySource = 'spy' | 'attack' | 'defense' | 'message' | 'points' | 'galaxy' | 'fleet' | 'recall' | 'manual';

export interface ActivityEvent {
  time: number;
  /** half width of the uncertainty in seconds (0: exact) */
  spread: number;
  source: ActivitySource;
  /** manual reports: row id, reporting member and whether the viewer reported it */
  id?: number;
  reporter?: string | null;
  mine?: boolean;
}

/** The activity pattern covers this many days. */
export const ACTIVITY_DAYS = 7;
/** `player_activity` rows are kept this long. */
export const ACTIVITY_KEEP = 30 * 86400;
/** A launch or recall known only within a longer window says nothing about the time of day. */
const FLEET_WINDOW = 6 * 3600;
/** Point gains between stat times further apart are left out. */
const POINTS_WINDOW = 24 * 3600;
const ESPIONAGE = 6;
/** Missions with a holding time: the return does not tell the flight time. */
const HOLD_MISSIONS = [5, 15];

interface NewActivity {
  playerId: number;
  time: number;
  spread: number;
  source: 'galaxy' | 'fleet' | 'recall' | 'manual';
  coords?: { g: number; s: number; p: number; type?: string | null } | null;
  userId?: number | null;
  key: string;
}

/** Stores one piece of evidence; false when it is known already. */
export function addActivity(db: DB, groupId: number, a: NewActivity): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO player_activity (group_id, player_id, time, spread, source, g, s, p, planet_type, user_id, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        groupId, a.playerId, Math.round(a.time), Math.round(a.spread), a.source, a.coords?.g ?? null, a.coords?.s ?? null, a.coords?.p ?? null,
        a.coords?.type ?? null, a.userId ?? null, a.key,
      ).changes > 0
  );
}

/** "(*)" covers the last 15 minutes. */
const STAR_SPREAD = 450;

/**
 * Activity mark of a planet in the galaxy view (`minutes` since active, 0 for "(*)"). The game also sets it for foreign
 * actions on the planet: a mark matching a member's spy report or battle there is left out. The same activity seen
 * again (later, on another planet) counts once, the most exact sighting wins.
 */
export function galaxyMark(db: DB, groupId: number, playerId: number, c: { g: number; s: number; p: number }, minutes: number, seenAt: number): boolean {
  const spread = minutes === 0 ? STAR_SPREAD : 60;
  const time = minutes === 0 ? seenAt - STAR_SPREAD : seenAt - minutes * 60;
  const lo = time - spread - 60;
  const hi = time + spread + 60;
  const ours = db
    .prepare(
      `SELECT 1 FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND report_time BETWEEN ? AND ?
       UNION ALL SELECT 1 FROM battle_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND time BETWEEN ? AND ? LIMIT 1`,
    )
    .get(groupId, c.g, c.s, c.p, lo, hi, groupId, c.g, c.s, c.p, lo, hi);
  if (ours) return false;
  const near = (
    db
      .prepare(`SELECT id, time, spread FROM player_activity WHERE player_id = ? AND source = 'galaxy' AND time BETWEEN ? AND ?`)
      .all(playerId, time - spread - STAR_SPREAD - 180, time + spread + STAR_SPREAD + 180) as { id: number; time: number; spread: number }[]
  ).filter((x) => Math.abs(x.time - time) <= x.spread + spread + 180);
  if (near.some((x) => x.spread <= spread)) return false;
  for (const x of near) db.prepare('DELETE FROM player_activity WHERE id = ?').run(x.id);
  return addActivity(db, groupId, { playerId, time, spread, source: 'galaxy', coords: c, key: `galaxy:${playerId}:${time}` });
}

const bodyKey = (b: StoredFleet['from'] | null) => (b ? `${b.coords.g}:${b.coords.s}:${b.coords.p}:${b.type}` : '-');
const fleetKey = (f: StoredFleet) => `${f.mission}|${bodyKey(f.from)}>${bodyKey(f.to)}|${shipsKey(f.ships)}`;
/** Hostile fleets on the way, not spying (the espionage report tells that more exactly). */
const hostileOut = (f: StoredFleet) =>
  f.owner === 'hostile' && f.phase === 'out' && f.mission !== ESPIONAGE && f.to != null && (f.from.type === 'planet' || f.from.type === 'moon');

/** Owner of a planet by the galaxy data. */
function ownerOf(db: DB, groupId: number, b: StoredFleet['from']): number | null {
  return (db.prepare('SELECT player_id FROM planets WHERE group_id = ? AND g = ? AND s = ? AND p = ?').pluck().get(groupId, b.coords.g, b.coords.s, b.coords.p) as
    | number
    | null
    | undefined) ?? null;
}

/**
 * A member's fleet list against their previous one: a hostile fleet that is new was launched in between, one that is
 * gone before its arrival was recalled in between. Only when the lists are close enough to tell the time of day.
 */
export function fleetActivity(db: DB, groupId: number, userId: number, prev: { time: number; data: StoredFleet[] } | null, cur: { time: number; data: StoredFleet[] }) {
  if (!prev || cur.time <= prev.time || cur.time - prev.time > FLEET_WINDOW) return;
  const time = (prev.time + cur.time) / 2;
  const spread = (cur.time - prev.time) / 2;
  const before = new Set(prev.data.filter(hostileOut).map(fleetKey));
  const now = new Set(cur.data.filter(hostileOut).map(fleetKey));
  const add = (f: StoredFleet, source: 'fleet' | 'recall') => {
    const playerId = ownerOf(db, groupId, f.from);
    if (!playerId) return;
    const key = `${source}:${userId}:${fleetKey(f)}:${Math.round(f.arrival / 60)}`;
    addActivity(db, groupId, { playerId, time, spread, source, coords: { ...f.from.coords, type: f.from.type }, key });
  };
  for (const f of cur.data.filter(hostileOut)) if (!before.has(fleetKey(f))) add(f, 'fleet');
  // gone although still on the way: recalled (an arrival within the tolerance of the list is a landing)
  for (const f of prev.data.filter(hostileOut)) if (!now.has(fleetKey(f)) && f.arrival > cur.time + 5) add(f, 'recall');
}

/**
 * Phalanx result: the scanned player's own fleet with its return shown was launched exactly one flight time before
 * its arrival (the return takes as long as the outward flight).
 */
export function phalanxActivity(db: DB, groupId: number, data: StoredFleet[]) {
  for (const out of data) {
    if (out.owner !== 'own' || out.phase !== 'out' || !out.to || out.mission == null || HOLD_MISSIONS.includes(out.mission)) continue;
    if (out.from.type !== 'planet' && out.from.type !== 'moon') continue;
    const back = data.find(
      (f) => f.phase === 'return' && bodyKey(f.from) === bodyKey(out.to) && bodyKey(f.to) === bodyKey(out.from) && shipsKey(f.ships) === shipsKey(out.ships),
    );
    if (!back || back.arrival <= out.arrival) continue;
    const playerId = ownerOf(db, groupId, out.from);
    if (!playerId) continue;
    const time = out.arrival - (back.arrival - out.arrival);
    addActivity(db, groupId, {
      playerId, time, spread: 60, source: 'fleet', coords: { ...out.from.coords, type: out.from.type }, key: `phalanx:${fleetKey(out)}:${Math.round(time / 60)}`,
    });
  }
}

/** Evidence of the player since `from`, by time. */
export function playerActivity(db: DB, ctx: GroupContext, playerId: number, from: number): ActivityEvent[] {
  const names = JSON.stringify(
    db.prepare('SELECT name FROM players WHERE id = ? UNION SELECT name FROM player_aliases WHERE player_id = ?').pluck().all(playerId, playerId),
  );
  const lower = new Set((JSON.parse(names) as string[]).map((n) => n.toLowerCase()));
  const out: ActivityEvent[] = [];
  const exact = (time: number, source: ActivitySource) => out.push({ time, spread: 0, source });

  // espionage on members
  for (const time of db
    .prepare('SELECT time FROM hostile_spying WHERE group_id = ? AND time >= ? AND from_player COLLATE NOCASE IN (SELECT value FROM json_each(?))')
    .pluck()
    .all(ctx.groupId, from, names) as number[]) {
    exact(time, 'spy');
  }

  // battles: attackers were online; defenders when help came (more than one defending fleet)
  const battle = (time: number, attackers: string[], defenders: string[]) => {
    if (attackers.some((n) => lower.has(n.toLowerCase()))) exact(time, 'attack');
    else if (defenders.length > 1 && defenders.some((n) => lower.has(n.toLowerCase()))) exact(time, 'defense');
  };
  const reports = db
    .prepare(
      `SELECT time, fleets FROM combat_reports cr WHERE group_id = ? AND time >= ?
         AND EXISTS (SELECT 1 FROM json_each(cr.fleets) f WHERE json_extract(f.value, '$[1]') COLLATE NOCASE IN (SELECT value FROM json_each(?)))`,
    )
    .all(ctx.groupId, from, names) as { time: number; fleets: string }[];
  for (const r of reports) {
    const fleets = JSON.parse(r.fleets) as [number, string][];
    battle(r.time, fleets.filter((f) => f[0] === 0).map((f) => f[1]), fleets.filter((f) => f[0] === 1).map((f) => f[1]));
  }
  // battle hall entries whose report is not archived
  const hall = db
    .prepare(
      `SELECT time, attackers, defenders FROM battle_hall bh WHERE group_id = ? AND time >= ?
         AND NOT EXISTS (SELECT 1 FROM combat_reports cr WHERE cr.group_id = bh.group_id AND cr.report_id = bh.report_id)
         AND (EXISTS (SELECT 1 FROM json_each(bh.attackers) a WHERE a.value COLLATE NOCASE IN (SELECT value FROM json_each(?)))
           OR EXISTS (SELECT 1 FROM json_each(bh.defenders) d WHERE d.value COLLATE NOCASE IN (SELECT value FROM json_each(?))))`,
    )
    .all(ctx.groupId, from, names, names) as { time: number; attackers: string; defenders: string }[];
  for (const h of hall) battle(h.time, JSON.parse(h.attackers), JSON.parse(h.defenders));

  // messages the player sent, as far as the viewer may see them
  for (const time of db
    .prepare(
      `SELECT MIN(pm.time) FROM player_messages pm JOIN users u ON u.id = pm.user_id
       JOIN group_members gm ON gm.group_id = pm.group_id AND gm.user_id = pm.user_id
       WHERE pm.group_id = ? AND pm.time >= ? AND (pm.user_id = ? OR ${SHARED})
         AND pm.from_name COLLATE NOCASE IN (SELECT value FROM json_each(?))
       GROUP BY pm.dedupe_key`,
    )
    .pluck()
    .all(ctx.groupId, from, ctx.user.id, names) as number[]) {
    exact(time, 'message');
  }

  // total points grown between two stat times: some time in between
  const scores = db
    .prepare('SELECT stat_time, MAX(points) AS points FROM player_scores WHERE player_id = ? AND type = 1 AND stat_time >= ? GROUP BY stat_time ORDER BY stat_time')
    .all(playerId, from - POINTS_WINDOW) as { stat_time: number; points: number }[];
  for (let i = 1; i < scores.length; i++) {
    const [a, b] = [scores[i - 1], scores[i]];
    if (b.points <= a.points || b.stat_time - a.stat_time > POINTS_WINDOW || b.stat_time < from) continue;
    out.push({ time: Math.round((a.stat_time + b.stat_time) / 2), spread: Math.round((b.stat_time - a.stat_time) / 2), source: 'points' });
  }

  const stored = db
    .prepare(
      `SELECT pa.id, pa.time, pa.spread, pa.source, pa.user_id, ${DISPLAY} AS reporter FROM player_activity pa
       LEFT JOIN users u ON u.id = pa.user_id ${MEMBER('pa')}
       WHERE pa.group_id = ? AND pa.player_id = ? AND pa.time >= ?`,
    )
    .all(ctx.groupId, playerId, from) as { id: number; time: number; spread: number; source: ActivitySource; user_id: number | null; reporter: string | null }[];
  for (const r of stored) {
    out.push(
      r.source === 'manual'
        ? { time: r.time, spread: r.spread, source: r.source, id: r.id, reporter: r.reporter, mine: r.user_id === ctx.user.id }
        : { time: r.time, spread: r.spread, source: r.source },
    );
  }
  return out.sort((a, b) => a.time - b.time);
}
