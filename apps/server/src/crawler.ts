import { parsePage, type CombatReportRecord } from '@pr0hub/core';
import { config } from './config.js';
import type { DB } from './db.js';
import { storeCombatReport } from './ingest.js';

/**
 * Background worker: archives battle hall reports from the public report pages, one request at a
 * time (config.crawler.intervalMs apart). Reports the game already deleted are marked "gone".
 */
export function startCrawler(db: DB, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
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

export async function step(db: DB, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }, fetcher = fetch) {
  // newest first: small reports of today are the ones the game deletes soonest
  const job = db
    .prepare(
      `SELECT h.group_id, h.report_id, h.time, u.settings FROM battle_hall h
       JOIN groups g ON g.id = h.group_id JOIN universes u ON u.id = g.universe_id
       WHERE h.report_status IS NULL AND h.report_tries < 3
         AND NOT EXISTS (SELECT 1 FROM combat_reports c WHERE c.group_id = h.group_id AND c.report_id = h.report_id)
       ORDER BY h.time DESC LIMIT 1`,
    )
    .get() as { group_id: number; report_id: string; time: number | null; settings: string } | undefined;
  if (!job) return false;
  const gameUrl = (JSON.parse(job.settings).gameUrl ?? '').replace(/\/?$/, '/');
  const mark = (status: string | null) =>
    db
      .prepare('UPDATE battle_hall SET report_status = ?, report_tries = report_tries + 1 WHERE group_id = ? AND report_id = ?')
      .run(status, job.group_id, job.report_id);
  if (gameUrl === '/') {
    mark('no_game_url');
    return true;
  }
  const url = `${gameUrl}game.php?page=raport&raport=${job.report_id}`;
  try {
    const res = await fetcher(url, { headers: { 'user-agent': 'pr0game-hub battle report archive' } });
    const html = await res.text();
    const parsed = parsePage({ html, url }).records[0] as CombatReportRecord | undefined;
    if (parsed?.kind === 'combatReport') {
      // the hall time is the local game time; the public page shows UTC
      storeCombatReport(db, job.group_id, parsed, job.time);
      log.info({ report: job.report_id }, 'battle report archived');
    } else {
      mark(/Invalid Battle Report ID|Ungültige Kampfbericht ID/i.test(html) ? 'gone' : null);
    }
  } catch (e) {
    mark(null);
    log.warn({ report: job.report_id, err: (e as Error).message }, 'battle report fetch failed');
  }
  return true;
}
