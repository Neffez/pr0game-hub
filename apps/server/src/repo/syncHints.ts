import { localToEpoch } from '@pr0hub/core';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { TOLERANCE, TYPES } from '../domain/stats.js';
import { latestEmpire } from './empire.js';
import { latestMarketRate } from './market.js';

/** Pages a member can paste next; the web app explains each one (what is missing and which feature it improves). */
export type SyncHintKey = 'empire' | 'stats' | 'overview' | 'galaxy' | 'buildings' | 'research' | 'messages' | 'market';

export interface SyncHint {
  key: SyncHintKey;
  /** high: features are missing or wrong without it; medium: noticeably outdated; low: better with it */
  level: 'high' | 'medium' | 'low';
  /** whose data it is: the member's own pages or the group's shared ones (statistics, market) */
  scope: 'me' | 'group';
  /** time of the newest sync of this page, null when there is none */
  time: number | null;
  /** buildings: planets without a buildings page; galaxy: outdated systems around the own planets */
  count?: number;
  /** of how many (planets, systems) */
  total?: number;
  /** stats: the statistics update that is missing and its categories (1 total … 5 defense) */
  update?: number;
  types?: number[];
}

const HOUR = 3600;
const DAY = 24 * HOUR;
/** Statistics: the game needs a few minutes for an update, a hint right at 18:00 would be noise. */
const STATS_GRACE = 10 * 60;
/** Galaxy: systems around each own planet (± this many) and when they count as outdated. */
const GALAXY_AROUND = 2;
const GALAXY_STALE = 3 * DAY;
const MARKET_STALE = 3 * DAY;
const LEVELS = { high: 0, medium: 1, low: 2 };

/**
 * The game's statistics update at or before `t` by the default grid: 0, 6, 12 and 18 o'clock in the universe's time
 * zone. Only the fallback without any synced update: servers run the update at their own configured hours, and one
 * whose clock ignores daylight saving moves by an hour against local time in winter (see `expectedStatUpdate`).
 */
export function lastStatUpdate(t: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(t * 1000))
      .map((p) => [p.type, p.value]),
  );
  const hour = String(Math.floor(Number(parts.hour) / 6) * 6).padStart(2, '0');
  const at = localToEpoch(`${parts.year}-${parts.month}-${parts.day} ${hour}:00:00`, timeZone, t);
  // a repeated hour in autumn may give the later instant: the update before then
  return at > t ? lastStatUpdate(t - HOUR, timeZone) : at;
}

/** Interval of the game's statistics updates. */
const STAT_INTERVAL = 6 * HOUR;

/**
 * The game's latest statistics update at or before `t`: on the 6-hour grid of the newest synced update (the server's
 * own hours, also across a daylight saving switch), or the default grid without one.
 */
export function expectedStatUpdate(t: number, newestSynced: number | null, timeZone: string): number {
  if (newestSynced == null) return lastStatUpdate(t, timeZone);
  if (newestSynced >= t) return newestSynced;
  // the update time of a page may lie a few minutes after the grid point: keep the phase of the full hour
  const anchor = Math.round(newestSynced / HOUR) * HOUR;
  return anchor + Math.floor((t - anchor) / STAT_INTERVAL) * STAT_INTERVAL;
}

/**
 * What the member should paste next: own pages that are missing or old, and the group's statistics and market rate.
 * Most important first; an empty list means the hub is up to date.
 */
export function syncHints(db: DB, ctx: GroupContext): SyncHint[] {
  const t = ctx.now;
  const me = ctx.user.id;
  const g = ctx.groupId;
  const hints: SyncHint[] = [];
  const max = (sql: string, ...args: unknown[]) => (db.prepare(sql).pluck().get(...args) as number | null) ?? null;

  // empire: planets, research and fleets of the member, the base of most pages
  const empire = latestEmpire(db, ctx, me);
  const empireTime = empire?.time ?? null;
  if (empireTime == null) hints.push({ key: 'empire', level: 'high', scope: 'me', time: null });
  else if (t - empireTime > 3 * DAY) hints.push({ key: 'empire', level: 'high', scope: 'me', time: empireTime });
  else if (t - empireTime > DAY) hints.push({ key: 'empire', level: 'medium', scope: 'me', time: empireTime });

  // statistics of the group: the newest update per category against the game's latest update
  const newestAny = max("SELECT MAX(stat_time) FROM stat_snapshots WHERE group_id = ? AND who = 'player'", g);
  const update = expectedStatUpdate(t - STATS_GRACE, newestAny, ctx.universe.settings.timezone);
  const newest = new Map<number, number | null>(
    TYPES.map((type) => [type, max("SELECT MAX(stat_time) FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = ?", g, type)]),
  );
  const missing = TYPES.filter((type) => (newest.get(type) ?? 0) < update - TOLERANCE);
  if (missing.length) {
    const any = [...newest.values()].some((v) => v != null);
    hints.push({
      key: 'stats',
      level: !any ? 'high' : missing.includes(1) ? 'medium' : 'low',
      scope: 'group',
      time: newest.get(1) ?? null,
      update,
      types: missing,
    });
  }

  // overview or fleet page: build queues and fleet movements (raid planner, attack warnings)
  const overview = max(
    `SELECT MAX(t) FROM (SELECT MAX(page_time) AS t FROM overview_snapshots WHERE group_id = ? AND user_id = ?
       UNION ALL SELECT MAX(page_time) FROM fleet_snapshots WHERE group_id = ? AND user_id = ?)`,
    g,
    me,
    g,
    me,
  );
  if (overview == null || t - overview > DAY) hints.push({ key: 'overview', level: 'medium', scope: 'me', time: overview });
  else if (t - overview > 12 * HOUR) hints.push({ key: 'overview', level: 'low', scope: 'me', time: overview });

  if (empire) {
    // galaxy around the own planets: neighbours, moons, debris and phalanx reach
    const { systems } = ctx.universe.settings;
    const around = new Set<string>();
    for (const p of empire.rec.planets) {
      if (p.type !== 'planet') continue;
      for (let s = p.coords.s - GALAXY_AROUND; s <= p.coords.s + GALAXY_AROUND; s++) if (s >= 1 && s <= systems) around.add(`${p.coords.g}:${s}`);
    }
    if (around.size) {
      const seen = new Map(
        (
          db
            .prepare("SELECT g || ':' || s AS k, seen_at FROM galaxy_views WHERE group_id = ? AND g || ':' || s IN (SELECT value FROM json_each(?))")
            .all(g, JSON.stringify([...around])) as { k: string; seen_at: number }[]
        ).map((r) => [r.k, r.seen_at]),
      );
      const stale = [...around].filter((k) => t - (seen.get(k) ?? 0) > GALAXY_STALE);
      if (stale.length) {
        const times = [...seen.values()];
        hints.push({
          key: 'galaxy',
          level: stale.length === around.size ? 'medium' : 'low',
          scope: 'me',
          time: times.length ? Math.min(...times) : null,
          count: stale.length,
          total: around.size,
        });
      }
    }

    // buildings page per planet: exact costs, build times and the building speed
    const pages = new Set(
      (db.prepare('SELECT DISTINCT g, s, p, planet_type FROM building_snapshots WHERE group_id = ? AND user_id = ?').all(g, me) as {
        g: number;
        s: number;
        p: number;
        planet_type: string;
      }[]).map((r) => `${r.g}:${r.s}:${r.p}:${r.planet_type}`),
    );
    const without = empire.rec.planets.filter((p) => !pages.has(`${p.coords.g}:${p.coords.s}:${p.coords.p}:${p.type}`));
    if (without.length) {
      const time = max('SELECT MAX(page_time) FROM building_snapshots WHERE group_id = ? AND user_id = ?', g, me);
      hints.push({ key: 'buildings', level: 'low', scope: 'me', time, count: without.length, total: empire.rec.planets.length });
    }
  }

  // research page: exact research times and the research speed
  const research = max('SELECT MAX(page_time) FROM research_snapshots WHERE group_id = ? AND user_id = ?', g, me);
  if (research == null) hints.push({ key: 'research', level: 'low', scope: 'me', time: null });

  // messages: spy, battle, expedition and transport reports (the raw pages are kept for a limited time only)
  const messages = max("SELECT MAX(created_at) FROM raw_ingests WHERE group_id = ? AND user_id = ? AND page_type = 'messages'", g, me);
  if (messages == null || t - messages > DAY) hints.push({ key: 'messages', level: 'low', scope: 'me', time: messages });

  // market rate of the group: values in the loot settlement, the build order and the payback of upgrades
  const rate = latestMarketRate(db, g);
  if (!rate || t - rate.time > MARKET_STALE) hints.push({ key: 'market', level: 'low', scope: 'group', time: rate?.time ?? null });

  return hints.sort((a, b) => LEVELS[a.level] - LEVELS[b.level]);
}

