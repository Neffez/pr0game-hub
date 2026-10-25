import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { config } from './config.js';
import { now, type DB } from './db.js';
import { events } from './events.js';

/**
 * Operating figures for the admin page (routes/admin.ts `GET /api/admin/system`): database and disk size, memory,
 * event loop delay and request times. Request figures live in memory since the start; an hourly sample
 * (`system_samples`, see `startMonitor`) keeps the growth over time.
 */

/** Durations kept per route for the percentiles (the newest ones). */
const RECENT = 200;
/** Requests slower than this are listed one by one (the newest `SLOW_KEEP`). */
const SLOW_MS = 1000;
const SLOW_KEEP = 20;
/** Hourly samples are kept this long. */
const SAMPLE_KEEP = 90 * 86400;
const SAMPLE_MS = 3600_000;

interface RouteStats {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  recent: number[];
}

const startedAt = now();
const routes = new Map<string, RouteStats>();
const slow: { time: number; route: string; ms: number; status: number }[] = [];
/** requests and slow requests since the last sample */
let window = { requests: 0, slow: 0 };
let loop: ReturnType<typeof monitorEventLoopDelay> | null = null;

/** One finished request; `route` is the route pattern (e.g. `GET /api/:uni/overview`), so the keys stay few. */
export function recordRequest(route: string, ms: number, status: number) {
  let r = routes.get(route);
  if (!r) routes.set(route, (r = { count: 0, errors: 0, totalMs: 0, maxMs: 0, recent: [] }));
  r.count++;
  if (status >= 500) r.errors++;
  r.totalMs += ms;
  r.maxMs = Math.max(r.maxMs, ms);
  r.recent.push(ms);
  if (r.recent.length > RECENT) r.recent.shift();
  window.requests++;
  if (ms >= SLOW_MS) {
    window.slow++;
    slow.unshift({ time: now(), route, ms: Math.round(ms), status });
    slow.length = Math.min(slow.length, SLOW_KEEP);
  }
}

const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const round = (ms: number) => Math.round(ms * 10) / 10;

function fileSize(file: string) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/** Memory limit and use of the container (cgroup v2, else v1); null outside a container or without limit. */
function cgroupMemory(): { limit: number | null; current: number | null } {
  const read = (...files: string[]) => {
    for (const f of files) {
      try {
        const v = readFileSync(f, 'utf8').trim();
        // "max" (v2) or a huge number (v1) means no limit
        return v === 'max' || Number(v) > 2 ** 60 ? null : Number(v);
      } catch {
        // next
      }
    }
    return null;
  };
  return {
    limit: read('/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'),
    current: read('/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes'),
  };
}

function disk(dir: string): { total: number; free: number } | null {
  try {
    const s = statfsSync(dir);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

/** Backups written by dist/backup.js into the data directory (the deployment may keep them elsewhere). */
function backups() {
  const dir = join(config.dataDir, 'backups');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^hub-\d{8}-\d{6}\.db$/.test(f));
  return { count: files.length, bytes: files.reduce((sum, f) => sum + fileSize(join(dir, f)), 0), newest: files.sort().at(-1) ?? null };
}

function dbFiles(db: DB) {
  const file = db.name;
  const pageSize = db.pragma('page_size', { simple: true }) as number;
  const pages = db.pragma('page_count', { simple: true }) as number;
  const free = db.pragma('freelist_count', { simple: true }) as number;
  return { file, bytes: pageSize * pages, freeBytes: pageSize * free, walBytes: fileSize(`${file}-wal`), pageSize };
}

function loopDelay() {
  if (!loop) return null;
  const ms = (ns: number) => round(ns / 1e6);
  return { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max), mean: ms(loop.mean) };
}

/** Size of every table with its indexes and its rows, largest first. */
function tables(db: DB) {
  const owner = new Map(
    (db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type IN ('table', 'index')").all() as { name: string; tbl_name: string }[]).map(
      (r) => [r.name, r.tbl_name],
    ),
  );
  const sizes = new Map<string, { bytes: number; indexBytes: number }>();
  for (const r of db.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name').all() as { name: string; bytes: number }[]) {
    const table = owner.get(r.name) ?? r.name;
    const s = sizes.get(table) ?? { bytes: 0, indexBytes: 0 };
    if (table === r.name) s.bytes += r.bytes;
    else s.indexBytes += r.bytes;
    sizes.set(table, s);
  }
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
  return names
    .map((name) => ({
      name,
      rows: db.prepare(`SELECT COUNT(*) FROM "${name.replaceAll('"', '""')}"`).pluck().get() as number,
      ...(sizes.get(name) ?? { bytes: 0, indexBytes: 0 }),
    }))
    .sort((a, b) => b.bytes + b.indexBytes - (a.bytes + a.indexBytes));
}

/** Syncs per day and what they keep (pasted pages are only kept `config.rawRetentionDays`). */
function usage(db: DB) {
  const t = now();
  const days = db
    .prepare(
      `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS syncs, COUNT(DISTINCT user_id) AS users,
         SUM(COALESCE(length(html_gz), 0) + COALESCE(length(text_gz), 0)) AS bytes
       FROM raw_ingests WHERE created_at >= ? GROUP BY day ORDER BY day DESC`,
    )
    .all(t - config.rawRetentionDays * 86400);
  const groups = db
    .prepare(
      `SELECT g.id, g.name, u.slug AS universe,
         (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
         (SELECT COUNT(*) FROM raw_ingests r WHERE r.group_id = g.id) AS syncs,
         (SELECT COALESCE(SUM(COALESCE(length(html_gz), 0) + COALESCE(length(text_gz), 0)), 0) FROM raw_ingests r WHERE r.group_id = g.id) AS raw_bytes,
         (SELECT COUNT(*) FROM stat_snapshots s WHERE s.group_id = g.id) AS stat_snapshots,
         (SELECT COUNT(*) FROM players p WHERE p.group_id = g.id) AS players,
         (SELECT COUNT(*) FROM spy_reports s WHERE s.group_id = g.id) AS spy_reports,
         (SELECT COUNT(*) FROM combat_reports c WHERE c.group_id = g.id) AS combat_reports
       FROM groups g JOIN universes u ON u.id = g.universe_id ORDER BY u.slug, g.name`,
    )
    .all();
  const live = events.stats();
  // members with an open tab count too: the last seen time is only written when they go offline
  const active = (since: number) =>
    new Set([...(db.prepare('SELECT user_id FROM group_members WHERE last_seen_at >= ?').pluck().all(t - since) as number[]), ...live.users]).size;
  return {
    users: db.prepare("SELECT COUNT(*) FROM users WHERE password_hash <> ''").pluck().get() as number,
    online: live.users.length,
    connections: live.connections,
    activeDay: active(86400),
    activeWeek: active(7 * 86400),
    days,
    groups,
  };
}

function requests() {
  return [...routes]
    .map(([route, r]) => {
      const sorted = [...r.recent].sort((a, b) => a - b);
      return {
        route,
        count: r.count,
        errors: r.errors,
        avg: round(r.totalMs / r.count),
        p50: round(percentile(sorted, 0.5)),
        p95: round(percentile(sorted, 0.95)),
        max: round(r.maxMs),
      };
    })
    .sort((a, b) => b.avg * b.count - a.avg * a.count);
}

/** Everything the admin page shows; reads the whole database file once (dbstat), so only on demand. */
export function systemInfo(db: DB) {
  const mem = process.memoryUsage();
  const files = dbFiles(db);
  return {
    time: now(),
    startedAt,
    node: process.version,
    database: { ...files, tables: tables(db), backups: backups(), rawRetentionDays: config.rawRetentionDays },
    disk: disk(config.dataDir),
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      heapLimit: getHeapStatistics().heap_size_limit,
      container: cgroupMemory(),
    },
    eventLoop: loopDelay(),
    usage: usage(db),
    requests: requests(),
    slow,
    samples: db.prepare('SELECT * FROM system_samples WHERE time >= ? ORDER BY time').all(now() - SAMPLE_KEEP),
  };
}

/** Rebuilds the database file without its free pages; blocks the hub while it runs and needs its size again on disk. */
export function vacuum(db: DB) {
  const before = dbFiles(db);
  const space = disk(config.dataDir);
  if (space && space.free < before.bytes * 1.1) return { ok: false as const, before: before.bytes, after: before.bytes, free: space.free };
  const t = performance.now();
  db.exec('VACUUM');
  db.pragma('wal_checkpoint(TRUNCATE)');
  return { ok: true as const, before: before.bytes, after: dbFiles(db).bytes, ms: Math.round(performance.now() - t) };
}

/** Housekeeping besides the per-sync clean-ups: data nothing deletes when a group stops syncing. */
function housekeeping(db: DB) {
  const t = now();
  db.prepare('DELETE FROM raw_ingests WHERE created_at < ?').run(t - config.rawRetentionDays * 86400);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t);
  // planner statistics for the indexes (cheap, only analyzes what changed a lot)
  db.pragma('optimize');
}

function sample(db: DB) {
  const files = dbFiles(db);
  const delay = loopDelay();
  db.prepare(
    `INSERT OR REPLACE INTO system_samples (time, db_bytes, free_bytes, wal_bytes, rss, heap_used, loop_p99, loop_max, requests, slow)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(now(), files.bytes, files.freeBytes, files.walBytes, process.memoryUsage().rss, process.memoryUsage().heapUsed, delay?.p99 ?? null, delay?.max ?? null, window.requests, window.slow);
  db.prepare('DELETE FROM system_samples WHERE time < ?').run(now() - SAMPLE_KEEP);
  window = { requests: 0, slow: 0 };
  // the event loop figures of a sample cover its hour
  loop?.reset();
}

/** Starts measuring the event loop and the hourly sample with housekeeping; returns the stop. */
export function startMonitor(db: DB, log: { warn: (o: object, m: string) => void }) {
  loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const tick = () => {
    try {
      housekeeping(db);
      sample(db);
    } catch (err) {
      log.warn({ err }, 'system sample failed');
    }
  };
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, SAMPLE_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    loop?.disable();
  };
}
