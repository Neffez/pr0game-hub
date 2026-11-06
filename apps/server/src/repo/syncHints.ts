import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { TYPES } from '../domain/stats.js';
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
  /** stats: the update that is missing (`estimated`: expected after the learned `interval`, not synced by anyone yet) */
  update?: number;
  estimated?: boolean;
  interval?: number;
  /** stats: categories (1 total … 5 defense) without that update; empty: just outdated */
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

/** Updates within this many seconds are one (several pages of the same update, page times a few minutes off). */
const SAME_UPDATE = 15 * 60;
/** Gaps shorter than this are no schedule (pages of one update pasted separately). */
const MIN_INTERVAL = 30 * 60;
/** Without a known interval, statistics older than this count as outdated. */
const STATS_STALE = DAY;

/**
 * Interval of the game's statistics updates, learned from the synced ones: the shortest gap between two synced updates
 * that occurs at least twice (within `SAME_UPDATE`). Missed syncs only make gaps longer (multiples), a single short gap
 * may be an update off the schedule. The hub never assumes fixed hours or a fixed interval: servers configure them,
 * and their clock may ignore daylight saving. Null while the history doesn't tell.
 */
export function statInterval(updates: number[]): number | null {
  const times = [...new Set(updates)].sort((a, b) => a - b);
  const distinct: number[] = [];
  for (const t of times) if (!distinct.length || t - distinct[distinct.length - 1] > SAME_UPDATE) distinct.push(t);
  const gaps = distinct.slice(1).map((t, i) => t - distinct[i]).filter((g) => g >= MIN_INTERVAL).sort((a, b) => a - b);
  for (let i = 0; i < gaps.length; i++) {
    const twice = gaps.filter((g) => Math.abs(g - gaps[i]) <= SAME_UPDATE);
    if (twice.length >= 2) return Math.round(twice.reduce((a, b) => a + b, 0) / twice.length / 60) * 60;
  }
  return null;
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

  // statistics of the group: every category should have the newest synced update; a newer one is expected after the
  // interval learned from the synced updates (never from fixed hours)
  const newest = new Map<number, number | null>(
    TYPES.map((type) => [type, max("SELECT MAX(stat_time) FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = ?", g, type)]),
  );
  const newestAny = Math.max(0, ...[...newest.values()].map((v) => v ?? 0)) || null;
  if (newestAny == null) {
    hints.push({ key: 'stats', level: 'high', scope: 'group', time: null, types: [...TYPES] });
  } else {
    const interval = statInterval(
      db
        .prepare("SELECT DISTINCT stat_time FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND stat_time >= ?")
        .pluck()
        .all(g, newestAny - 14 * DAY) as number[],
    );
    const next = interval != null ? newestAny + interval : null;
    if (next != null && t - STATS_GRACE >= next) {
      // a newer update than any synced one is due: estimated from the interval
      hints.push({ key: 'stats', level: 'medium', scope: 'group', time: newestAny, update: next, estimated: true, interval: interval ?? undefined, types: [...TYPES] });
    } else {
      const missing = TYPES.filter((type) => (newest.get(type) ?? 0) < newestAny - SAME_UPDATE);
      if (missing.length) {
        // known for sure: the newest synced update lacks these categories
        hints.push({ key: 'stats', level: missing.includes(1) ? 'medium' : 'low', scope: 'group', time: newest.get(1) ?? null, update: newestAny, estimated: false, types: missing });
      } else if (interval == null && t - newestAny > STATS_STALE) {
        hints.push({ key: 'stats', level: 'medium', scope: 'group', time: newestAny, types: [] });
      }
    }
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

