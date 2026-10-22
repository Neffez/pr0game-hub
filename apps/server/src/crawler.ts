import { parsePage, type CombatReportRecord } from '@pr0hub/core';
import { config } from './config.js';
import type { DB } from './db.js';
import { storeCombatReport } from './ingest.js';

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/** Pauses after consecutive transient failures (game unreachable, maintenance), in minutes. */
const BACKOFF_MIN = [1, 2, 5, 15, 30, 60];
const MAX_TRIES = 3;

/**
 * Worker state (in memory, a restart resumes): while the game is unreachable the worker pauses
 * with growing delays instead of spending the reports' tries, and stops after
 * config.crawler.giveUpHours. The admin "retry" resumes it.
 */
export const crawlerState = {
  failures: 0,
  failingSince: null as number | null,
  nextAttempt: 0,
  stopped: false,
  lastError: null as string | null,
};

export function resumeCrawler(db: DB) {
  Object.assign(crawlerState, { failures: 0, failingSince: null, nextAttempt: 0, stopped: false, lastError: null });
  // failed reports get new tries; deleted ones ("gone") stay deleted
  return db.prepare('UPDATE battle_hall SET report_tries = 0 WHERE report_status IS NULL AND report_tries >= ?').run(MAX_TRIES).changes;
}

/**
 * Background worker: archives battle hall reports from the public report pages, one request at a
 * time (config.crawler.intervalMs apart). Reports the game already deleted are marked "gone".
 */
export function startCrawler(db: DB, log: Log) {
  if (!config.crawler.enabled) return () => {};
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || crawlerState.stopped || Date.now() < crawlerState.nextAttempt) return;
    busy = true;
    try {
      const result = await step(db, log);
      if (result === 'transient') {
        const now = Date.now();
        crawlerState.failingSince ??= now;
        crawlerState.nextAttempt = now + BACKOFF_MIN[Math.min(crawlerState.failures, BACKOFF_MIN.length - 1)] * 60_000;
        crawlerState.failures++;
        if (now - crawlerState.failingSince > config.crawler.giveUpHours * 3600_000) {
          crawlerState.stopped = true;
          log.warn({ since: new Date(crawlerState.failingSince).toISOString() }, 'battle report crawler stopped: game unreachable');
        }
      } else {
        Object.assign(crawlerState, { failures: 0, failingSince: null, nextAttempt: 0, lastError: null });
      }
    } finally {
      busy = false;
    }
  }, config.crawler.intervalMs);
  return () => clearInterval(timer);
}

/** One report: 'done' (archived/deleted/failed attempt), 'idle' (nothing to do) or 'transient' (game unreachable). */
export async function step(db: DB, log: Log, fetcher = fetch): Promise<'done' | 'idle' | 'transient'> {
  // newest first: small reports of today are the ones the game deletes soonest;
  // universes without game URL are skipped until it is set
  const job = db
    .prepare(
      `SELECT h.group_id, h.report_id, h.time, u.settings FROM battle_hall h
       JOIN groups g ON g.id = h.group_id JOIN universes u ON u.id = g.universe_id
       WHERE (h.report_status IS NULL OR h.report_status = 'no_game_url') AND h.report_tries < ?
         AND COALESCE(json_extract(u.settings, '$.gameUrl'), '') != ''
         AND NOT EXISTS (SELECT 1 FROM combat_reports c WHERE c.group_id = h.group_id AND c.report_id = h.report_id)
       ORDER BY h.time DESC LIMIT 1`,
    )
    .get(MAX_TRIES) as { group_id: number; report_id: string; time: number | null; settings: string } | undefined;
  if (!job) return 'idle';
  const gameUrl = String(JSON.parse(job.settings).gameUrl).replace(/\/?$/, '/');
  const mark = (status: string | null) =>
    db
      .prepare('UPDATE battle_hall SET report_status = ?, report_tries = report_tries + 1 WHERE group_id = ? AND report_id = ?')
      .run(status, job.group_id, job.report_id);
  const url = `${gameUrl}game.php?page=raport&raport=${job.report_id}`;
  const transient = (reason: string) => {
    crawlerState.lastError = reason;
    log.warn({ report: job.report_id, reason }, 'battle report fetch failed, pausing');
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
  const parsed = parsePage({ html, url }).records[0] as CombatReportRecord | undefined;
  if (parsed?.kind === 'combatReport') {
    // the hall time is the local game time; the public page shows UTC
    storeCombatReport(db, job.group_id, parsed, job.time);
    log.info({ report: job.report_id }, 'battle report archived');
    return 'done';
  }
  if (/Invalid Battle Report ID|Ungültige Kampfbericht ID/i.test(html)) {
    mark('gone');
    return 'done';
  }
  // a report page that can't be read costs a try; anything else (maintenance page, login, …) pauses
  if (/<title>[^<]*(report|Kampfbericht)/i.test(html)) {
    mark(null);
    return 'done';
  }
  return transient('no report page (maintenance?)');
}
