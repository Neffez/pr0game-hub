import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { DISPLAY, MEMBER } from '../routes/util.js';
import type { StoredFleet } from './fleets.js';
import { shipsKey } from './hostile.js';
import { memberPlayers } from './members.js';
import { SHARED } from './messages.js';

/**
 * Evidence of when a player was online, for their activity pattern: stored reports (espionage on members, battles,
 * messages; for members' players their syncs and hub presence) read when served, and `player_activity` for what would
 * be lost otherwise (galaxy activity marks, fleet launches and recalls) or is entered by hand. Point gains are no
 * events: a stat window spans 6 hours, so they only tell how active the player was per window (`activityScores`).
 */
export type ActivitySource = 'spy' | 'attack' | 'defense' | 'message' | 'galaxy' | 'fleet' | 'recall' | 'manual' | 'offline' | 'sync' | 'hub';

export interface ActivityEvent {
  time: number;
  /** half width of the uncertainty in seconds (0: exact) */
  spread: number;
  source: ActivitySource;
  /** contribution to the activity curve (galaxy marks: scaled by planets per hour) */
  weight?: number;
  /** manual and offline reports: row id, reporting member and whether the viewer reported it */
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
/** Syncs within this many seconds count once. */
const SYNC_BUCKET = 900;
/** Hub presence counts per half hour (one 5-minute slot is enough). */
const HUB_BUCKET = 1800;
/** Length of a `member_online` slot. */
const SLOT = 300;
const ESPIONAGE = 6;
/** Missions with a holding time: the return does not tell the flight time. */
const HOLD_MISSIONS = [5, 15];

interface NewActivity {
  playerId: number;
  time: number;
  spread: number;
  source: 'galaxy' | 'fleet' | 'recall' | 'manual' | 'offline';
  coords?: { g: number; s: number; p: number; type?: string | null } | null;
  userId?: number | null;
  key: string;
  /** When the evidence was synced (galaxy marks); stored as `created_at`. */
  syncedAt?: number;
}

/** Galaxy marks in the activity curve cap at this; one planet counts less, more planets approach the cap. */
export const GALAXY_WEIGHT_CAP = 0.4;
const GALAXY_HOUR = 3600;

/** Notes that a member has the hub open and active now (one row per 5-minute slot). */
export function memberOnline(db: DB, groupId: number, userId: number, time: number) {
  db.prepare('INSERT OR IGNORE INTO member_online (group_id, user_id, slot) VALUES (?, ?, ?)').run(groupId, userId, Math.floor(time / SLOT) * SLOT);
}

/** Stores one piece of evidence; false when it is known already. */
export function addActivity(db: DB, groupId: number, a: NewActivity): boolean {
  const row = [
    groupId, a.playerId, Math.round(a.time), Math.round(a.spread), a.source, a.coords?.g ?? null, a.coords?.s ?? null, a.coords?.p ?? null,
    a.coords?.type ?? null, a.userId ?? null, a.key,
  ];
  if (a.syncedAt != null) {
    return (
      db
        .prepare(
          `INSERT OR IGNORE INTO player_activity (group_id, player_id, time, spread, source, g, s, p, planet_type, user_id, dedupe_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...row, Math.round(a.syncedAt)).changes > 0
    );
  }
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO player_activity (group_id, player_id, time, spread, source, g, s, p, planet_type, user_id, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...row).changes > 0
  );
}

/** "(*)" covers the last 15 minutes. */
const STAR_SPREAD = 450;

/**
 * Activity mark of a planet in the galaxy view (`minutes` since active, 0 for "(*)"). The game also sets it for foreign
 * actions on the planet: a mark matching a member's spy report or battle there is left out. The same planet seen again
 * within an hour counts once, the most exact sighting wins; marks on other planets are kept separately.
 */
export function galaxyMark(db: DB, groupId: number, playerId: number, c: { g: number; s: number; p: number }, minutes: number, seenAt: number): boolean {
  const spread = minutes === 0 ? STAR_SPREAD : 60;
  const time = minutes === 0 ? seenAt - STAR_SPREAD : seenAt - minutes * 60;
  const markLo = time - spread - 60;
  const markHi = time + spread + 60;
  const lo = Math.min(markLo, seenAt - GALAXY_HOUR);
  const hi = Math.max(markHi, seenAt + 60);
  const ours = db
    .prepare(
      `SELECT 1 FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND report_time BETWEEN ? AND ?
       UNION ALL SELECT 1 FROM battle_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND time BETWEEN ? AND ? LIMIT 1`,
    )
    .get(groupId, c.g, c.s, c.p, lo, hi, groupId, c.g, c.s, c.p, lo, hi);
  if (ours) return false;
  const near = db
    .prepare(
      `SELECT id, time, spread FROM player_activity WHERE player_id = ? AND source = 'galaxy' AND g = ? AND s = ? AND p = ?
       AND created_at BETWEEN ? AND ?`,
    )
    .all(playerId, c.g, c.s, c.p, seenAt - GALAXY_HOUR, seenAt + 60) as { id: number; time: number; spread: number }[];
  if (near.some((x) => x.spread <= spread)) return false;
  for (const x of near) db.prepare('DELETE FROM player_activity WHERE id = ?').run(x.id);
  const hour = Math.floor(seenAt / GALAXY_HOUR);
  return addActivity(db, groupId, { playerId, time, spread, source: 'galaxy', coords: c, key: `galaxy:${playerId}:${c.g}:${c.s}:${c.p}:${hour}`, syncedAt: seenAt });
}

function spyOrBattleOnPlanet(db: DB, groupId: number, g: number, s: number, p: number, lo: number, hi: number): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND report_time BETWEEN ? AND ?
       UNION ALL SELECT 1 FROM battle_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND time BETWEEN ? AND ? LIMIT 1`,
    )
    .get(groupId, g, s, p, lo, hi, groupId, g, s, p, lo, hi);
}

/** Estimated activity time from the mark (for the chart). */
const galaxySeenAt = (time: number, spread: number) => time + spread;

/**
 * When the galaxy view was pasted into the hub (`created_at`, set from `seenAt` on insert). Rows backfilled later may
 * have a `created_at` after the estimated mark time; then the estimate is used as a fallback.
 */
const galaxySyncedAt = (row: { time: number; spread: number; created_at: number }) => {
  const seen = galaxySeenAt(row.time, row.spread);
  return row.created_at > seen + 300 ? seen : row.created_at;
};

function galaxySpyWindow(row: { time: number; spread: number; created_at: number }) {
  const sync = galaxySyncedAt(row);
  const seen = galaxySeenAt(row.time, row.spread);
  return {
    lo: Math.min(row.time - row.spread - 60, sync - GALAXY_HOUR, seen - GALAXY_HOUR),
    hi: Math.max(row.time + row.spread + 60, sync + 60, seen + 60),
  };
}

function spyOnPlayer(db: DB, groupId: number, playerId: number, names: string, lo: number, hi: number): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM spy_reports WHERE group_id = ? AND report_time BETWEEN ? AND ?
       AND (player_id = ? OR player_name COLLATE NOCASE IN (SELECT value FROM json_each(?))) LIMIT 1`,
    )
    .get(groupId, lo, hi, playerId, names);
}

function galaxyMarkBlocked(
  db: DB, groupId: number, playerId: number, names: string, g: number, s: number, p: number, row: { time: number; spread: number; created_at: number },
): boolean {
  const { lo, hi } = galaxySpyWindow(row);
  return spyOrBattleOnPlanet(db, groupId, g, s, p, lo, hi) || spyOnPlayer(db, groupId, playerId, names, lo, hi);
}

/** Total galaxy weight for `n` planets with a mark in the same hour. */
export const galaxyHourWeight = (n: number) => (n <= 0 ? 0 : GALAXY_WEIGHT_CAP * (1 - 0.5 ** n));

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

/** Stat windows reaching back this far before `from` still cover the first hours of the period. */
const SCORE_LEAD = 12 * 3600;

/**
 * Total points per stat time since a little before `from`, oldest first: how much the player gained per window
 * compared with the other windows tells how active they were then (shown as a coarse layer of the pattern).
 */
export function activityScores(db: DB, playerId: number, from: number): { time: number; points: number }[] {
  return db
    .prepare('SELECT stat_time AS time, MAX(points) AS points FROM player_scores WHERE player_id = ? AND type = 1 AND stat_time >= ? GROUP BY stat_time ORDER BY stat_time')
    .all(playerId, from - SCORE_LEAD) as { time: number; points: number }[];
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

  // a member's player: pages they synced (copied from the game, so online there) and an active hub tab, as far as the
  // member shares them with the others
  const members = [...memberPlayers(db, ctx)].filter(([, p]) => p === playerId).map(([user]) => user);
  for (const user of members) {
    const self = user === ctx.user.id || ctx.user.isAdmin;
    const settings = db.prepare('SELECT show_online, share_syncs FROM users WHERE id = ?').get(user) as { show_online: number; share_syncs: number };
    if (self || settings.share_syncs) {
      // several pages in a row count once per bucket
      for (const time of db
        .prepare(
          `SELECT MIN(created_at) FROM raw_ingests WHERE group_id = ? AND COALESCE(synced_by, user_id) = ? AND created_at >= ?
           GROUP BY created_at / ${SYNC_BUCKET}`,
        )
        .pluck()
        .all(ctx.groupId, user, from) as number[]) {
        exact(time, 'sync');
      }
    }
    if (self || settings.show_online) {
      for (const bucket of db
        .prepare(`SELECT DISTINCT slot / ${HUB_BUCKET} FROM member_online WHERE group_id = ? AND user_id = ? AND slot >= ?`)
        .pluck()
        .all(ctx.groupId, user, from) as number[]) {
        out.push({ time: bucket * HUB_BUCKET + HUB_BUCKET / 2, spread: HUB_BUCKET / 2, source: 'hub' });
      }
    }
  }

  type StoredRow = {
    id: number; time: number; spread: number; created_at: number; source: ActivitySource; g: number | null; s: number | null; p: number | null;
    planet_type: string | null; user_id: number | null; reporter: string | null;
  };
  const stored = db
    .prepare(
      `SELECT pa.id, pa.time, pa.spread, pa.created_at, pa.source, pa.g, pa.s, pa.p, pa.planet_type, pa.user_id, ${DISPLAY} AS reporter FROM player_activity pa
       LEFT JOIN users u ON u.id = pa.user_id ${MEMBER('pa')}
       WHERE pa.group_id = ? AND pa.player_id = ? AND (pa.time >= ? OR (pa.source = 'galaxy' AND pa.created_at >= ?))`,
    )
    .all(ctx.groupId, playerId, from, from) as StoredRow[];

  /** Hours (Unix) when the alliance spied this player; galaxy marks in the same sync hour are dropped. */
  const spiedHours = new Set<number>();
  for (const t of db
    .prepare(
      `SELECT report_time FROM spy_reports WHERE group_id = ? AND report_time >= ? AND (player_id = ? OR player_name COLLATE NOCASE IN (SELECT value FROM json_each(?)))`,
    )
    .pluck()
    .all(ctx.groupId, from - GALAXY_HOUR, playerId, names) as number[]) {
    spiedHours.add(Math.floor(t / GALAXY_HOUR));
  }

  const memberReport = (r: StoredRow): ActivityEvent => ({
    time: r.time,
    spread: r.spread,
    source: r.source as 'manual' | 'offline',
    id: r.id,
    reporter: r.reporter,
    mine: r.user_id === ctx.user.id,
    ...(r.source === 'offline' ? { weight: 0 } : {}),
  });

  const offlineTimes = stored.filter((r) => r.source === 'offline').map((r) => r.time);
  const planetSlot = (r: StoredRow) => `${r.g}:${r.s}:${r.p}:${r.planet_type ?? 'planet'}`;

  let galaxy = stored.filter((r) => r.source === 'galaxy' && r.g != null && r.s != null && r.p != null);
  galaxy = galaxy.filter((g) => {
    const sync = galaxySyncedAt(g);
    const syncHour = Math.floor(sync / GALAXY_HOUR);
    if (spiedHours.has(syncHour)) return false;
    if (offlineTimes.some((o) => Math.abs(sync - o) <= GALAXY_HOUR || Math.abs(galaxySeenAt(g.time, g.spread) - o) <= GALAXY_HOUR)) return false;
    return !galaxyMarkBlocked(db, ctx.groupId, playerId, names, g.g!, g.s!, g.p!, g);
  });

  const bestPerPlanetHour = new Map<string, StoredRow>();
  for (const g of galaxy) {
    const syncHour = Math.floor(galaxySyncedAt(g) / GALAXY_HOUR);
    const key = `${planetSlot(g)}:${syncHour}`;
    const cur = bestPerPlanetHour.get(key);
    if (!cur || g.spread < cur.spread || (g.spread === cur.spread && g.created_at > cur.created_at)) bestPerPlanetHour.set(key, g);
  }
  galaxy = [...bestPerPlanetHour.values()];

  const byHour = new Map<number, StoredRow[]>();
  for (const g of galaxy) {
    const h = Math.floor(galaxySeenAt(g.time, g.spread) / GALAXY_HOUR);
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(g);
  }
  for (const group of byHour.values()) {
    const share = galaxyHourWeight(group.length) / group.length;
    for (const g of group) out.push({ time: g.time, spread: g.spread, source: 'galaxy', weight: share });
  }

  for (const r of stored) {
    if (r.source === 'manual' || r.source === 'offline') out.push(memberReport(r));
    else if (r.source !== 'galaxy') out.push({ time: r.time, spread: r.spread, source: r.source });
  }
  return out.sort((a, b) => a.time - b.time);
}
