import { inactiveDaysOf } from '../config.js';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { INACTIVITY, inactivities, namesOf, provenActivity, type ProofSource } from './inactivity.js';

/**
 * Check of the inactivity score against the game's own flag, on the group's data (admin panel): a player the game
 * flags `inactive` was last online `inactiveDays` before the flag appeared. From the status history the hub knows
 * when that was (between the last sighting without the flag and the first with it), so it can replay the score as it
 * would have been some hours after that last login (only data up to then counts) and see whether it caught the
 * player. The other way round, it samples the score once a day and counts how often a high score was followed by
 * proof of activity or a relevant points gain within three days (a false alarm).
 */
export interface InactivityCheck {
  generatedAt: number;
  weights: typeof INACTIVITY;
  /**
   * flag events used and skipped: the last login lies between the last sighting without the flag (or the newest proof
   * of activity before, if later) and the first with it, minus the inactive days; used when that is known within 2 days
   */
  events: number;
  skipped: number;
  /** of the used events: how many a proof of activity narrowed down */
  narrowed: number;
  /** per hours after the last login: players evaluated, share at least likely, share inactive, median score */
  detection: { hours: number; n: number; likely: number; inactive: number; median: number | null }[];
  falseAlarms: {
    /** days sampled and scores of at least "likely" among them */
    days: number;
    positives: number;
    /** of those: proof of activity or a relevant gain within the next 3 days */
    contradicted: number;
    rate: number | null;
    /** the same counted per player (a player scored high on several days counts once) */
    players: number;
    playersContradicted: number;
    /** contradictions by what disproved them: `gain` or the kind of proof */
    causes: Record<string, number>;
    examples: { playerId: number; name: string; time: number; score: number; activeAt: number; cause: 'gain' | ProofSource }[];
  };
}

const HOUR = 3600;
const DAY = 24 * HOUR;
const OFFSETS = [12, 24, 48, 72, 120];
/** events within this many days, at most `MAX_EVENTS` of them (newest first) */
const EVENT_DAYS = 45;
const MAX_EVENTS = 40;
/** the last login must be known within this window; the sightings around the flag may lie `MAX_SIGHTING_GAP` apart */
const MAX_GAP = 2 * DAY;
const MAX_SIGHTING_GAP = 7 * DAY;
const SAMPLE_DAYS = 30;
const FOLLOW = 3 * DAY;

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const pause = () => new Promise<void>((resolve) => setImmediate(resolve));

const cache = new Map<number, { at: number; report: InactivityCheck }>();
const CACHE_SECONDS = 15 * 60;

export async function inactivityCheck(db: DB, ctx: GroupContext, fresh = false): Promise<InactivityCheck> {
  const hit = cache.get(ctx.groupId);
  if (!fresh && hit && ctx.now - hit.at < CACHE_SECONDS) return hit.report;
  const report = await run(db, ctx);
  cache.set(ctx.groupId, { at: ctx.now, report });
  return report;
}

async function run(db: DB, ctx: GroupContext): Promise<InactivityCheck> {
  const g = ctx.groupId;
  const now = ctx.now;
  const days = inactiveDaysOf(ctx.universe.settings);
  // statistics updates: the score is replayed at them (the newest one at or before the time asked)
  const updates = db
    .prepare("SELECT DISTINCT stat_time FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND type = 1 AND stat_time >= ? ORDER BY stat_time")
    .pluck()
    .all(g, now - (EVENT_DAYS + 2 * days + 7) * DAY) as number[];
  const at = (t: number) => {
    let best: number | null = null;
    for (const u of updates) if (u <= t) best = u;
    return best;
  };
  const scores = async (t: number) => {
    const res = inactivities(db, ctx, undefined, t);
    await pause();
    return res;
  };

  // flag events: the first sighting with the flag after one without
  const log = db
    .prepare(
      `SELECT l.player_id, l.status, l.seen_at FROM player_status_log l JOIN players p ON p.id = l.player_id
       WHERE p.group_id = ? AND l.seen_at >= ? ORDER BY l.player_id, l.seen_at`,
    )
    .all(g, now - (EVENT_DAYS + 30) * DAY) as { player_id: number; status: string; seen_at: number }[];
  const events: { playerId: number; lastLogin: number; flagSeen: number; narrowed: boolean }[] = [];
  const names = namesOf(db, g);
  let skipped = 0;
  for (let i = 1; i < log.length; i++) {
    const a = log[i - 1];
    const b = log[i];
    if (a.player_id !== b.player_id || /inactive/.test(a.status) || !/inactive/.test(b.status) || b.seen_at < now - EVENT_DAYS * DAY) continue;
    if (b.seen_at - a.seen_at > MAX_SIGHTING_GAP) {
      skipped++;
      continue;
    }
    // the last login lies in [lo, hi]: the flag appeared between the two sightings, and a proof of activity before
    // the latest possible login moves the earliest one up
    const hi = b.seen_at - days * DAY;
    let lo = a.seen_at - days * DAY;
    const proof = provenActivity(db, ctx, names, hi - 2 * days * DAY, hi).get(b.player_id);
    const narrowed = !!proof && proof.time > lo;
    if (narrowed) lo = proof!.time;
    if (hi - lo > MAX_GAP) {
      skipped++;
      continue;
    }
    events.push({ playerId: b.player_id, lastLogin: (lo + hi) / 2, flagSeen: b.seen_at, narrowed });
  }
  events.sort((x, y) => y.flagSeen - x.flagSeen);
  skipped += Math.max(0, events.length - MAX_EVENTS);
  const used = events.slice(0, MAX_EVENTS);

  const detection: InactivityCheck['detection'] = [];
  for (const hours of OFFSETS) {
    const found: number[] = [];
    for (const e of used) {
      const t = at(e.lastLogin + hours * HOUR);
      // replay only before the flag and after the login (the update must be later than the login)
      if (t == null || t <= e.lastLogin || t >= e.flagSeen) continue;
      const v = (await scores(t)).get(e.playerId);
      if (v && v.level !== 'unknown') found.push(v.score);
    }
    detection.push({
      hours,
      n: found.length,
      likely: found.length ? found.filter((s) => s >= 50).length / found.length : 0,
      inactive: found.length ? found.filter((s) => s >= 85).length / found.length : 0,
      median: median(found),
    });
  }

  // false alarms: once a day; contradicted when the score three days later knows newer activity
  const playerNames = new Map((db.prepare('SELECT id, name FROM players WHERE group_id = ?').all(g) as { id: number; name: string }[]).map((p) => [p.id, p.name]));
  let positives = 0;
  let contradicted = 0;
  const positivePlayers = new Set<number>();
  const contradictedPlayers = new Set<number>();
  const causes: Record<string, number> = {};
  let sampled = 0;
  const examples: InactivityCheck['falseAlarms']['examples'] = [];
  const seen = new Set<number>();
  for (let d = SAMPLE_DAYS; d >= 0; d--) {
    const t = at(now - d * DAY - FOLLOW);
    const later = t == null ? null : at(t + FOLLOW);
    if (t == null || later == null || later <= t || seen.has(t)) continue;
    seen.add(t);
    sampled++;
    const before = await scores(t);
    const after = await scores(later);
    for (const [id, v] of before) {
      if (v.status || v.score < 50) continue;
      positives++;
      positivePlayers.add(id);
      const next = after.get(id);
      const activeAt = Math.max(next?.lastActive ?? 0, next?.stall ?? 0);
      if (activeAt > t) {
        contradicted++;
        contradictedPlayers.add(id);
        const proof = next?.lastActive != null && next.lastActive > t ? next.reasons.find((r) => r.code === 'proven') : undefined;
        const cause = proof && proof.code === 'proven' ? proof.source : 'gain';
        causes[cause] = (causes[cause] ?? 0) + 1;
        if (examples.length < 15) examples.push({ playerId: id, name: playerNames.get(id) ?? '?', time: t, score: v.score, activeAt, cause });
      }
    }
  }
  return {
    generatedAt: now,
    weights: INACTIVITY,
    events: used.length,
    skipped,
    narrowed: used.filter((e) => e.narrowed).length,
    detection,
    falseAlarms: {
      days: sampled,
      positives,
      contradicted,
      rate: positives ? contradicted / positives : null,
      players: positivePlayers.size,
      playersContradicted: contradictedPlayers.size,
      causes,
      examples,
    },
  };
}
