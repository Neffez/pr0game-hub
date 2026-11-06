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
 * proof of activity or a relevant points gain within 12, 24 and 72 hours, per score band; within a day it is a false
 * alarm (the player was not inactive when scored), later the player may simply have come back.
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
  falseAlarms: FalseAlarms;
  /**
   * an ended universe: samples whose 3 days of follow-up reach into its last `END_PHASE_DAYS` days, counted apart
   * (players come back to spend before a universe closes); null for a running universe
   */
  endPhase: (FalseAlarmSummary & { ended: number }) | null;
}

/** Disproving activity by how soon after the high score it came. */
export const HORIZONS = [12, 24, 72] as const;
const BANDS = [
  { band: '50-69', min: 50, max: 69 },
  { band: '70-84', min: 70, max: 84 },
  { band: '85+', min: 85, max: 100 },
] as const;
const END_PHASE_DAYS = 7;

export interface FalseAlarmSummary {
  /** days sampled and scores of at least "likely" among them (player-days) */
  days: number;
  positives: number;
  /** players with such a score on some sampled day */
  players: number;
  /** per horizon: player-days and players with proof of activity or a relevant gain within that many hours */
  horizons: { hours: number; contradicted: number; players: number; rate: number | null }[];
  /** per score band: player-days and how many were disproved within each horizon (hours → count) */
  bands: { band: string; positives: number; within: Record<number, number> }[];
}

export interface FalseAlarmExample {
  playerId: number;
  name: string;
  time: number;
  score: number;
  /** the earliest horizon within which activity showed, and when (the time of the cause) */
  hours: number;
  activeAt: number;
  cause: 'gain' | ProofSource;
  /** for a gain: points, share of the median gain around the rank, and the categories that grew (2 fleet … 5 defense) */
  gain: { size: number | null; ratio: number | null; categories: Record<number, number> } | null;
}

export interface FalseAlarms extends FalseAlarmSummary {
  /** the 24-hour horizon: a player active within a day was not inactive when scored */
  rate: number | null;
  /** contradictions within 72 hours by what disproved them first: `gain` or the kind of proof */
  causes: Record<string, number>;
  examples: FalseAlarmExample[];
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
const FOLLOW = HORIZONS[HORIZONS.length - 1] * 3600;

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

  // false alarms: once a day at a statistics update; for each high score, the earliest horizon within which the score
  // as of then knows newer activity (proof or a relevant gain)
  const playerNames = new Map((db.prepare('SELECT id, name FROM players WHERE group_id = ?').all(g) as { id: number; name: string }[]).map((p) => [p.id, p.name]));
  const ended = ctx.universe.endedAt != null && ctx.universe.endedAt <= now ? ctx.universe.endedAt : null;
  type Sample = { id: number; t: number; score: number; hours: number | null; end: boolean; example: Omit<FalseAlarmExample, 'name' | 'gain'> | null; gainAt: number | null };
  const samples: Sample[] = [];
  const sampledDays = { normal: 0, end: 0 };
  const seen = new Set<number>();
  for (let d = SAMPLE_DAYS; d >= 0; d--) {
    const t = at(now - d * DAY - FOLLOW);
    if (t == null || t + FOLLOW > now || seen.has(t)) continue;
    seen.add(t);
    const end = ended != null && t + FOLLOW > ended - END_PHASE_DAYS * DAY;
    sampledDays[end ? 'end' : 'normal']++;
    const before = await scores(t);
    const later: typeof before[] = [];
    for (const h of HORIZONS) later.push(await scores(t + h * HOUR));
    for (const [id, v] of before) {
      if (v.status || v.score < 50) continue;
      let hours: number | null = null;
      let example: Sample['example'] = null;
      let gainAt: number | null = null;
      for (const [k, h] of HORIZONS.entries()) {
        const next = later[k].get(id);
        const proof = next?.lastActive != null && next.lastActive > t ? next.lastActive : null;
        const gain = next?.stall != null && next.stall > t ? next.stall : null;
        if (proof == null && gain == null) continue;
        hours = h;
        // the earlier of the two is the activity that disproved the score first
        const byProof = proof != null && (gain == null || proof <= gain);
        const source = next!.reasons.find((r) => r.code === 'proven');
        const cause = byProof && source?.code === 'proven' ? source.source : 'gain';
        gainAt = cause === 'gain' ? gain : null;
        example = { playerId: id, time: t, score: v.score, hours: h, activeAt: (byProof ? proof : gain)!, cause };
        break;
      }
      samples.push({ id, t, score: v.score, hours, end, example, gainAt });
    }
  }

  const summarize = (list: Sample[], days: number): FalseAlarmSummary => ({
    days,
    positives: list.length,
    players: new Set(list.map((x) => x.id)).size,
    horizons: HORIZONS.map((h) => {
      const hit = list.filter((x) => x.hours != null && x.hours <= h);
      return { hours: h, contradicted: hit.length, players: new Set(hit.map((x) => x.id)).size, rate: list.length ? hit.length / list.length : null };
    }),
    bands: BANDS.map((b) => {
      const inBand = list.filter((x) => x.score >= b.min && x.score <= b.max);
      return { band: b.band, positives: inBand.length, within: Object.fromEntries(HORIZONS.map((h) => [h, inBand.filter((x) => x.hours != null && x.hours <= h).length])) };
    }),
  });
  /** points per category of a player at a statistics update against their update before (only those that grew) */
  const grew = (playerId: number, time: number): Record<number, number> => {
    const rows = db
      .prepare(
        `SELECT ps.type, ps.points, (SELECT p2.points FROM player_scores p2 WHERE p2.player_id = ps.player_id AND p2.type = ps.type AND p2.stat_time < ps.stat_time
           ORDER BY p2.stat_time DESC LIMIT 1) AS before
         FROM player_scores ps JOIN players p ON p.id = ps.player_id WHERE p.group_id = ? AND ps.player_id = ? AND ps.type IN (2, 3, 4, 5) AND ps.stat_time = ?`,
      )
      .all(g, playerId, time) as { type: number; points: number; before: number | null }[];
    return Object.fromEntries(rows.filter((r) => r.before != null && r.points > r.before).map((r) => [r.type, r.points - r.before!]));
  };
  const normal = samples.filter((x) => !x.end);
  const base = summarize(normal, sampledDays.normal);
  const causes: Record<string, number> = {};
  for (const x of normal) if (x.example) causes[x.example.cause] = (causes[x.example.cause] ?? 0) + 1;
  const examples: FalseAlarmExample[] = normal
    .filter((x) => x.example)
    .sort((a, b) => a.hours! - b.hours! || b.score - a.score)
    .slice(0, 15)
    .map((x) => ({ ...x.example!, name: playerNames.get(x.id) ?? '?', gain: x.gainAt != null ? gainDetail(x.id, x.t, x.example!.hours, x.gainAt) : null }));
  function gainDetail(id: number, t: number, hours: number, time: number): FalseAlarmExample['gain'] {
    const r = inactivities(db, ctx, [id], t + hours * HOUR).get(id)?.reasons.find((x) => x.code === 'gain');
    return { size: r?.code === 'gain' ? (r.size ?? null) : null, ratio: r?.code === 'gain' ? (r.ratio ?? null) : null, categories: grew(id, time) };
  }
  const h24 = base.horizons.find((h) => h.hours === 24)!;
  const endSamples = samples.filter((x) => x.end);

  return {
    generatedAt: now,
    weights: INACTIVITY,
    events: used.length,
    skipped,
    narrowed: used.filter((e) => e.narrowed).length,
    detection,
    falseAlarms: { ...base, rate: h24.rate, causes, examples },
    endPhase: ended != null ? { ...summarize(endSamples, sampledDays.end), ended } : null,
  };
}
