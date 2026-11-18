import { localToEpoch, type HubRecord, type ParseResult } from '@pr0hub/core';
import type { GroupContext } from './context.js';
import { now, type DB } from './db.js';
import type { IngestTarget } from './ingest.js';
import { overviewTime, SAME_UPDATE, syncHints, type SyncHintKey } from './repo/syncHints.js';
import type { Store } from './store.js';

/**
 * What a saved sync changed for the group, for the member's feedback after saving ("14 systems updated, before 5 days
 * old on average"). Parts without news are left out.
 */
export interface SyncImpact {
  /** galaxy systems with a newer view than before: how many, how many never seen, average age of the replaced views */
  galaxy?: { systems: number; first: number; age: number | null };
  /** spy reports: targets spied for the first time, targets with an older report replaced, its average age */
  spy?: { first: number; replaced: number; age: number | null };
  /** statistics updates the sync added categories to; `first`: no category of the update was synced before */
  stats?: { update: number; first: boolean; types: number[] }[];
  /** own pages newer than before: their previous time (null: first one) */
  own?: { page: OwnPage; before: number | null }[];
  /** sync hints of the member that are done now */
  hintsDone?: SyncHintKey[];
}

type OwnPage = 'empire' | 'overview' | 'buildings' | 'research';

/** An own page at most this much newer than the stored one is no news (the same page pasted again). */
const OWN_FRESH = 3600;

/**
 * Takes the group's state the records are about before they are stored and returns the function that tells the
 * impact after storing them. The sync hints are counted for the member who pasted their own pages only.
 */
export function probeImpact(db: DB, target: IngestTarget, parsed: ParseResult, store: Store, ctx?: GroupContext): () => SyncImpact {
  const g = target.groupId;
  const epoch = (local: string | null) => (local ? localToEpoch(local, target.timezone, now()) : null);
  const records = parsed.records;
  const of = <K extends HubRecord['kind']>(kind: K) => records.filter((r): r is Extract<HubRecord, { kind: K }> => r.kind === kind);

  // galaxy: the newest view per system in the paste against the stored one
  const views = new Map<string, number>();
  for (const r of of('galaxy')) {
    const k = `${r.g}:${r.s}`;
    views.set(k, Math.max(views.get(k) ?? 0, store.galaxySeenAt(r)));
  }
  const seenBefore = new Map(
    views.size
      ? (db
          .prepare("SELECT g || ':' || s AS k, seen_at FROM galaxy_views WHERE group_id = ? AND g || ':' || s IN (SELECT value FROM json_each(?))")
          .all(g, JSON.stringify([...views.keys()])) as { k: string; seen_at: number }[]).map((x) => [x.k, x.seen_at])
      : [],
  );

  // spy reports: the newest report per target in the paste against the group's newest one
  const reports = new Map<string, { time: number; g: number; s: number; p: number; type: string }>();
  for (const r of of('spy')) {
    const time = epoch(r.reportTime);
    if (time == null) continue;
    const k = `${r.coords.g}:${r.coords.s}:${r.coords.p}:${r.planetType}`;
    if ((reports.get(k)?.time ?? 0) < time) reports.set(k, { time, ...r.coords, type: r.planetType });
  }
  const newestReport = db.prepare('SELECT MAX(report_time) FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ?').pluck();
  const reportBefore = new Map([...reports].map(([k, x]) => [k, (newestReport.get(g, x.g, x.s, x.p, x.type) as number | null) ?? null]));

  // statistics: categories of a player update (pages of one update within minutes) synced before
  const updates = new Map<number, Set<number>>();
  for (const r of of('stats')) {
    const time = epoch(r.statTime);
    if (r.who !== 'player' || !r.type || time == null) continue;
    const key = [...updates.keys()].find((u) => Math.abs(u - time) <= SAME_UPDATE) ?? time;
    updates.set(key, (updates.get(key) ?? new Set()).add(r.type));
  }
  const typesBefore = new Map(
    [...updates.keys()].map((u) => [
      u,
      new Set(
        db
          .prepare("SELECT DISTINCT type FROM stat_snapshots WHERE group_id = ? AND who = 'player' AND stat_time BETWEEN ? AND ?")
          .pluck()
          .all(g, u - SAME_UPDATE, u + SAME_UPDATE) as number[],
      ),
    ]),
  );

  // own pages: their previous time and the time of the pasted page, when the member synced them for themselves
  const own: { page: OwnPage; before: number | null; time: number }[] = [];
  const pageTime = (local: string | null | undefined) => epoch(local ?? null) ?? now();
  const newest = (times: number[]) => Math.max(...times);
  if (target.syncedBy == null) {
    const maxOf = (sql: string, ...args: unknown[]) => (db.prepare(sql).pluck().get(...args) as number | null) ?? null;
    const empires = of('empire');
    if (empires.length) {
      own.push({
        page: 'empire',
        before: maxOf('SELECT MAX(created_at) FROM empire_snapshots WHERE group_id = ? AND user_id = ?', g, target.userId),
        time: newest(empires.map((r) => pageTime(r.pageTime))),
      });
    }
    const overviews = [...of('overview'), ...of('fleets')];
    if (overviews.length) own.push({ page: 'overview', before: overviewTime(db, g, target.userId), time: newest(overviews.map((r) => pageTime(r.pageTime))) });
    for (const [page, table, list] of [
      ['buildings', 'building_snapshots', of('buildings')],
      ['research', 'research_snapshots', of('research')],
    ] as const) {
      if (!list.length) continue;
      // several planets in one sync: the oldest of their previous pages
      const times = list.map((r) =>
        maxOf(`SELECT MAX(page_time) FROM ${table} WHERE group_id = ? AND user_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ?`, g, target.userId, r.coords.g, r.coords.s, r.coords.p, r.type),
      );
      own.push({ page, before: times.includes(null) ? null : Math.min(...(times as number[])), time: newest(list.map((r) => pageTime(r.pageTime))) });
    }
  }

  // the member's sync hints (a copy of the context: its cached empire must not outlive the sync); unreadable data
  // leaves them out
  const hintsOf = ctx && ctx.user.id === target.userId && target.syncedBy == null ? () => syncHints(db, { ...ctx }).map((h) => h.key) : null;
  const tryHints = () => {
    try {
      return hintsOf?.() ?? null;
    } catch {
      return null;
    }
  };
  const hintsBefore = tryHints();

  return () => {
    const impact: SyncImpact = {};

    const ages: number[] = [];
    let systems = 0;
    let first = 0;
    for (const [k, seenAt] of views) {
      const before = seenBefore.get(k);
      if (before != null && before >= seenAt) continue;
      systems++;
      if (before == null) first++;
      else ages.push(seenAt - before);
    }
    if (systems) impact.galaxy = { systems, first, age: average(ages) };

    const replacedAges: number[] = [];
    let spiedFirst = 0;
    for (const [k, x] of reports) {
      const before = reportBefore.get(k) ?? null;
      if (before == null) spiedFirst++;
      else if (before < x.time) replacedAges.push(x.time - before);
    }
    if (spiedFirst || replacedAges.length) impact.spy = { first: spiedFirst, replaced: replacedAges.length, age: average(replacedAges) };

    const stats = [...updates]
      .map(([update, types]) => {
        const before = typesBefore.get(update)!;
        return { update, first: before.size === 0, types: [...types].filter((t) => !before.has(t)).sort((a, b) => a - b) };
      })
      .filter((x) => x.types.length);
    if (stats.length) impact.stats = stats;

    const newer = own.filter((x) => x.before == null || x.time - x.before > OWN_FRESH).map(({ page, before }) => ({ page, before }));
    if (newer.length) impact.own = newer;

    const hintsAfter = hintsBefore && tryHints();
    if (hintsBefore && hintsAfter) {
      const done = hintsBefore.filter((k) => !hintsAfter.includes(k));
      if (done.length) impact.hintsDone = done;
    }
    return impact;
  };
}

const average = (list: number[]) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
