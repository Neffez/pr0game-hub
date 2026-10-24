import { parsePage, type HubRecord, type ParseInput, type ParseResult, type SpyReportRecord } from '@pr0hub/core';
import { gunzipSync, gzipSync } from 'node:zlib';
import { HttpError } from './auth.js';
import { config } from './config.js';
import { now, type DB } from './db.js';
import { events } from './events.js';
import { foreignRecords } from './plausibility.js';
import { messageShare } from './repo/messages.js';
import { Store } from './store.js';

export interface IngestTarget {
  groupId: number;
  userId: number;
  timezone: string;
}

export interface IngestSummary {
  pageType: ParseResult['pageType'];
  source: ParseResult['source'];
  lang: ParseResult['lang'];
  /** stable codes, translated by the web app */
  warnings: string[];
  counts: Record<string, { new: number; duplicate: number }>;
  /** short description for the preview, per record (formatted by the web app) */
  preview: PreviewItem[];
}

export type PreviewItem = { kind: HubRecord['kind'] } & Record<string, string | number | boolean | null>;

export function ingest(
  db: DB,
  target: IngestTarget,
  input: ParseInput & { source: 'paste' | 'upload' },
  opts: { dryRun?: boolean } = {},
): IngestSummary {
  const parsed = parsePage(input);
  if (foreignRecords(db, target, parsed.records)) {
    throw new HttpError(400, 'wrong_universe', 'The pasted page does not match the data of this universe');
  }
  const summary: IngestSummary = {
    pageType: parsed.pageType,
    source: parsed.source,
    lang: parsed.lang,
    warnings: [...parsed.warnings],
    counts: {},
    // universe.json yields thousands of systems: the preview only needs a sample
    preview: parsed.records.slice(0, 100).map(describe),
  };
  if (opts.dryRun) return summary;

  const store = new Store(db, target, summary);
  // universe.json (several MB) isn't kept: a download builds it again from the hub's data
  const keep = parsed.source !== 'json';
  db.transaction(() => {
    for (const rec of parsed.records) store.record(rec);
    db.prepare('DELETE FROM raw_ingests WHERE group_id = ? AND created_at < ?').run(target.groupId, now() - config.rawRetentionDays * 86400);
    db.prepare(
      `INSERT INTO raw_ingests (group_id, user_id, source, page_type, url, html_gz, text_gz, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      target.groupId,
      target.userId,
      input.source,
      parsed.pageType,
      input.url ?? null,
      keep && input.html ? gzipSync(input.html) : null,
      keep && input.text ? gzipSync(input.text) : null,
      JSON.stringify({ counts: summary.counts, warnings: summary.warnings, about: aboutRecords(parsed.records) }),
    );
  })();
  const systems = parsed.records.flatMap((r) => (r.kind === 'galaxy' ? [`${r.g}:${r.s}`] : []));
  events.publishIngest(target.groupId, target.userId, publicCounts(db, target.userId, summary.counts), systems);
  return summary;
}

/**
 * Whether pasted HTML visibly comes from another universe than the one it is saved to: browsers copy game links as
 * absolute URLs ("https://pr0game.com/uni7/game.php?page=…"), page sources carry "Universe 7" in their title. Without
 * a game URL in the universe settings or any such marker in the paste, nothing can be told (null).
 */
export function foreignUniverse(html: string | null | undefined, gameUrl: string): string | null {
  if (!html || !gameUrl) return null;
  const strip = (url: string) => url.toLowerCase().replace(/^https?:\/\//, '').replace(/\/?$/, '/');
  const base = strip(gameUrl);
  const bases = new Set([...html.matchAll(/https?:\/\/[^\s"'<>]+?\/game\.php/gi)].map((m) => strip(m[0].slice(0, -'game.php'.length))));
  if (bases.size && !bases.has(base)) return [...bases][0];
  const title = /<title>[^<]*Univers(?:e|um)\s+(\d+)/i.exec(html)?.[1];
  const own = /\/uni(\d+)\/$/.exec(base)?.[1];
  if (title && own && title !== own) return `Universe ${title}`;
  return null;
}

export interface RawIngest {
  group_id: number;
  user_id: number | null;
  url: string | null;
  html_gz: Buffer | null;
  text_gz: Buffer | null;
}

/** Parses a stored sync again. */
export function parseRaw(row: RawIngest): ParseResult {
  return parsePage({
    html: row.html_gz ? gunzipSync(row.html_gz).toString('utf8') : null,
    text: row.text_gz ? gunzipSync(row.text_gz).toString('utf8') : null,
    url: row.url,
  });
}

/** Re-runs the parser over a stored raw ingest (after parser fixes). Idempotent like a normal ingest. */
export function reparse(db: DB, rawId: number, timezone: string): IngestSummary {
  const row = db.prepare('SELECT * FROM raw_ingests WHERE id = ?').get(rawId) as RawIngest | undefined;
  if (!row) throw new Error('raw ingest not found');
  const parsed = parseRaw(row);
  const summary: IngestSummary = {
    pageType: parsed.pageType, source: parsed.source, lang: parsed.lang, warnings: parsed.warnings, counts: {}, preview: [],
  };
  // the uploader may be deleted meanwhile: attribute to a remaining member of the group
  const userId =
    row.user_id ??
    (db.prepare("SELECT user_id FROM group_members WHERE group_id = ? ORDER BY role = 'admin' DESC, joined_at LIMIT 1").pluck().get(row.group_id) as number | undefined);
  if (!userId) throw new Error('group has no members');
  const store = new Store(db, { groupId: row.group_id, userId, timezone }, summary);
  // player messages are private: never attributed to someone else
  const records = parsed.records.filter((r) => r.kind !== 'playerMessage' || row.user_id);
  db.transaction(() => records.forEach((r) => store.record(r)))();
  events.publishIngest(row.group_id, undefined, publicCounts(db, userId, summary.counts), null);
  return summary;
}

/** Counts for the live event: the other members only learn of new player messages when the member shares them. */
function publicCounts(db: DB, userId: number, counts: IngestSummary['counts']): IngestSummary['counts'] {
  if (!counts.player_messages || messageShare(db, userId)) return counts;
  const { player_messages: _, ...rest } = counts;
  return rest;
}

/**
 * Fills the activity log from data stored before it existed: point/fleet losses and stagnation from
 * the stat snapshots, phalanx changes from the moon spy reports. Galaxy changes can't be replayed
 * (only the latest galaxy state is stored). Idempotent: existing entries are kept.
 */
export function backfillActivity(db: DB, groupId: number, timezone: string): number {
  const before = db.prepare('SELECT COUNT(*) FROM activity_log WHERE group_id = ?').pluck().get(groupId) as number;
  const summary: IngestSummary = { pageType: 'unknown', source: 'text', lang: 'de', warnings: [], counts: {}, preview: [] };
  const store = new Store(db, { groupId, userId: 0, timezone }, summary);
  db.transaction(() => {
    const scores = db
      .prepare(
        // status at that time from the status log; unknown counts as active
        `SELECT ps.player_id, ps.points, s.type, s.stat_time,
           COALESCE((SELECT l.status FROM player_status_log l WHERE l.player_id = ps.player_id AND l.seen_at <= s.stat_time
             ORDER BY l.seen_at DESC LIMIT 1), '[]') AS status
         FROM player_scores ps JOIN stat_snapshots s ON s.id = ps.snapshot_id
         WHERE s.group_id = ? AND s.who = 'player' AND s.type IN (1, 2) ORDER BY s.stat_time`,
      )
      .all(groupId) as { player_id: number; points: number; type: number; stat_time: number; status: string }[];
    for (const r of scores) store.scoreEvents(r.player_id, r.type, r.stat_time, r.points, JSON.parse(r.status));

    const moons = db
      .prepare(
        `SELECT g, s, p, player_id, report_time, sections FROM spy_reports
         WHERE group_id = ? AND planet_type = 'moon' AND json_extract(sections, '$."0"') IS NOT NULL ORDER BY report_time`,
      )
      .all(groupId) as { g: number; s: number; p: number; player_id: number | null; report_time: number; sections: string }[];
    for (const m of moons) {
      store.phalanxEvent(
        { kind: 'spy', coords: { g: m.g, s: m.s, p: m.p }, sections: JSON.parse(m.sections) } as SpyReportRecord,
        m.report_time,
        m.player_id,
      );
    }

    const recycled = db.prepare('SELECT * FROM recycle_reports WHERE group_id = ? AND time IS NOT NULL ORDER BY time').all(groupId) as any[];
    for (const x of recycled) {
      store.recycleEvent(
        { kind: 'recycle', msgId: x.msg_id, time: null, coords: { g: x.g, s: x.s, p: x.p }, metal: x.metal, crystal: x.crystal, totalMetal: x.total_metal, totalCrystal: x.total_crystal },
        x.time, x.user_id, x.dedupe_key,
      );
    }

    // debris fields known today, as "seen" at the time of their galaxy view (unless already logged)
    const debris = db
      .prepare(
        `SELECT pl.g, pl.s, pl.p, pl.player_id, pl.debris, v.seen_at FROM planets pl
         JOIN galaxy_views v ON v.group_id = pl.group_id AND v.g = pl.g AND v.s = pl.s
         WHERE pl.group_id = ? AND pl.debris IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM activity_log l WHERE l.group_id = pl.group_id AND l.g = pl.g AND l.s = pl.s AND l.p = pl.p AND l.kind LIKE 'debris_%')`,
      )
      .all(groupId) as { g: number; s: number; p: number; player_id: number | null; debris: string; seen_at: number }[];
    for (const d of debris) store.debrisSeen({ g: d.g, s: d.s, p: d.p }, d.seen_at, d.player_id, JSON.parse(d.debris));
  })();
  return (db.prepare('SELECT COUNT(*) FROM activity_log WHERE group_id = ?').pluck().get(groupId) as number) - before;
}

/** What a sync contained, per record kind, for the admin's list of syncs (names and coordinates, not translated). */
export interface About {
  kind: HubRecord['kind'];
  count: number;
  /** a few names/coordinates to recognise the page by */
  sample: string[];
  /** statistics: ranking and category */
  who?: 'player' | 'alliance';
  type?: number | null;
}

const SAMPLE = 4;

export function aboutRecords(records: HubRecord[]): About[] {
  const c = (x: { g: number; s: number; p: number }) => `${x.g}:${x.s}:${x.p}`;
  const kinds = new Map<HubRecord['kind'], About>();
  for (const r of records) {
    let about = kinds.get(r.kind);
    if (!about) kinds.set(r.kind, (about = { kind: r.kind, count: 0, sample: [] }));
    about.count++;
    const add = (...items: string[]) => {
      for (const item of items) if (about!.sample.length < SAMPLE && !about!.sample.includes(item)) about!.sample.push(item);
    };
    switch (r.kind) {
      case 'stats':
        about.who = r.who;
        about.type = r.type;
        add(...r.rows.slice(0, SAMPLE).map((x) => x.name));
        break;
      case 'empire':
        add(...r.planets.filter((p) => p.type === 'planet').map((p) => `${p.name} ${c(p.coords)}`));
        break;
      case 'galaxy':
        add(`${r.g}:${r.s}`);
        break;
      case 'spy':
        add(`${r.playerName} ${c(r.coords)}`);
        break;
      case 'hostileSpy':
        add(`${r.fromPlayerName} → ${c(r.targetCoords)}`);
        break;
      case 'playerMessage':
        add(r.from.name);
        break;
      case 'overview':
        if (r.current) add(c(r.current.coords));
        break;
      case 'buildings':
        add(c(r.coords));
        break;
      case 'battle':
      case 'recycle':
        add(c(r.coords));
        break;
      case 'battleHall':
        add(...r.entries.flatMap((e) => e.attackers));
        break;
      case 'combatReport':
        add(...r.fleets.map((f) => f.name));
        break;
      case 'fleets':
        add(...r.fleets.filter((f) => f.owner === 'own').map((f) => c(f.from.coords)));
        break;
    }
  }
  return [...kinds.values()];
}

/** Preview entry per record: kind plus the values the web app shows (texts are translated there). */
function describe(r: HubRecord): PreviewItem {
  const c = (x: { g: number; s: number; p: number }) => `[${x.g}:${x.s}:${x.p}]`;
  switch (r.kind) {
    case 'stats':
      return { kind: r.kind, who: r.who, type: r.type ?? null, rows: r.rows.length, time: r.statTime };
    case 'spy':
      return { kind: r.kind, coords: c(r.coords), moon: r.planetType === 'moon', player: r.playerName, time: r.reportTime };
    case 'battle':
      return { kind: r.kind, coords: c(r.coords), loot: r.loot.metal + r.loot.crystal + r.loot.deuterium };
    case 'expedition':
      return { kind: r.kind, event: r.event, size: r.size, depletion: r.depletion ?? null, time: r.time };
    case 'hostileSpy':
      return { kind: r.kind, from: r.fromPlayerName, fromCoords: c(r.fromCoords), target: c(r.targetCoords) };
    case 'galaxy':
      return { kind: r.kind, system: `${r.g}:${r.s}`, planets: r.rows.length };
    case 'empire':
      return { kind: r.kind, planets: r.planets.length };
    case 'overview':
      return { kind: r.kind, queues: r.queues.length };
    case 'buildings':
      return { kind: r.kind, coords: c(r.coords), moon: r.type === 'moon', buildings: r.buildings.length };
    case 'fleets':
      return { kind: r.kind, fleets: r.fleets.length, hostile: r.fleets.filter((f) => f.owner === 'hostile').length };
    case 'combatReport':
      return { kind: r.kind, names: r.fleets.map((f) => f.name).join(', ') };
    case 'battleHall':
      return { kind: r.kind, entries: r.entries.length };
    case 'recycle':
      return { kind: r.kind, coords: c(r.coords), amount: r.metal + r.crystal };
    case 'playerMessage':
      return { kind: r.kind, from: r.from.name, to: r.to.map((p) => p.name).join(', '), subject: r.subject, time: r.time };
  }
}
