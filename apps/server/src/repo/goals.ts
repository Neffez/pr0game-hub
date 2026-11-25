import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { TYPES } from '../domain/stats.js';
import { memberPlayers } from './members.js';
import { freshnessOf } from './freshness.js';
import { SAME_UPDATE, statInterval } from './syncHints.js';

/**
 * Alliance goals: shared targets for the group's syncing, each with its progress now. The group's admins set the
 * targets (stored in `groups.goals`, missing values take the defaults) or switch a goal off.
 */
export type GoalKey = 'galaxy' | 'stats' | 'freshness' | 'spy';
export const GOAL_KEYS: GoalKey[] = ['galaxy', 'stats', 'freshness', 'spy'];

export interface GoalSetting {
  on: boolean;
  /** percent */
  target: number;
  /** galaxy: systems synced within this many days count */
  days?: number;
}
export type GoalSettings = Record<GoalKey, GoalSetting>;

export const GOAL_DEFAULTS: GoalSettings = {
  galaxy: { on: true, target: 50, days: 7 },
  stats: { on: true, target: 90 },
  freshness: { on: true, target: 75 },
  spy: { on: true, target: 50 },
};

export interface Goal {
  key: GoalKey;
  target: number;
  /** progress in percent (0–100), null while it can't be told (e.g. no learned statistics interval yet) */
  value: number | null;
  /** what is counted: systems, statistics updates, members at the target, worthwhile players */
  done: number | null;
  total: number | null;
  /** galaxy: the time window */
  days?: number;
}

const DAY = 86400;
/** Statistics and spy reports are counted over this window. */
const WEEK = 7 * DAY;
/** A spy report younger than this counts as fresh. */
const SPY_FRESH = DAY;
/** Spy goal: players up to this rank in fleet or total points are worthwhile. */
const SPY_TOP_RANK = 50;
/** Spy goal: players whose fleet points reach this share of the alliance's average fleet are worthwhile. */
const SPY_FLEET_SHARE = 0.2;
/** Spy goal: statistics older than this are not used. */
const SPY_STATS_AGE = 2 * WEEK;

export function goalSettings(db: DB, groupId: number): GoalSettings {
  const raw = db.prepare('SELECT goals FROM groups WHERE id = ?').pluck().get(groupId) as string | null | undefined;
  let stored: Partial<Record<GoalKey, Partial<GoalSetting>>> = {};
  try {
    stored = raw ? JSON.parse(raw) : {};
  } catch {
    stored = {};
  }
  return Object.fromEntries(GOAL_KEYS.map((k) => [k, { ...GOAL_DEFAULTS[k], ...stored[k] }])) as GoalSettings;
}

/** Settings from a request body on top of the current ones; null when a value is out of range. */
export function parseGoalSettings(current: GoalSettings, body: unknown): GoalSettings | null {
  if (!body || typeof body !== 'object') return null;
  const out = structuredClone(current);
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!GOAL_KEYS.includes(k as GoalKey)) return null;
    if (!v || typeof v !== 'object') return null;
    const x = v as Record<string, unknown>;
    const s = out[k as GoalKey];
    if (x.on !== undefined) {
      if (typeof x.on !== 'boolean') return null;
      s.on = x.on;
    }
    if (x.target !== undefined) {
      if (!Number.isInteger(x.target) || (x.target as number) < 1 || (x.target as number) > 100) return null;
      s.target = x.target as number;
    }
    if (x.days !== undefined) {
      if (k !== 'galaxy' || !Number.isInteger(x.days) || (x.days as number) < 1 || (x.days as number) > 30) return null;
      s.days = x.days as number;
    }
  }
  return out;
}

const percent = (done: number, total: number) => (total ? Math.min(100, Math.round((done / total) * 100)) : null);

/** The group's switched-on goals with their progress now. */
export function allianceGoals(db: DB, ctx: GroupContext): Goal[] {
  const settings = goalSettings(db, ctx.groupId);
  const g = ctx.groupId;
  const t = ctx.now;
  const goals: Goal[] = [];

  if (settings.galaxy.on) {
    const days = settings.galaxy.days ?? GOAL_DEFAULTS.galaxy.days!;
    const total = ctx.universe.settings.galaxies * ctx.universe.settings.systems;
    const done = db.prepare('SELECT COUNT(*) FROM galaxy_views WHERE group_id = ? AND seen_at >= ?').pluck().get(g, t - days * DAY) as number;
    goals.push({ key: 'galaxy', target: settings.galaxy.target, value: percent(done, total), done, total, days });
  }

  if (settings.stats.on) {
    // the updates of the last week the learned interval expects, against those with every category synced
    const rows = db
      .prepare("SELECT stat_time, type FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND stat_time >= ? ORDER BY stat_time")
      .all(g, t - 2 * WEEK) as { stat_time: number; type: number }[];
    const interval = statInterval(rows.map((r) => r.stat_time));
    const updates: { time: number; types: Set<number> }[] = [];
    for (const r of rows) {
      const last = updates[updates.length - 1];
      if (last && r.stat_time - last.time <= SAME_UPDATE) last.types.add(r.type);
      else updates.push({ time: r.stat_time, types: new Set([r.type]) });
    }
    const complete = updates.filter((u) => u.time >= t - WEEK && TYPES.every((type) => u.types.has(type))).length;
    const total = interval ? Math.max(1, Math.floor(WEEK / interval)) : null;
    goals.push({ key: 'stats', target: settings.stats.target, value: total ? percent(Math.min(complete, total), total) : null, done: total ? Math.min(complete, total) : null, total });
  }

  if (settings.freshness.on) {
    const scores = [...freshnessOf(db, ctx).values()].map((f) => f.score);
    const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    goals.push({
      key: 'freshness', target: settings.freshness.target, value: average,
      done: scores.filter((s) => s >= settings.freshness.target).length, total: scores.length,
    });
  }

  if (settings.spy.on) {
    const targets = spyGoalPlayers(db, ctx);
    const spied = new Set(
      db.prepare('SELECT DISTINCT player_id FROM spy_reports WHERE group_id = ? AND report_time >= ? AND player_id IS NOT NULL').pluck().all(g, t - SPY_FRESH) as number[],
    );
    const done = targets.filter((id) => spied.has(id)).length;
    goals.push({ key: 'spy', target: settings.spy.target, value: percent(done, targets.length), done, total: targets.length });
  }
  return goals;
}

/**
 * The spy goal's worthwhile players outside the alliance, from each player's newest statistics: the top fleets and
 * total points (rank up to `SPY_TOP_RANK`) and every fleet of at least `SPY_FLEET_SHARE` of the alliance's average
 * fleet points. Players in vacation mode or banned are left out (they can't be attacked). The alliance is the
 * group's (its members' players and their in-game alliances), not the viewer's, so every member and the Discord
 * recap count the same.
 */
function spyGoalPlayers(db: DB, ctx: GroupContext): number[] {
  const g = ctx.groupId;
  const rows = db
    .prepare(
      `SELECT ps.player_id AS id, ps.type, ps.points, ps.rank, MAX(ps.stat_time) AS time
       FROM stat_snapshots s JOIN player_scores ps ON ps.snapshot_id = s.id
       WHERE s.group_id = ? AND s.who = 'player' AND s.type IN (1, 2) AND s.stat_time >= ? GROUP BY ps.player_id, ps.type`,
    )
    .all(g, ctx.now - SPY_STATS_AGE) as { id: number; type: number; points: number; rank: number }[];
  const scores = new Map<number, { total?: { points: number; rank: number }; fleet?: { points: number; rank: number } }>();
  for (const r of rows) scores.set(r.id, { ...scores.get(r.id), [r.type === 1 ? 'total' : 'fleet']: { points: r.points, rank: r.rank } });

  const members = new Set([...memberPlayers(db, ctx).values()].filter((id): id is number => id != null));
  const memberFleets = [...members].map((id) => scores.get(id)?.fleet?.points).filter((p): p is number => p != null);
  const average = memberFleets.length ? memberFleets.reduce((a, b) => a + b, 0) / memberFleets.length : null;
  const minFleet = average != null ? Math.max(1, average * SPY_FLEET_SHARE) : null;

  const ids = [...scores.keys()];
  const players = ids.length
    ? (db.prepare('SELECT p.id, p.alliance_id, p.status FROM json_each(?) id JOIN players p ON p.id = id.value AND p.group_id = ?').all(JSON.stringify(ids), g) as {
        id: number; alliance_id: number | null; status: string;
      }[])
    : [];
  const allies = new Set(
    [...members].map((id) => db.prepare('SELECT alliance_id FROM players WHERE id = ? AND group_id = ?').pluck().get(id, g) as number | null).filter((a) => a != null),
  );
  return players
    .filter((p) => {
      if (members.has(p.id) || (p.alliance_id != null && allies.has(p.alliance_id))) return false;
      const status = JSON.parse(p.status || '[]') as string[];
      if (status.includes('vacation') || status.includes('banned')) return false;
      const s = scores.get(p.id)!;
      return (s.total != null && s.total.rank <= SPY_TOP_RANK) || (s.fleet != null && s.fleet.rank <= SPY_TOP_RANK) || (minFleet != null && (s.fleet?.points ?? 0) >= minFleet);
    })
    .map((p) => p.id);
}
