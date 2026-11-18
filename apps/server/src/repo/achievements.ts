import { localToEpoch } from '@pr0hub/core';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { memberPlayers } from './members.js';
import { DISPLAY } from './sql.js';

/**
 * Sync incentives on top of the group's data: credits per member and day (`sync_credits`, written by the syncs), the
 * badges with their levels, the sync streak and the weekly ranking. Counts that the group's tables already hold
 * (battle and spy reports, expeditions, foreign espionage, player messages, raids, settlements, comments) are read
 * from them, so they include the time before the credits existed.
 */

// ---------------------------------------------------------------- credits

/** Kinds written to `sync_credits`. */
export type CreditKind = 'galaxy' | 'empire' | 'overview' | 'buildings' | 'research' | 'market' | 'stats' | 'statsFirst' | 'fresh' | 'miner';
export interface Credit {
  kind: CreditKind;
  /** unit counted once a day ('' for once-a-day kinds) */
  key?: string;
}

/** Points per unit in the ranking: what a single copy is worth to the alliance, galaxy and spy reports first. */
export const POINTS = {
  galaxy: 3,
  spy: 3,
  empire: 10,
  overview: 5,
  hostile: 3,
  battle: 3,
  buildings: 2,
  research: 2,
  market: 2,
  expedition: 1,
  messages: 1,
  stats: 1,
  statsFirst: 2,
} as const;
export type PointKind = keyof typeof POINTS;

const days = new Map<string, Intl.DateTimeFormat>();
/** The day (YYYY-MM-DD) of an instant in the universe's time zone. */
export function dayOf(epoch: number, timeZone: string): string {
  let f = days.get(timeZone);
  if (!f) days.set(timeZone, (f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })));
  return f.format(new Date(epoch * 1000));
}
/** The day `n` days after `day` (negative: before). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Start of a day in the universe's time zone, Unix seconds. */
const dayStart = (day: string, timeZone: string) => localToEpoch(`${day} 00:00:00`, timeZone);

/** Stores the credits of one sync for the member (a unit already credited that day stays as it is). */
export function addCredits(db: DB, groupId: number, userId: number, day: string, credits: Credit[]) {
  const put = db.prepare('INSERT OR IGNORE INTO sync_credits (group_id, user_id, day, kind, key) VALUES (?, ?, ?, ?, ?)');
  for (const c of credits) put.run(groupId, userId, day, c.kind, c.key ?? '');
}

// ---------------------------------------------------------------- badges

export type BadgeKey =
  | 'imperator' | 'cartographer' | 'scout' | 'fleeter' | 'expeditioner' | 'trader' | 'socializer' | 'chronicler'
  | 'fresh' | 'streak' | 'raider' | 'collector' | 'forist' | 'miner';

/** Levels of each badge: the counts that reach them. */
export const BADGES: Record<BadgeKey, number[]> = {
  imperator: [10, 20, 30, 50, 100, 200],
  cartographer: [40, 400, 4000, 8000, 12000],
  scout: [100, 200, 500, 1000, 2500, 5000, 10000],
  fleeter: [10, 100, 200, 500, 1000],
  expeditioner: [10, 100, 500, 1000, 2000, 5000],
  trader: [10, 20, 30, 50, 100, 200],
  socializer: [10, 20, 50, 100],
  chronicler: [10, 50, 200],
  fresh: [7, 30, 100],
  streak: [7, 30, 100, 365],
  raider: [1, 10, 20],
  collector: [1, 10, 20],
  forist: [1, 10, 20, 50, 100],
  miner: [1],
};
export const BADGE_KEYS = Object.keys(BADGES) as BadgeKey[];

export interface Badge {
  key: BadgeKey;
  count: number;
  /** reached level, 0 = not yet */
  level: number;
  /** number of levels */
  levels: number;
  /** count of the next level, null at the top */
  next: number | null;
  /** the counts of all levels */
  steps: number[];
}

/** A freshness score from this one counts as a "fresh" day. */
export const FRESH_SCORE = 90;
/** A build order planning this far ahead earns the miner badge. */
export const MINER_AHEAD = 5 * 86400;

function badge(key: BadgeKey, count: number): Badge {
  const levels = BADGES[key];
  const level = levels.filter((n) => count >= n).length;
  return { key, count, level, levels: levels.length, next: levels[level] ?? null, steps: levels };
}

// ---------------------------------------------------------------- streak

export interface Streak {
  /** days in a row up to today (today counts once synced, an open today does not break it) */
  current: number;
  /** longest run */
  best: number;
  /** today already counts */
  today: boolean;
}

/** Days are only looked at this far back. */
const HISTORY_DAYS = 400;

/**
 * Sync streak: days with a sync only the member can make (own empire, overview, buildings or research page, own
 * messages: spy, battle and expedition reports, foreign espionage, player messages). A day without one breaks it,
 * unless the member's player was in vacation mode that day (it pauses: counts neither way).
 */
export function streakOf(syncDays: Set<string>, vacation: (day: string) => boolean, today: string): Streak {
  const run = (from: string, until: string) => {
    let n = 0;
    let best = 0;
    for (let d = from; d <= until; d = addDays(d, 1)) {
      if (syncDays.has(d)) best = Math.max(best, ++n);
      else if (d !== today && !vacation(d)) n = 0;
    }
    return { n, best };
  };
  const first = [...syncDays].sort()[0];
  if (!first) return { current: 0, best: 0, today: false };
  const { n, best } = run(first, today);
  return { current: n, best, today: syncDays.has(today) };
}

// ---------------------------------------------------------------- members

export interface MemberAchievements {
  userId: number;
  name: string;
  /** the member's player in the game (from the empire and galaxy data), null while unknown */
  playerId: number | null;
  streak: Streak;
  badges: Badge[];
}

/** Badges and streak of every member of the group. */
export function achievements(db: DB, ctx: GroupContext): MemberAchievements[] {
  const g = ctx.groupId;
  const tz = ctx.universe.settings.timezone;
  const today = dayOf(ctx.now, tz);
  const since = ctx.now - HISTORY_DAYS * 86400;
  const members = db
    .prepare(`SELECT m.user_id, ${DISPLAY} AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY name COLLATE NOCASE`)
    .all(g) as { user_id: number; name: string }[];

  const byUser = (sql: string, ...args: unknown[]) =>
    new Map((db.prepare(sql).all(g, ...args) as { user_id: number; n: number }[]).map((r) => [r.user_id, r.n]));
  const credits = (kind: CreditKind) => byUser('SELECT user_id, COUNT(*) AS n FROM sync_credits WHERE group_id = ? AND kind = ? GROUP BY user_id', kind);
  const counts: Record<BadgeKey, Map<number, number>> = {
    imperator: credits('empire'),
    cartographer: credits('galaxy'),
    scout: byUser('SELECT user_id, COUNT(*) AS n FROM spy_reports WHERE group_id = ? AND user_id IS NOT NULL GROUP BY user_id'),
    fleeter: byUser('SELECT user_id, COUNT(*) AS n FROM battle_reports WHERE group_id = ? AND user_id IS NOT NULL GROUP BY user_id'),
    expeditioner: byUser('SELECT user_id, COUNT(*) AS n FROM expeditions WHERE group_id = ? GROUP BY user_id'),
    trader: credits('market'),
    socializer: byUser('SELECT user_id, COUNT(*) AS n FROM player_messages WHERE group_id = ? GROUP BY user_id'),
    chronicler: credits('statsFirst'),
    fresh: credits('fresh'),
    streak: new Map(),
    raider: byUser("SELECT user_id, COUNT(*) AS n FROM attack_plans WHERE group_id = ? AND mission = 'attack' AND status <> 'cancelled' GROUP BY user_id"),
    collector: byUser('SELECT finalized_by AS user_id, COUNT(*) AS n FROM raid_settlements WHERE group_id = ? AND finalized_by IS NOT NULL GROUP BY finalized_by'),
    forist: byUser('SELECT user_id, COUNT(*) AS n FROM comments WHERE group_id = ? AND player_id IS NOT NULL AND user_id IS NOT NULL GROUP BY user_id'),
    miner: credits('miner'),
  };

  // days with an own sync: credited own pages, and the hours of the member's reports (converted to days below)
  const syncDays = new Map<number, Set<string>>();
  const addDay = (userId: number, day: string) => {
    let s = syncDays.get(userId);
    if (!s) syncDays.set(userId, (s = new Set()));
    s.add(day);
  };
  for (const r of db
    .prepare("SELECT DISTINCT user_id, day FROM sync_credits WHERE group_id = ? AND kind IN ('empire', 'overview', 'buildings', 'research') AND day >= ?")
    .all(g, dayOf(since, tz)) as { user_id: number; day: string }[]) addDay(r.user_id, r.day);
  const hours = (sql: string) => {
    for (const r of db.prepare(sql).all(g, since) as { user_id: number; h: number }[]) addDay(r.user_id, dayOf(r.h * 3600, tz));
  };
  hours('SELECT DISTINCT user_id, created_at / 3600 AS h FROM spy_reports WHERE group_id = ? AND created_at >= ? AND user_id IS NOT NULL');
  hours('SELECT DISTINCT user_id, created_at / 3600 AS h FROM battle_reports WHERE group_id = ? AND created_at >= ? AND user_id IS NOT NULL');
  hours('SELECT DISTINCT user_id, created_at / 3600 AS h FROM expeditions WHERE group_id = ? AND created_at >= ?');
  hours('SELECT DISTINCT user_id, created_at / 3600 AS h FROM player_messages WHERE group_id = ? AND created_at >= ?');
  hours('SELECT DISTINCT user_id, time / 3600 AS h FROM hostile_spying WHERE group_id = ? AND time >= ? AND user_id IS NOT NULL');

  // vacation mode of the members' players over time (status log: the status from each entry on)
  const players = memberPlayers(db, ctx);
  const statusLog = db.prepare('SELECT status, seen_at FROM player_status_log WHERE player_id = ? ORDER BY seen_at');
  const vacationOf = (userId: number) => {
    const player = players.get(userId);
    if (player == null) return () => false;
    const log = (statusLog.all(player) as { status: string; seen_at: number }[]).map((r) => ({ at: r.seen_at, vacation: r.status.includes('"vacation"') }));
    if (!log.some((x) => x.vacation)) return () => false;
    return (day: string) => {
      const end = dayStart(addDays(day, 1), tz);
      let on = false;
      for (const x of log) {
        if (x.at >= end) break;
        on = x.vacation;
      }
      return on;
    };
  };

  return members.map((m) => {
    const streak = streakOf(syncDays.get(m.user_id) ?? new Set(), vacationOf(m.user_id), today);
    counts.streak.set(m.user_id, streak.best);
    return { userId: m.user_id, name: m.name, playerId: players.get(m.user_id) ?? null, streak, badges: BADGE_KEYS.map((k) => badge(k, counts[k].get(m.user_id) ?? 0)) };
  });
}

// ---------------------------------------------------------------- ranking

export type RankingPeriod = 'week' | 'lastWeek' | 'days30';
export const RANKING_PERIODS: RankingPeriod[] = ['week', 'lastWeek', 'days30'];

export interface RankingRow {
  userId: number;
  name: string;
  points: number;
  /** points per kind */
  parts: Partial<Record<PointKind, number>>;
}

/** The days of a period: this calendar week (Monday to today), last week, or the last 30 days including today. */
export function periodDays(period: RankingPeriod, today: string): { from: string; to: string } {
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  const monday = addDays(today, -weekday);
  if (period === 'week') return { from: monday, to: today };
  if (period === 'lastWeek') return { from: addDays(monday, -7), to: addDays(monday, -1) };
  return { from: addDays(today, -29), to: today };
}

/** Points of every member over a period, best first. */
export function ranking(db: DB, ctx: GroupContext, period: RankingPeriod): { from: string; to: string; rows: RankingRow[] } {
  const g = ctx.groupId;
  const tz = ctx.universe.settings.timezone;
  const { from, to } = periodDays(period, dayOf(ctx.now, tz));
  const start = dayStart(from, tz);
  const end = dayStart(addDays(to, 1), tz);
  const members = db
    .prepare(`SELECT m.user_id, ${DISPLAY} AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?`)
    .all(g) as { user_id: number; name: string }[];
  const rows = new Map<number, RankingRow>(members.map((m) => [m.user_id, { userId: m.user_id, name: m.name, points: 0, parts: {} }]));
  const add = (userId: number, kind: PointKind, n: number) => {
    const row = rows.get(userId);
    if (!row || !n) return;
    const p = n * POINTS[kind];
    row.parts[kind] = (row.parts[kind] ?? 0) + p;
    row.points += p;
  };
  for (const r of db
    .prepare("SELECT user_id, kind, SUM(count) AS n FROM sync_credits WHERE group_id = ? AND day BETWEEN ? AND ? AND kind NOT IN ('fresh', 'miner') GROUP BY user_id, kind")
    .all(g, from, to) as { user_id: number; kind: PointKind; n: number }[]) add(r.user_id, r.kind, r.n);
  const counted = (kind: PointKind, sql: string) => {
    for (const r of db.prepare(sql).all(g, start, end) as { user_id: number; n: number }[]) add(r.user_id, kind, r.n);
  };
  counted('spy', 'SELECT user_id, COUNT(*) AS n FROM spy_reports WHERE group_id = ? AND created_at >= ? AND created_at < ? AND user_id IS NOT NULL GROUP BY user_id');
  counted('battle', 'SELECT user_id, COUNT(*) AS n FROM battle_reports WHERE group_id = ? AND created_at >= ? AND created_at < ? AND user_id IS NOT NULL GROUP BY user_id');
  counted('expedition', 'SELECT user_id, COUNT(*) AS n FROM expeditions WHERE group_id = ? AND created_at >= ? AND created_at < ? GROUP BY user_id');
  counted('messages', 'SELECT user_id, COUNT(*) AS n FROM player_messages WHERE group_id = ? AND created_at >= ? AND created_at < ? GROUP BY user_id');
  counted('hostile', 'SELECT user_id, COUNT(*) AS n FROM hostile_spying WHERE group_id = ? AND time >= ? AND time < ? AND user_id IS NOT NULL GROUP BY user_id');
  return { from, to, rows: [...rows.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)) };
}
