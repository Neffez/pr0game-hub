import { positionTemp, projectResources, SOLAR_SATELLITE } from '@pr0hub/core/production';
import { CLASS_BUILDINGS, CLASS_FLEET, CLASS_RESEARCH, CLASS_RESOURCES } from '@pr0hub/core/tech';
import { inactiveDaysOf } from '../config.js';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { economyOf, type Economy } from './economy.js';
import { SHARED } from './messages.js';

/**
 * How sure the hub is that a player is inactive, before the game flags them (its flag comes after 7 days without
 * login). The model: the latest sign of activity (`t0`), then how long and how often the hub has seen nothing since.
 *
 * Signs of activity, latest one wins:
 * - proven: the player attacked (combat reports, battle hall), spied on a member, sent a message a member synced,
 *   launched or recalled a fleet seen in members' overviews or by phalanx, or a member reported them online;
 *   in the spy history a fleet that shrank between two reports without a battle there (sent away);
 * - a relevant points gain: total points grew in a statistics update by more than a small share of what the active
 *   players around the same rank gained (smaller gains are builds finishing from a queue, not activity).
 * Signs of absence since `t0`: the time without either (scored on a curve), spy reports whose resources match the
 * projection of the report before (nobody spent or looted), fleet or defense points lost and not rebuilt. Galaxy
 * activity marks after `t0` lower the score but don't reset it: the game also sets them when others spy on or
 * attack the planet, and other alliances farm the same targets.
 */
export interface Inactivity {
  /** 0 (active) … 100 (inactive for sure) */
  score: number;
  level: 'inactive' | 'likely' | 'possible' | 'active' | 'unknown';
  /** probably inactive since (the game's flag, else the latest sign of activity) */
  since: number | null;
  /** `since` is the oldest update the hub looked at: the player may have stopped earlier */
  atLeast: boolean;
  status: 'inactive' | 'longinactive' | null;
  /** statistics update of the last relevant points gain */
  stall: number | null;
  /** newest proven activity */
  lastActive: number | null;
  /** what the score is made of, for the tooltip */
  reasons: InactivityReason[];
}

export type ProofSource = 'attack' | 'spy' | 'message' | 'fleet' | 'recall' | 'manual' | 'fleetGone';

export type InactivityReason =
  | { code: 'flag'; status: 'inactive' | 'longinactive'; time: number | null }
  | { code: 'proven'; source: ProofSource; time: number }
  | { code: 'gain'; time: number }
  | { code: 'noGain'; since: number; atLeast: boolean }
  | { code: 'weakGains'; n: number }
  | { code: 'galaxy'; n: number; time: number }
  | { code: 'idleSpy'; n: number }
  | { code: 'losses' };

/** Tunable weights (the admin panel's check measures how well they fit). */
export const INACTIVITY = {
  /** highest score without the game's flag */
  max: 94,
  /** score curve: max · (1 − e^(−idle / tau)); 24 h ≈ 46, 48 h ≈ 69, 72 h ≈ 82 */
  tau: 36 * 3600,
  /** a gain below this share of the median gain of active players ±`rankWindow` ranks counts as a queue finishing */
  weakGain: 0.15,
  rankWindow: 25,
  /** each galaxy activity mark after t0 multiplies the score by this, down to `galaxyFloor` */
  galaxyFactor: 0.7,
  galaxyFloor: 0.35,
  /** per spy interval without spending or loot after t0, at most `idleSpyMax` */
  idleSpyBonus: 4,
  idleSpyMax: 12,
  /** fleet or defense points lost since t0 and not rebuilt */
  lossBonus: 5,
  /** resources match the projection within this share of the production between two reports, plus `spyAbsolute` */
  spyTolerance: 0.05,
  spyAbsolute: 2000,
} as const;

const HOUR = 3600;
const DAY = 24 * HOUR;
const STAT_SLOT = 6 * HOUR;

export const inactivityLevel = (score: number): Inactivity['level'] =>
  score >= 85 ? 'inactive' : score >= 50 ? 'likely' : score >= 20 ? 'possible' : 'active';

/** Everything the score is computed from, for one player at one time. */
export interface InactivitySignals {
  status: string[];
  inactiveSince: number | null;
  /** newest synced total points update (≤ the time looked at); null without statistics */
  newest: number | null;
  /** the player is in the newest statistics */
  inStats: boolean;
  /** first update of the window looked at */
  firstUpdate: number | null;
  /** statistics update of the last relevant gain, null when none in the window */
  lastGain: number | null;
  /** gains after `lastGain` too small to count */
  weakGains: number;
  proven: { time: number; source: ProofSource } | null;
  /** galaxy activity marks of the player's planets, times */
  galaxy: number[];
  /** spy intervals without spending or loot: their end times */
  idleSpy: number[];
  /** fleet or defense points lower now than at the time given (losses since then not rebuilt) */
  lossesSince: number | null;
}

/** Score from the signals at `asOf` (pure). */
export function inactivityOf(s: InactivitySignals, asOf: number): Inactivity {
  const W = INACTIVITY;
  const reasons: InactivityReason[] = [];
  const flag = s.status.includes('longinactive') ? 'longinactive' : s.status.includes('inactive') ? 'inactive' : null;
  const base = { stall: s.lastGain, lastActive: s.proven?.time ?? null };
  if (s.proven) reasons.push({ code: 'proven', source: s.proven.source, time: s.proven.time });
  if (flag) {
    reasons.unshift({ code: 'flag', status: flag, time: s.inactiveSince });
    return { ...base, score: flag === 'longinactive' ? 100 : 95, level: 'inactive', status: flag, since: s.inactiveSince ?? s.lastGain, atLeast: s.inactiveSince == null && s.lastGain == null, reasons };
  }
  if (s.newest == null || !s.inStats) {
    // without current statistics only fresh proof says something
    return { ...base, score: 0, level: s.proven && asOf - s.proven.time < DAY ? 'active' : 'unknown', status: null, since: null, atLeast: false, reasons };
  }

  // t0: the latest sign of activity; without any in the window, the window's start ("at least since")
  const candidates = [s.proven?.time ?? null, s.lastGain].filter((t): t is number => t != null);
  const atLeast = !candidates.length;
  const t0 = atLeast ? (s.firstUpdate ?? s.newest) : Math.max(...candidates);
  if (s.lastGain != null) reasons.push({ code: 'gain', time: s.lastGain });
  else reasons.push({ code: 'noGain', since: t0, atLeast });
  if (s.weakGains) reasons.push({ code: 'weakGains', n: s.weakGains });

  // observed until: the newest statistics or a newer spy report without activity
  const idleSpy = s.idleSpy.filter((t) => t > t0 && t <= asOf);
  const observed = Math.max(s.newest, ...idleSpy);
  const idle = Math.max(0, observed - t0);
  let score = W.max * (1 - Math.exp(-idle / W.tau));
  if (idle > 0 && idleSpy.length) {
    score += Math.min(W.idleSpyMax, idleSpy.length * W.idleSpyBonus);
    reasons.push({ code: 'idleSpy', n: idleSpy.length });
  }
  if (idle > 0 && s.lossesSince != null && s.lossesSince >= t0) {
    score += W.lossBonus;
    reasons.push({ code: 'losses' });
  }
  const marks = s.galaxy.filter((t) => t > t0 && t <= asOf);
  if (marks.length) {
    score *= Math.max(W.galaxyFloor, W.galaxyFactor ** marks.length);
    reasons.push({ code: 'galaxy', n: marks.length, time: Math.max(...marks) });
  }
  score = Math.round(Math.min(W.max, Math.max(0, score)));
  const level = inactivityLevel(score);
  return { ...base, score, level, status: null, since: level === 'active' ? null : t0, atLeast: level !== 'active' && atLeast, reasons };
}

type Names = Map<string, number>;

/** Player id by lower-case name and former names. */
function namesOf(db: DB, groupId: number): Names {
  const rows = db
    .prepare('SELECT id, name FROM players WHERE group_id = ? UNION ALL SELECT a.player_id, a.name FROM player_aliases a JOIN players p ON p.id = a.player_id WHERE p.group_id = ?')
    .all(groupId, groupId) as { id: number; name: string }[];
  const out: Names = new Map();
  // current names win over former ones
  for (const r of rows) if (!out.has(r.name.toLowerCase())) out.set(r.name.toLowerCase(), r.id);
  return out;
}

/** Newest proven activity per player up to `asOf`. */
function provenActivity(db: DB, ctx: GroupContext, names: Names, from: number, asOf: number): Map<number, { time: number; source: ProofSource }> {
  const g = ctx.groupId;
  const out = new Map<number, { time: number; source: ProofSource }>();
  const add = (id: number | undefined, time: number | null, source: ProofSource) => {
    if (id == null || time == null) return;
    const cur = out.get(id);
    if (!cur || time > cur.time) out.set(id, { time, source });
  };
  const byName = (rows: { name: string; time: number }[], source: ProofSource) => {
    for (const r of rows) add(names.get(String(r.name).toLowerCase()), r.time, source);
  };
  byName(
    db
      .prepare('SELECT from_player AS name, MAX(time) AS time FROM hostile_spying WHERE group_id = ? AND time BETWEEN ? AND ? GROUP BY lower(from_player)')
      .all(g, from, asOf) as { name: string; time: number }[],
    'spy',
  );
  byName(
    db
      .prepare(
        `SELECT json_extract(f.value, '$[1]') AS name, MAX(cr.time) AS time FROM combat_reports cr, json_each(cr.fleets) f
         WHERE cr.group_id = ? AND cr.time BETWEEN ? AND ? AND json_extract(f.value, '$[0]') = 0 GROUP BY lower(json_extract(f.value, '$[1]'))`,
      )
      .all(g, from, asOf) as { name: string; time: number }[],
    'attack',
  );
  byName(
    db
      .prepare(
        `SELECT a.value AS name, MAX(bh.time) AS time FROM battle_hall bh, json_each(bh.attackers) a
         WHERE bh.group_id = ? AND bh.time BETWEEN ? AND ? GROUP BY lower(a.value)`,
      )
      .all(g, from, asOf) as { name: string; time: number }[],
    'attack',
  );
  // messages the player sent, as far as the viewer may see them
  byName(
    db
      .prepare(
        `SELECT pm.from_name AS name, MAX(pm.time) AS time FROM player_messages pm JOIN users u ON u.id = pm.user_id
         JOIN group_members gm ON gm.group_id = pm.group_id AND gm.user_id = pm.user_id
         WHERE pm.group_id = ? AND pm.time BETWEEN ? AND ? AND (pm.user_id = ? OR ${SHARED}) GROUP BY lower(pm.from_name)`,
      )
      .all(g, from, asOf, ctx.user.id) as { name: string; time: number }[],
    'message',
  );
  // fleet launches and recalls seen in members' overviews or by phalanx, reports by hand
  for (const r of db
    .prepare(
      `SELECT player_id, source, MAX(time) AS time FROM player_activity
       WHERE group_id = ? AND source IN ('fleet', 'recall', 'manual') AND time BETWEEN ? AND ? GROUP BY player_id, source`,
    )
    .all(g, from, asOf) as { player_id: number; source: 'fleet' | 'recall' | 'manual'; time: number }[]) {
    add(r.player_id, r.time, r.source);
  }
  return out;
}

/** Galaxy activity marks per player (already without the ones members' own actions caused). */
function galaxyMarks(db: DB, groupId: number, from: number, asOf: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const r of db
    .prepare("SELECT player_id, time FROM player_activity WHERE group_id = ? AND source = 'galaxy' AND time BETWEEN ? AND ?")
    .all(groupId, from, asOf) as { player_id: number; time: number }[]) {
    if (!out.has(r.player_id)) out.set(r.player_id, []);
    out.get(r.player_id)!.push(r.time);
  }
  return out;
}

interface StatSeries {
  newest: number | null;
  first: number | null;
  /** per player: last relevant gain, weak gains after it, in the newest update */
  players: Map<number, { lastGain: number | null; weakGains: number; inNewest: boolean }>;
}

/**
 * Total points of the window: per update the gain of every player against their previous update, and per gain the
 * median gain of the active players (gain > 0) within ±`rankWindow` ranks; a gain below `weakGain` of that median
 * doesn't count as activity.
 */
function statSeries(db: DB, groupId: number, from: number, asOf: number): StatSeries {
  const rows = db
    .prepare(
      `SELECT ps.player_id, ps.stat_time AS time, MAX(ps.points) AS points, MIN(ps.rank) AS rank FROM players p
       JOIN player_scores ps ON ps.player_id = p.id AND ps.type = 1 AND ps.stat_time BETWEEN ? AND ?
       WHERE p.group_id = ? GROUP BY ps.player_id, ps.stat_time ORDER BY ps.stat_time`,
    )
    .all(from, asOf, groupId) as { player_id: number; time: number; points: number; rank: number }[];
  const out: StatSeries = { newest: null, first: null, players: new Map() };
  if (!rows.length) return out;
  out.first = rows[0].time;
  out.newest = rows[rows.length - 1].time;
  const prev = new Map<number, number>();
  // updates with the gains of the players that have a previous one
  const byTime = new Map<number, { id: number; rank: number; gain: number }[]>();
  for (const r of rows) {
    const before = prev.get(r.player_id);
    prev.set(r.player_id, r.points);
    if (!out.players.has(r.player_id)) out.players.set(r.player_id, { lastGain: null, weakGains: 0, inNewest: false });
    if (before == null) continue;
    if (!byTime.has(r.time)) byTime.set(r.time, []);
    byTime.get(r.time)!.push({ id: r.player_id, rank: r.rank, gain: r.points - before });
  }
  for (const r of rows) if (r.time >= out.newest - STAT_SLOT / 2) out.players.get(r.player_id)!.inNewest = true;
  const w = INACTIVITY.rankWindow;
  for (const [time, list] of [...byTime].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.rank - b.rank);
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (x.gain <= 0) continue;
      const near = list.slice(Math.max(0, i - w), i + w + 1).filter((y) => y.gain > 0 && y.id !== x.id).map((y) => y.gain).sort((a, b) => a - b);
      const median = near.length ? near[Math.floor(near.length / 2)] : 0;
      const p = out.players.get(x.id)!;
      if (median > 0 && x.gain < INACTIVITY.weakGain * median) p.weakGains++;
      else {
        p.lastGain = time;
        p.weakGains = 0;
      }
    }
  }
  return out;
}

/** Fleet or defense points per player: the time since which the newest value is below an earlier one of the window. */
function lossesSince(db: DB, groupId: number, from: number, asOf: number): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT ps.player_id, ps.type, ps.stat_time AS time, MAX(ps.points) AS points FROM players p
       JOIN player_scores ps ON ps.player_id = p.id AND ps.type IN (2, 5) AND ps.stat_time BETWEEN ? AND ?
       WHERE p.group_id = ? GROUP BY ps.player_id, ps.type, ps.stat_time ORDER BY ps.stat_time`,
    )
    .all(from, asOf, groupId) as { player_id: number; type: number; time: number; points: number }[];
  const series = new Map<string, { time: number; points: number }[]>();
  for (const r of rows) {
    const k = `${r.player_id}:${r.type}`;
    if (!series.has(k)) series.set(k, []);
    series.get(k)!.push(r);
  }
  const out = new Map<number, number>();
  for (const [k, list] of series) {
    const last = list[list.length - 1];
    // the latest earlier update with more points: lost since then and not rebuilt
    let since: number | null = null;
    for (let i = list.length - 2; i >= 0; i--) {
      if (list[i].points > last.points) {
        since = list[i].time;
        break;
      }
    }
    if (since == null) continue;
    const id = Number(k.split(':')[0]);
    out.set(id, Math.max(out.get(id) ?? 0, since));
  }
  return out;
}

/**
 * Spy history: consecutive reports of the same planet or moon. A fleet that shrank without a known battle there was
 * sent away (proven activity at the earlier report). Resources that match the projection of the earlier report
 * (production up to the storage), with neither fleet nor buildings nor research changed, show nobody was there.
 */
function spyHistory(db: DB, ctx: GroupContext, eco: Economy, from: number, asOf: number) {
  const g = ctx.groupId;
  const reports = db
    .prepare(
      `SELECT player_id, g, s, p, planet_type, report_time AS time, sections FROM spy_reports
       WHERE group_id = ? AND player_id IS NOT NULL AND report_time BETWEEN ? AND ? ORDER BY g, s, p, planet_type, report_time`,
    )
    .all(g, from, asOf) as { player_id: number; g: number; s: number; p: number; planet_type: string; time: number; sections: string }[];
  const battles = db
    .prepare('SELECT g, s, p, planet_type, COALESCE(time, created_at) AS time FROM battle_reports WHERE group_id = ? AND COALESCE(time, created_at) BETWEEN ? AND ?')
    .all(g, from, asOf) as { g: number; s: number; p: number; planet_type: string; time: number }[];
  const battleAt = new Map<string, number[]>();
  for (const b of battles) {
    const k = `${b.g}:${b.s}:${b.p}:${b.planet_type}`;
    if (!battleAt.has(k)) battleAt.set(k, []);
    battleAt.get(k)!.push(b.time);
  }
  const fleetGone = new Map<number, number>();
  const idle = new Map<number, number[]>();
  const ships = (v: Record<string, number> | undefined) => (v ? Object.fromEntries(Object.entries(v).filter(([id]) => Number(id) !== SOLAR_SATELLITE)) : null);
  const same = (a: Record<string, number> | undefined, b: Record<string, number> | undefined) =>
    !!a && !!b && JSON.stringify(Object.entries(a).filter(([, n]) => n).sort()) === JSON.stringify(Object.entries(b).filter(([, n]) => n).sort());
  let last: (typeof reports)[number] & { sec: Record<string, Record<string, number>> } | null = null;
  // buildings of the position from the newest report showing them (levels change slowly)
  let levels: Record<string, number> | null = null;
  for (const r of reports) {
    const sec = JSON.parse(r.sections) as Record<string, Record<string, number>>;
    const key = `${r.g}:${r.s}:${r.p}:${r.planet_type}`;
    if (!last || `${last.g}:${last.s}:${last.p}:${last.planet_type}` !== key || last.player_id !== r.player_id) {
      levels = sec[CLASS_BUILDINGS] ?? null;
      last = { ...r, sec };
      continue;
    }
    const a = last.sec;
    const fought = (battleAt.get(key) ?? []).some((t) => t > last!.time && t <= r.time);
    const fa = ships(a[CLASS_FLEET]);
    const fb = ships(sec[CLASS_FLEET]);
    if (!fought && fa && fb) {
      const shrank = Object.entries(fa).some(([id, n]) => (fb[id] ?? 0) < n);
      if (shrank) fleetGone.set(r.player_id, Math.max(fleetGone.get(r.player_id) ?? 0, last.time));
    }
    const ra = a[CLASS_RESOURCES];
    const rb = sec[CLASS_RESOURCES];
    const unchanged =
      (!fa || !fb || same(fa, fb)) &&
      (!a[CLASS_BUILDINGS] || !sec[CLASS_BUILDINGS] || same(a[CLASS_BUILDINGS], sec[CLASS_BUILDINGS])) &&
      (!a[CLASS_RESEARCH] || !sec[CLASS_RESEARCH] || same(a[CLASS_RESEARCH], sec[CLASS_RESEARCH]));
    if (!fought && ra && rb && unchanged && (r.planet_type === 'moon' || levels)) {
      const hours = (r.time - last.time) / HOUR;
      const moon = r.planet_type === 'moon';
      const proj = projectResources({
        resources: ra,
        levels: moon ? {} : { ...levels!, [SOLAR_SATELLITE]: a[CLASS_FLEET]?.[SOLAR_SATELLITE] ?? 0 },
        temp: positionTemp(r.p),
        resourceSpeed: moon ? 0 : eco.resourceSpeed,
        storageFactor: eco.storageFactor,
        hours,
      });
      // metal and crystal: deuterium depends on the unknown temperature
      const fits = ([901, 902] as const).every((res) => {
        const made = proj.resources[res] - (ra[res] ?? 0);
        return Math.abs((rb[res] ?? 0) - proj.resources[res]) <= INACTIVITY.spyTolerance * Math.max(0, made) + INACTIVITY.spyAbsolute;
      });
      if (fits && hours >= 1) {
        if (!idle.has(r.player_id)) idle.set(r.player_id, []);
        idle.get(r.player_id)!.push(r.time);
      }
    }
    if (sec[CLASS_BUILDINGS]) levels = sec[CLASS_BUILDINGS];
    last = { ...r, sec };
  }
  return { fleetGone, idle };
}

const cache = new WeakMap<GroupContext, Map<number, Map<number, Inactivity>>>();

/**
 * Inactivity of the group's players (all, or `playerIds`) as the hub saw it at `asOf` (default: the universe's now;
 * an earlier time only uses data up to then, for the admin check): player id → score and signals.
 */
export function inactivities(db: DB, ctx: GroupContext, playerIds?: number[], asOf = ctx.now): Map<number, Inactivity> {
  let byTime = cache.get(ctx);
  if (!byTime) cache.set(ctx, (byTime = new Map()));
  let all = byTime.get(asOf);
  if (!all) {
    all = compute(db, ctx, asOf);
    byTime.set(asOf, all);
  }
  if (!playerIds) return all;
  return new Map(playerIds.filter((id) => all!.has(id)).map((id) => [id, all!.get(id)!]));
}

function compute(db: DB, ctx: GroupContext, asOf: number): Map<number, Inactivity> {
  const g = ctx.groupId;
  const from = asOf - 2 * inactiveDaysOf(ctx.universe.settings) * DAY;
  const names = namesOf(db, g);
  const stats = statSeries(db, g, from, asOf);
  const proven = provenActivity(db, ctx, names, from, asOf);
  const galaxy = galaxyMarks(db, g, from, asOf);
  const losses = lossesSince(db, g, from, asOf);
  const spy = spyHistory(db, ctx, economyOf(db, ctx), from, asOf);
  const live = asOf >= ctx.now;
  const players = db
    .prepare(
      `SELECT p.id, ${live ? 'p.status' : `COALESCE((SELECT l.status FROM player_status_log l WHERE l.player_id = p.id AND l.seen_at <= ? ORDER BY l.seen_at DESC LIMIT 1), '[]')`} AS status,
         (SELECT MIN(seen_at) FROM player_status_log l WHERE l.player_id = p.id AND l.status LIKE '%inactive%' AND l.seen_at <= ?
            AND l.seen_at >= COALESCE((SELECT MAX(seen_at) FROM player_status_log l2 WHERE l2.player_id = p.id AND l2.status NOT LIKE '%inactive%' AND l2.seen_at <= ?), 0)
         ) AS inactive_since
       FROM players p WHERE p.group_id = ?`,
    )
    .all(...(live ? [] : [asOf]), asOf, asOf, g) as { id: number; status: string; inactive_since: number | null }[];
  const out = new Map<number, Inactivity>();
  for (const p of players) {
    const st = stats.players.get(p.id);
    const gone = spy.fleetGone.get(p.id);
    const fromHub = proven.get(p.id) ?? null;
    const best = gone != null && (!fromHub || gone > fromHub.time) ? { time: gone, source: 'fleetGone' as const } : fromHub;
    out.set(
      p.id,
      inactivityOf(
        {
          status: JSON.parse(p.status || '[]'),
          inactiveSince: p.inactive_since,
          newest: stats.newest,
          inStats: !!st?.inNewest,
          firstUpdate: stats.first,
          lastGain: st?.lastGain ?? null,
          weakGains: st?.weakGains ?? 0,
          proven: best,
          galaxy: galaxy.get(p.id) ?? [],
          idleSpy: spy.idle.get(p.id) ?? [],
          lossesSince: losses.get(p.id) ?? null,
        },
        asOf,
      ),
    );
  }
  return out;
}
