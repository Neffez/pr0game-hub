import { localToEpoch } from '@pr0hub/core';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { memberPlayers } from './members.js';
import { type MemberRank, ranksAt } from './rank.js';
import { DISPLAY } from './sql.js';

/**
 * Sync incentives on top of the group's data: credits per member and day (`sync_credits`, written by the syncs), the
 * badges with their levels, the sync streak and the weekly ranking. Counts that the group's tables already hold
 * (battle and spy reports, expeditions, foreign espionage, player messages, raids, settlements, comments) are read
 * from them, so they include the time before the credits existed.
 */

// ---------------------------------------------------------------- credits

/** Kinds written to `sync_credits`. */
export type CreditKind = 'galaxy' | 'empire' | 'overview' | 'buildings' | 'research' | 'market' | 'stats' | 'statsFirst' | 'universe' | 'fresh' | 'miner';
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
  /** an up-to-date universe.json, once a week (Monday to Sunday) */
  universe: 100,
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

/** Kinds credited at most once a week (Monday to Sunday, like the ranking) instead of once a day. */
const WEEKLY: ReadonlySet<CreditKind> = new Set(['universe']);

/** Stores the credits of one sync for the member (a unit already credited that day, or that week for a weekly kind, stays as it is). */
export function addCredits(db: DB, groupId: number, userId: number, day: string, credits: Credit[]) {
  const put = db.prepare('INSERT OR IGNORE INTO sync_credits (group_id, user_id, day, kind, key) VALUES (?, ?, ?, ?, ?)');
  const inWeek = db.prepare('SELECT 1 FROM sync_credits WHERE group_id = ? AND user_id = ? AND kind = ? AND day BETWEEN ? AND ?');
  const { from } = periodDays('week', day);
  for (const c of credits) {
    if (WEEKLY.has(c.kind) && inWeek.get(groupId, userId, c.kind, from, day)) continue;
    put.run(groupId, userId, day, c.kind, c.key ?? '');
  }
}

// ---------------------------------------------------------------- badges

export type BadgeKey =
  | 'imperator' | 'cartographer' | 'scout' | 'fleeter' | 'expeditioner' | 'trader' | 'socializer' | 'chronicler'
  | 'fresh' | 'streak' | 'raider' | 'collector' | 'forist' | 'miner' | 'livingLegend';

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
  livingLegend: [1],
};
export const BADGE_KEYS = Object.keys(BADGES) as BadgeKey[];
/** Badges that global admins award by hand (`member_awards`) instead of a count. */
export const MANUAL_BADGES = ['livingLegend'] as const satisfies readonly BadgeKey[];
export type ManualBadgeKey = (typeof MANUAL_BADGES)[number];
export const isManualBadge = (key: string): key is ManualBadgeKey => (MANUAL_BADGES as readonly string[]).includes(key);

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
  /** the dynamic rank badge (repo/rank.ts) */
  rank: MemberRank;
}

/**
 * Badges and streak of every member of the group; with `asOf` (YYYY-MM-DD) as they were at the end of that day
 * (counts and streak from the data up to then), else today.
 */
export function achievements(db: DB, ctx: GroupContext, asOf?: string): MemberAchievements[] {
  const day = asOf ?? dayOf(ctx.now, ctx.universe.settings.timezone);
  return achievementsAt(db, ctx, [day]).get(day)!;
}

/**
 * Badges and streak of every member as they were at the end of each of `days` (YYYY-MM-DD), in one pass: the days
 * with an own sync and the vacation history are read once for all of them (the recap compares two days).
 */
export function achievementsAt(db: DB, ctx: GroupContext, days: string[]): Map<string, MemberAchievements[]> {
  const g = ctx.groupId;
  const tz = ctx.universe.settings.timezone;
  const sorted = [...new Set(days)].sort();
  const last = sorted[sorted.length - 1];
  const lastEnd = dayStart(addDays(last, 1), tz);
  const since = dayStart(sorted[0], tz) - HISTORY_DAYS * 86400;
  const members = db
    .prepare(`SELECT m.user_id, ${DISPLAY} AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY name COLLATE NOCASE`)
    .all(g) as { user_id: number; name: string }[];

  const byUser = (sql: string, ...args: unknown[]) =>
    new Map((db.prepare(sql).all(g, ...args) as { user_id: number; n: number }[]).map((r) => [r.user_id, r.n]));
  /** the badge counts at the end of `today` */
  const countsAt = (today: string): Record<BadgeKey, Map<number, number>> => {
    const end = dayStart(addDays(today, 1), tz);
    const credits = (kind: CreditKind) => byUser('SELECT user_id, COUNT(*) AS n FROM sync_credits WHERE group_id = ? AND kind = ? AND day <= ? GROUP BY user_id', kind, today);
    return {
      imperator: credits('empire'),
      cartographer: credits('galaxy'),
      scout: byUser('SELECT user_id, COUNT(*) AS n FROM spy_reports WHERE group_id = ? AND user_id IS NOT NULL AND created_at < ? GROUP BY user_id', end),
      fleeter: byUser('SELECT user_id, COUNT(*) AS n FROM battle_reports WHERE group_id = ? AND user_id IS NOT NULL AND created_at < ? GROUP BY user_id', end),
      expeditioner: byUser('SELECT user_id, COUNT(*) AS n FROM expeditions WHERE group_id = ? AND created_at < ? GROUP BY user_id', end),
      trader: credits('market'),
      socializer: byUser('SELECT user_id, COUNT(*) AS n FROM player_messages WHERE group_id = ? AND created_at < ? GROUP BY user_id', end),
      chronicler: credits('statsFirst'),
      fresh: credits('fresh'),
      streak: new Map(),
      raider: byUser("SELECT user_id, COUNT(*) AS n FROM attack_plans WHERE group_id = ? AND mission = 'attack' AND status <> 'cancelled' AND created_at < ? GROUP BY user_id", end),
      collector: byUser('SELECT finalized_by AS user_id, COUNT(*) AS n FROM raid_settlements WHERE group_id = ? AND finalized_by IS NOT NULL AND finalized_at < ? GROUP BY finalized_by', end),
      forist: byUser('SELECT user_id, COUNT(*) AS n FROM comments WHERE group_id = ? AND player_id IS NOT NULL AND user_id IS NOT NULL AND created_at < ? GROUP BY user_id', end),
      miner: credits('miner'),
      livingLegend: byUser("SELECT user_id, COUNT(*) AS n FROM member_awards WHERE group_id = ? AND key = 'livingLegend' AND awarded_at < ? GROUP BY user_id", end),
    };
  };

  // days with an own sync: credited own pages, and the hours of the member's reports (converted to days below); a
  // streak only looks at the days up to its own end
  const syncDays = new Map<number, Set<string>>();
  const addDay = (userId: number, day: string) => {
    let s = syncDays.get(userId);
    if (!s) syncDays.set(userId, (s = new Set()));
    s.add(day);
  };
  for (const r of db
    .prepare("SELECT DISTINCT user_id, day FROM sync_credits WHERE group_id = ? AND kind IN ('empire', 'overview', 'buildings', 'research') AND day >= ? AND day <= ?")
    .all(g, dayOf(since, tz), last) as { user_id: number; day: string }[]) addDay(r.user_id, r.day);
  const hours = (sql: string) => {
    for (const r of db.prepare(sql).all(g, since, lastEnd) as { user_id: number; h: number }[]) addDay(r.user_id, dayOf(r.h * 3600, tz));
  };
  hours('SELECT DISTINCT user_id, created_at / 3600 AS h FROM spy_reports WHERE group_id = ? AND created_at >= ? AND created_at < ? AND user_id IS NOT NULL');
  hours('SELECT DISTINCT user_id, created_at / 3600 AS h FROM battle_reports WHERE group_id = ? AND created_at >= ? AND created_at < ? AND user_id IS NOT NULL');
  hours('SELECT DISTINCT user_id, created_at / 3600 AS h FROM expeditions WHERE group_id = ? AND created_at >= ? AND created_at < ?');
  hours('SELECT DISTINCT user_id, created_at / 3600 AS h FROM player_messages WHERE group_id = ? AND created_at >= ? AND created_at < ?');
  hours('SELECT DISTINCT user_id, time / 3600 AS h FROM hostile_spying WHERE group_id = ? AND time >= ? AND time < ? AND user_id IS NOT NULL');

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

  const vacations = new Map(members.map((m) => [m.user_id, vacationOf(m.user_id)]));
  const dayEnd = (day: string) => dayStart(addDays(day, 1), tz);
  const ranks = ranksAt(db, ctx, members.map((m) => m.user_id), sorted.map(dayEnd));

  return new Map(
    sorted.map((today) => {
      const counts = countsAt(today);
      const rankOf = ranks.get(dayEnd(today))!;
      const list = members.map((m) => {
        const upTo = new Set([...(syncDays.get(m.user_id) ?? [])].filter((d) => d <= today));
        const streak = streakOf(upTo, vacations.get(m.user_id)!, today);
        counts.streak.set(m.user_id, streak.best);
        return { userId: m.user_id, name: m.name, playerId: players.get(m.user_id) ?? null, streak, badges: BADGE_KEYS.map((k) => badge(k, counts[k].get(m.user_id) ?? 0)), rank: rankOf.get(m.user_id)! };
      });
      return [today, list] as const;
    }),
  );
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

/** Units that earn points: per member, day (universe's time zone) and kind, how many. */
export interface PointUnit {
  userId: number;
  day: string;
  kind: PointKind;
  n: number;
}

/** The point units of the group's members from day `from` to day `to` (both included). */
export function pointUnits(db: DB, ctx: GroupContext, from: string, to: string): PointUnit[] {
  const g = ctx.groupId;
  const tz = ctx.universe.settings.timezone;
  const start = dayStart(from, tz);
  const end = dayStart(addDays(to, 1), tz);
  const units = new Map<string, PointUnit>();
  const add = (userId: number, day: string, kind: PointKind, n: number) => {
    const k = `${userId}|${day}|${kind}`;
    const u = units.get(k);
    if (u) u.n += n;
    else units.set(k, { userId, day, kind, n });
  };
  for (const r of db
    .prepare("SELECT user_id, day, kind, SUM(count) AS n FROM sync_credits WHERE group_id = ? AND day BETWEEN ? AND ? AND kind NOT IN ('fresh', 'miner', 'sync') GROUP BY user_id, day, kind")
    .all(g, from, to) as { user_id: number; day: string; kind: PointKind; n: number }[]) add(r.user_id, r.day, r.kind, r.n);
  // reports by the hour they were stored, the hour's day in the universe's time zone
  const counted = (kind: PointKind, sql: string) => {
    for (const r of db.prepare(sql).all(g, start, end) as { user_id: number; h: number; n: number }[]) add(r.user_id, dayOf(r.h * 3600, tz), kind, r.n);
  };
  counted('spy', 'SELECT user_id, created_at / 3600 AS h, COUNT(*) AS n FROM spy_reports WHERE group_id = ? AND created_at >= ? AND created_at < ? AND user_id IS NOT NULL GROUP BY user_id, h');
  counted('battle', 'SELECT user_id, created_at / 3600 AS h, COUNT(*) AS n FROM battle_reports WHERE group_id = ? AND created_at >= ? AND created_at < ? AND user_id IS NOT NULL GROUP BY user_id, h');
  counted('expedition', 'SELECT user_id, created_at / 3600 AS h, COUNT(*) AS n FROM expeditions WHERE group_id = ? AND created_at >= ? AND created_at < ? GROUP BY user_id, h');
  counted('messages', 'SELECT user_id, created_at / 3600 AS h, COUNT(*) AS n FROM player_messages WHERE group_id = ? AND created_at >= ? AND created_at < ? GROUP BY user_id, h');
  counted('hostile', 'SELECT user_id, time / 3600 AS h, COUNT(*) AS n FROM hostile_spying WHERE group_id = ? AND time >= ? AND time < ? AND user_id IS NOT NULL GROUP BY user_id, h');
  return [...units.values()];
}

/** Points of every member over a period, best first. */
export function ranking(db: DB, ctx: GroupContext, period: RankingPeriod): { from: string; to: string; rows: RankingRow[] } {
  const { from, to } = periodDays(period, dayOf(ctx.now, ctx.universe.settings.timezone));
  return { from, to, rows: rankRows(db, ctx, pointUnits(db, ctx, from, to)) };
}

/** Every member with the points of the units, best first. */
export function rankRows(db: DB, ctx: GroupContext, units: PointUnit[]): RankingRow[] {
  const members = db
    .prepare(`SELECT m.user_id, ${DISPLAY} AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?`)
    .all(ctx.groupId) as { user_id: number; name: string }[];
  const rows = new Map<number, RankingRow>(members.map((m) => [m.user_id, { userId: m.user_id, name: m.name, points: 0, parts: {} }]));
  for (const u of units) {
    const row = rows.get(u.userId);
    if (!row || !u.n) continue;
    const p = u.n * POINTS[u.kind];
    row.parts[u.kind] = (row.parts[u.kind] ?? 0) + p;
    row.points += p;
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
