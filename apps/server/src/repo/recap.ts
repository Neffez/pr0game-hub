import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import {
  achievementsAt, addDays, dayOf, periodDays, pointUnits, POINTS, rankRows, type BadgeKey, type PointKind, type RankingPeriod,
} from './achievements.js';
import { allianceGoals, GOAL_DEFAULTS, goalSettings } from './goals.js';

/**
 * Recap of a period for the alliance (the progress page's tab, the post to the Discord channel): syncs, active
 * members, points and their kinds, badges reached in the period, highlights and what is still open. Each number
 * comes with the same span before it (this week so far against the same days of last week).
 */

export interface RecapCompare {
  now: number;
  before: number;
}

export interface RecapRow {
  userId: number;
  name: string;
  points: number;
  /** points of the span before */
  before: number;
  syncs: number;
  /** streak at the end of the period */
  streak: number;
  /** badge levels reached in the period */
  badges: number;
}

/** The ranking's periods and `start`: from the universe's start (its scheduled start, else its creation) to today. */
export type RecapPeriod = RankingPeriod | 'start';
export const RECAP_PERIODS: RecapPeriod[] = ['week', 'lastWeek', 'days30', 'start'];

export type HighlightKey = 'top' | 'riser' | 'cartographer' | 'scout' | 'streak' | 'badges';
export const HIGHLIGHT_KEYS: HighlightKey[] = ['top', 'riser', 'cartographer', 'scout', 'streak', 'badges'];

export interface Recap {
  period: RecapPeriod;
  from: string;
  to: string;
  /** the span compared with, null for `start` (nothing before it) */
  previous: { from: string; to: string } | null;
  /** members of the group */
  members: number;
  /** syncs that brought something new */
  syncs: RecapCompare;
  /** members with points or syncs */
  active: RecapCompare;
  points: RecapCompare;
  /** badge levels reached in the period, all members */
  newBadges: number;
  /** per kind with points: units and points in the period, points before; most points first */
  kinds: { kind: PointKind; units: number; points: number; before: number }[];
  /** every day of the period */
  days: { day: string; syncs: number; points: number }[];
  /** the best member of each highlight that has one */
  highlights: { key: HighlightKey; userId: number; name: string; value: number }[];
  /** badge levels reached in the period: the highest per member and badge, highest level first */
  badges: { userId: number; name: string; key: BadgeKey; level: number }[];
  /** members, most points first */
  rows: RecapRow[];
  /** what is open now (not at the end of a past period) */
  open: {
    /** galaxy systems seen within `days` (the alliance goal's window) */
    galaxy: { fresh: number; total: number; days: number; weakest: { g: number; fresh: number; total: number } | null };
    /** members without points in the period */
    idle: number;
    /** members without an empire page in the period */
    noEmpire: number;
    /** alliance goals at their target */
    goals: { reached: number; total: number };
  };
}

const DAY = 86400;

/** The span before a period: the same days a week (a month for 30 days) earlier. */
export function previousSpan(period: RankingPeriod, from: string, to: string) {
  const back = period === 'days30' ? 30 : 7;
  return { from: addDays(from, -back), to: addDays(to, -back) };
}

/** The first day of the universe in its time zone: its scheduled start, else the day it was created. */
export function startDay(db: DB, ctx: GroupContext): string {
  const start = ctx.universe.startsAt ?? (db.prepare('SELECT created_at FROM universes WHERE id = ?').pluck().get(ctx.universe.id) as number);
  return dayOf(start, ctx.universe.settings.timezone);
}

export function recap(db: DB, ctx: GroupContext, period: RecapPeriod): Recap {
  const g = ctx.groupId;
  const tz = ctx.universe.settings.timezone;
  const today = dayOf(ctx.now, tz);
  const { from, to } = period === 'start' ? { from: [startDay(db, ctx), today].sort()[0], to: today } : periodDays(period, today);
  const previous = period === 'start' ? null : previousSpan(period, from, to);
  // without a span before, an empty one ends the day before the period
  const span = previous ?? { from, to: addDays(from, -1) };

  const units = pointUnits(db, ctx, span.from, to);
  const inPeriod = units.filter((u) => u.day >= from);
  const before = units.filter((u) => u.day <= span.to);
  const rowsNow = rankRows(db, ctx, inPeriod);
  const rowsBefore = new Map(rankRows(db, ctx, before).map((r) => [r.userId, r]));

  const syncRows = db
    .prepare("SELECT user_id, day, SUM(count) AS n FROM sync_credits WHERE group_id = ? AND kind = 'sync' AND day BETWEEN ? AND ? GROUP BY user_id, day")
    .all(g, span.from, to) as { user_id: number; day: string; n: number }[];
  const syncsOf = (userId: number, a: string, b: string) => syncRows.filter((r) => r.user_id === userId && r.day >= a && r.day <= b).reduce((n, r) => n + r.n, 0);
  const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((n, x) => n + f(x), 0);

  // badges: the levels at the end of the period against the end of the day before it
  const at = achievementsAt(db, ctx, [to, addDays(from, -1)]);
  const end = new Map(at.get(to)!.map((m) => [m.userId, m]));
  const start = new Map(at.get(addDays(from, -1))!.map((m) => [m.userId, m]));
  const badges: Recap['badges'] = [];
  for (const m of end.values()) {
    const was = new Map((start.get(m.userId)?.badges ?? []).map((b) => [b.key, b.level]));
    for (const b of m.badges) if (b.level > (was.get(b.key) ?? 0)) badges.push({ userId: m.userId, name: m.name, key: b.key, level: b.level });
  }
  badges.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  const levelsGained = (userId: number) => {
    const was = new Map((start.get(userId)?.badges ?? []).map((b) => [b.key, b.level]));
    return sum(end.get(userId)?.badges ?? [], (b) => Math.max(0, b.level - (was.get(b.key) ?? 0)));
  };

  const rows: RecapRow[] = rowsNow.map((r) => ({
    userId: r.userId,
    name: r.name,
    points: r.points,
    before: rowsBefore.get(r.userId)?.points ?? 0,
    syncs: syncsOf(r.userId, from, to),
    streak: end.get(r.userId)?.streak.current ?? 0,
    badges: levelsGained(r.userId),
  }));
  const activeNow = rows.filter((r) => r.points > 0 || r.syncs > 0).length;
  const activeBefore = rows.filter((r) => r.before > 0 || syncsOf(r.userId, span.from, span.to) > 0).length;

  const kinds = (Object.keys(POINTS) as PointKind[])
    .map((kind) => ({
      kind,
      units: sum(inPeriod.filter((u) => u.kind === kind), (u) => u.n),
      points: sum(inPeriod.filter((u) => u.kind === kind), (u) => u.n) * POINTS[kind],
      before: sum(before.filter((u) => u.kind === kind), (u) => u.n) * POINTS[kind],
    }))
    .filter((k) => k.points > 0 || k.before > 0)
    .sort((a, b) => b.points - a.points || b.before - a.before);

  const days: Recap['days'] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push({
      day: d,
      syncs: sum(syncRows.filter((r) => r.day === d), (r) => r.n),
      points: sum(inPeriod.filter((u) => u.day === d), (u) => u.n * POINTS[u.kind]),
    });
  }

  // highlights: the best member of each, when there is one (ties: the earlier name)
  const highlights: Recap['highlights'] = [];
  const best = (key: HighlightKey, value: (r: RecapRow) => number, min = 1) => {
    const top = [...rows].sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name))[0];
    if (top && value(top) >= min) highlights.push({ key, userId: top.userId, name: top.name, value: value(top) });
  };
  const unitsOf = (kind: PointKind) => {
    const m = new Map<number, number>();
    for (const u of inPeriod) if (u.kind === kind) m.set(u.userId, (m.get(u.userId) ?? 0) + u.n);
    return (r: RecapRow) => m.get(r.userId) ?? 0;
  };
  best('top', (r) => r.points);
  // a jump needs a span before
  if (previous) best('riser', (r) => r.points - r.before);
  best('cartographer', unitsOf('galaxy'));
  best('scout', unitsOf('spy'));
  best('streak', (r) => r.streak, 2);
  best('badges', (r) => r.badges);

  // open: the galaxy's coverage now in the alliance goal's window, the weakest galaxy
  const settings = ctx.universe.settings;
  const window = goalSettings(db, g).galaxy.days ?? GOAL_DEFAULTS.galaxy.days!;
  const perGalaxy = new Map(
    (db.prepare('SELECT g, COUNT(*) AS n FROM galaxy_views WHERE group_id = ? AND seen_at >= ? GROUP BY g').all(g, ctx.now - window * DAY) as { g: number; n: number }[]).map(
      (r) => [r.g, r.n],
    ),
  );
  let weakest: Recap['open']['galaxy']['weakest'] = null;
  for (let x = 1; x <= settings.galaxies; x++) {
    const fresh = perGalaxy.get(x) ?? 0;
    if (!weakest || fresh < weakest.fresh) weakest = { g: x, fresh, total: settings.systems };
  }
  const empireDays = new Set(
    db
      .prepare("SELECT DISTINCT user_id FROM sync_credits WHERE group_id = ? AND kind = 'empire' AND day BETWEEN ? AND ?")
      .pluck()
      .all(g, from, to) as number[],
  );
  const goals = allianceGoals(db, ctx);

  return {
    period,
    from,
    to,
    previous,
    members: rows.length,
    syncs: { now: sum(syncRows.filter((r) => r.day >= from), (r) => r.n), before: sum(syncRows.filter((r) => r.day <= span.to), (r) => r.n) },
    active: { now: activeNow, before: activeBefore },
    points: { now: sum(rows, (r) => r.points), before: sum(rows, (r) => r.before) },
    newBadges: badges.length,
    kinds,
    days,
    highlights,
    badges,
    rows,
    open: {
      galaxy: { fresh: [...perGalaxy.values()].reduce((a, b) => a + b, 0), total: settings.galaxies * settings.systems, days: window, weakest },
      idle: rows.filter((r) => r.points === 0).length,
      noEmpire: rows.filter((r) => !empireDays.has(r.userId)).length,
      goals: { reached: goals.filter((x) => x.value != null && x.value >= x.target).length, total: goals.length },
    },
  };
}
