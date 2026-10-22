import { parsePage, type CombatReportRecord } from '@pr0hub/core';
import { config } from './config.js';
import type { DB } from './db.js';
import { storeCombatReport } from './store.js';

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/** Pauses after consecutive transient failures (game unreachable, maintenance), in minutes. */
const BACKOFF_MIN = [1, 2, 5, 15, 30, 60];
const MAX_TRIES = 3;

type UniverseState = { failures: number; failingSince: number; nextAttempt: number; stopped: boolean; lastError: string };

/**
 * Worker state per universe (in memory, a restart resumes): while a universe's game is unreachable
 * the worker pauses it with growing delays instead of spending the reports' tries, and stops it after
 * config.crawler.giveUpHours; the other universes keep going. The admin "retry" resumes all.
 */
export const crawlerState = new Map<number, UniverseState>();

export function resumeCrawler(db: DB) {
  crawlerState.clear();
  // failed reports get new tries; deleted ones ("gone") stay deleted
  return db.prepare('UPDATE battle_hall SET report_tries = 0 WHERE report_status IS NULL AND report_tries >= ?').run(MAX_TRIES).changes;
}

function pause(universe: number, reason: string, log: Log) {
  const now = Date.now();
  const s = crawlerState.get(universe) ?? { failures: 0, failingSince: now, nextAttempt: 0, stopped: false, lastError: '' };
  s.nextAttempt = now + BACKOFF_MIN[Math.min(s.failures, BACKOFF_MIN.length - 1)] * 60_000;
  s.failures++;
  s.lastError = reason;
  if (now - s.failingSince > config.crawler.giveUpHours * 3600_000) {
    s.stopped = true;
    log.warn({ universe, since: new Date(s.failingSince).toISOString() }, 'battle report crawler stopped for universe: game unreachable');
  }
  crawlerState.set(universe, s);
}

/**
 * Background worker: archives battle hall reports from the public report pages, one request at a
 * time (config.crawler.intervalMs apart). Reports the game already deleted are marked "gone", reports
 * of attackers shot down in the first round (the game shows no report) "lost".
 */
export function startCrawler(db: DB, log: Log) {
  if (!config.crawler.enabled) return () => {};
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await step(db, log);
    } finally {
      busy = false;
    }
  }, config.crawler.intervalMs);
  return () => clearInterval(timer);
}

/**
 * One report: 'done' (archived/deleted/failed attempt), 'idle' (nothing to do) or 'transient'
 * (game unreachable, its universe is paused).
 */
export async function step(db: DB, log: Log, fetcher = fetch): Promise<'done' | 'idle' | 'transient'> {
  // newest first: small reports of today are the ones the game deletes soonest;
  // universes without game URL are skipped until it is set, paused ones until their next attempt
  const now = Date.now();
  const paused = [...crawlerState].filter(([, s]) => s.stopped || s.nextAttempt > now).map(([id]) => id);
  const job = db
    .prepare(
      `SELECT h.group_id, h.report_id, h.time, u.id AS universe, u.settings FROM battle_hall h
       JOIN groups g ON g.id = h.group_id JOIN universes u ON u.id = g.universe_id
       WHERE h.report_status IS NULL AND h.report_tries < ${MAX_TRIES}
         AND COALESCE(json_extract(u.settings, '$.gameUrl'), '') != ''
         AND u.id NOT IN (SELECT value FROM json_each(?))
         AND NOT EXISTS (SELECT 1 FROM combat_reports c WHERE c.group_id = h.group_id AND c.report_id = h.report_id)
       ORDER BY h.time DESC LIMIT 1`,
    )
    .get(JSON.stringify(paused)) as { group_id: number; report_id: string; time: number | null; universe: number; settings: string } | undefined;
  if (!job) return 'idle';
  const gameUrl = String(JSON.parse(job.settings).gameUrl).replace(/\/?$/, '/');
  // the same report in the hall of several alliances of the universe: fetched once, stored for each
  const halls = db
    .prepare('SELECT h.group_id, h.time FROM battle_hall h JOIN groups g ON g.id = h.group_id WHERE g.universe_id = ? AND h.report_id = ?')
    .all(job.universe, job.report_id) as { group_id: number; time: number | null }[];
  const mark = (status: string | null) => {
    for (const h of halls) {
      db.prepare('UPDATE battle_hall SET report_status = ?, report_tries = report_tries + 1 WHERE group_id = ? AND report_id = ?').run(
        status, h.group_id, job.report_id,
      );
    }
  };
  const url = `${gameUrl}game.php?page=raport&raport=${job.report_id}`;
  const transient = (reason: string) => {
    pause(job.universe, reason, log);
    log.warn({ universe: job.universe, report: job.report_id, reason }, 'battle report fetch failed, pausing universe');
    return 'transient' as const;
  };
  let html: string;
  try {
    const res = await fetcher(url, { headers: { 'user-agent': 'pr0game-hub battle report archive' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return transient(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return transient((e as Error).message);
  }
  // the game answered with a report page: its universe is reachable again
  const done = () => (crawlerState.delete(job.universe), 'done' as const);
  const parsed = parsePage({ html, url }).records[0] as CombatReportRecord | undefined;
  if (parsed?.kind === 'combatReport') {
    // the hall time is the local game time; the public page shows UTC
    db.transaction(() => {
      for (const h of halls) storeCombatReport(db, h.group_id, parsed, h.time);
    })();
    log.info({ report: job.report_id }, 'battle report archived');
    return done();
  }
  if (/Invalid Battle Report ID|Ungültige Kampfbericht ID/i.test(html)) {
    mark('gone');
    return done();
  }
  // the attacker was shot down in the first round: the game shows no report, only this notice
  if (/Contact with the attacking fleet was lost|Kontakt zur angreifenden Flotte/i.test(html)) {
    mark('lost');
    return done();
  }
  // a report page that can't be read costs a try; anything else (maintenance page, login, …) pauses
  if (/<title>[^<]*(report|Kampfbericht)/i.test(html)) {
    mark(null);
    return done();
  }
  return transient('no report page (maintenance?)');
}
