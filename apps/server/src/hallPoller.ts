import { parsePage, type BattleHallRecord } from '@pr0hub/core';
import { config } from './config.js';
import type { DB } from './db.js';
import { events } from './events.js';
import type { IngestSummary } from './ingest.js';
import { Store } from './store.js';

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/**
 * The public battle hall (index.php?page=battleHall, no login) filters farewell battles with its own values:
 * 0 hides them, 1 shows only them. Mapped to the in-game filter values the store understands (1 hide, 2 only).
 */
const PUBLIC_MEMORIAL = [
  { param: 0, memorial: 1 },
  { param: 1, memorial: 2 },
] as const;

/**
 * Reads the public battle hall of every universe with a game URL and adds its entries to the battle hall of every
 * group of that universe, so new entries are there without anyone syncing the page in the game; the crawler then
 * archives their reports. The public page shows the server time in UTC (like the public report pages) and, unlike
 * the in-game page, has no minimum size: it lists the top 100 by units.
 */
export async function pollBattleHall(db: DB, log: Log, fetcher = fetch): Promise<Record<string, number>> {
  const universes = db
    .prepare(`SELECT id, slug, json_extract(settings, '$.gameUrl') AS gameUrl FROM universes WHERE COALESCE(json_extract(settings, '$.gameUrl'), '') != '' AND ended_at IS NULL`)
    .all() as { id: number; slug: string; gameUrl: string }[];
  const added: Record<string, number> = {};
  for (const u of universes) {
    const groups = db.prepare('SELECT id FROM groups WHERE universe_id = ?').pluck().all(u.id) as number[];
    if (!groups.length) continue;
    const base = u.gameUrl.replace(/\/?$/, '/');
    for (const { param, memorial } of PUBLIC_MEMORIAL) {
      const url = `${base}index.php?page=battleHall&memorial=${param}`;
      let html: string;
      try {
        const res = await fetcher(url, { headers: { 'user-agent': 'pr0game-hub battle report archive' }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      } catch (e) {
        log.warn({ universe: u.slug, url, reason: (e as Error).message }, 'public battle hall fetch failed');
        break;
      }
      const record = parsePage({ html, url }).records.find((r) => r.kind === 'battleHall') as BattleHallRecord | undefined;
      if (!record) {
        log.warn({ universe: u.slug, url }, 'public battle hall: no battle hall page (maintenance?)');
        break;
      }
      // the page's own filter select (only shown with several universes) uses the public values: set it from the request
      const hall: BattleHallRecord = { ...record, memorial, timeframe: null };
      for (const groupId of groups) {
        const summary: IngestSummary = { pageType: 'battleHall', source: 'html', lang: 'de', warnings: [], counts: {}, preview: [] };
        db.transaction(() => new Store(db, { groupId, userId: 0, timezone: 'UTC' }, summary).record(hall))();
        const n = summary.counts.battle_hall?.new ?? 0;
        if (n) events.publish(groupId, { type: 'data', tables: ['battle_hall'] });
        added[u.slug] = (added[u.slug] ?? 0) + n;
      }
    }
  }
  if (Object.keys(added).length) log.info({ added }, 'public battle hall polled');
  return added;
}

/** Polls the public battle hall a minute after the start, then every config.crawler.hallHours hours (0 = off). */
export function startHallPoller(db: DB, log: Log) {
  if (!config.crawler.enabled || !(config.crawler.hallHours > 0)) return () => {};
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await pollBattleHall(db, log);
    } catch (e) {
      log.warn({ reason: (e as Error).message }, 'public battle hall poll failed');
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, config.crawler.hallHours * 3600_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
