import {
  debrisAmount,
  fnv1a,
  localToEpoch,
  parsePage,
  type BattleHallRecord,
  type CombatReportRecord,
  type BattleRecord,
  type EmpireRecord,
  type ExpeditionRecord,
  type GalaxyRecord,
  type HostileSpyRecord,
  type HubRecord,
  type OverviewRecord,
  type RecycleRecord,
  type ParseInput,
  type ParseResult,
  type SpyReportRecord,
  type StatsRecord,
} from '@pr0hub/core';
import { gunzipSync, gzipSync } from 'node:zlib';
import { config } from './config.js';
import { now, type DB } from './db.js';

/**
 * Names of players/alliances only known by id (universe.json without names). Replaced by the real name once
 * known, never kept as a former name.
 */
export const placeholderPlayer = (ingameId: number) => `Spieler #${ingameId}`;
export const placeholderAlliance = (ingameId: number) => `Allianz #${ingameId}`;

/** Empire pages are kept a week (besides the newest), see `empire()`. */
const EMPIRE_KEEP = 7 * 86400;

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
      JSON.stringify({ counts: summary.counts, warnings: summary.warnings }),
    );
  })();
  return summary;
}

/** Re-runs the parser over a stored raw ingest (after parser fixes). Idempotent like a normal ingest. */
export function reparse(db: DB, rawId: number, timezone: string): IngestSummary {
  const row = db.prepare('SELECT * FROM raw_ingests WHERE id = ?').get(rawId) as
    | { group_id: number; user_id: number | null; url: string | null; html_gz: Buffer | null; text_gz: Buffer | null }
    | undefined;
  if (!row) throw new Error('raw ingest not found');
  const parsed = parsePage({
    html: row.html_gz ? gunzipSync(row.html_gz).toString('utf8') : null,
    text: row.text_gz ? gunzipSync(row.text_gz).toString('utf8') : null,
    url: row.url,
  });
  const summary: IngestSummary = {
    pageType: parsed.pageType, source: parsed.source, lang: parsed.lang, warnings: parsed.warnings, counts: {}, preview: [],
  };
  // the uploader may be deleted meanwhile: attribute to a remaining member of the group
  const userId =
    row.user_id ??
    (db.prepare("SELECT user_id FROM group_members WHERE group_id = ? ORDER BY role = 'admin' DESC, joined_at LIMIT 1").pluck().get(row.group_id) as number | undefined);
  if (!userId) throw new Error('group has no members');
  const store = new Store(db, { groupId: row.group_id, userId, timezone }, summary);
  db.transaction(() => parsed.records.forEach((r) => store.record(r)))();
  return summary;
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
         WHERE group_id = ? AND planet_type = 'moon' AND sections LIKE '%"0":%' ORDER BY report_time`,
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
    case 'combatReport':
      return { kind: r.kind, names: r.fleets.map((f) => f.name).join(', ') };
    case 'battleHall':
      return { kind: r.kind, entries: r.entries.length };
    case 'recycle':
      return { kind: r.kind, coords: c(r.coords), amount: r.metal + r.crystal };
  }
}

class Store {
  constructor(
    private db: DB,
    private t: IngestTarget,
    private summary: IngestSummary,
  ) {}

  private count(kind: string, isNew: boolean) {
    const c = (this.summary.counts[kind] ??= { new: 0, duplicate: 0 });
    if (isNew) c.new++;
    else c.duplicate++;
  }

  private epoch(local: string | null): number | null {
    return local ? localToEpoch(local, this.t.timezone) : null;
  }

  record(r: HubRecord) {
    switch (r.kind) {
      case 'stats':
        return this.stats(r);
      case 'spy':
        return this.spy(r);
      case 'battle':
        return this.battle(r);
      case 'expedition':
        return this.expedition(r);
      case 'hostileSpy':
        return this.hostile(r);
      case 'galaxy':
        return this.galaxy(r);
      case 'empire':
        return this.empire(r);
      case 'overview':
        return this.overview(r);
      case 'recycle':
        return this.recycle(r);
      case 'battleHall':
        return this.battleHall(r);
      case 'combatReport':
        return this.combatReport(r);
    }
  }

  // --------------------------------------------------------------- entities

  alliance(ingameId: number | null, name: string | null, tag: string | null = null): number | null {
    if (!ingameId && !name && !tag) return null;
    const db = this.db;
    let row: { id: number } | undefined;
    if (ingameId) row = db.prepare('SELECT id FROM alliances WHERE group_id = ? AND ingame_id = ?').get(this.t.groupId, ingameId) as typeof row;
    if (!row && name) {
      row = db
        .prepare('SELECT id FROM alliances WHERE group_id = ? AND name = ? AND (ingame_id IS NULL OR ? IS NULL)')
        .get(this.t.groupId, name, ingameId) as typeof row;
    }
    if (!row && tag) row = db.prepare('SELECT id FROM alliances WHERE group_id = ? AND tag = ?').get(this.t.groupId, tag) as typeof row;
    if (row) {
      db.prepare(
        `UPDATE alliances SET ingame_id = COALESCE(?, ingame_id), name = COALESCE(?, name), tag = COALESCE(?, tag), updated_at = ? WHERE id = ?`,
      ).run(ingameId, name, tag, now(), row.id);
      return row.id;
    }
    return Number(
      db
        .prepare('INSERT INTO alliances (group_id, ingame_id, name, tag) VALUES (?, ?, ?, ?)')
        // only the id known (e.g. universe.json with "-"): the name follows with the next stats/galaxy paste
        .run(this.t.groupId, ingameId, name ?? tag ?? placeholderAlliance(ingameId!), tag).lastInsertRowid,
    );
  }

  /**
   * Finds or creates a player. With an in-game id the id is authoritative (renames
   * are recorded as aliases); a name-only player gets the id attached once known.
   */
  player(ingameId: number | null, name: string, seenAt: number): number {
    const db = this.db;
    const g = this.t.groupId;
    type Row = { id: number; name: string; ingame_id: number | null; last_seen: number };
    let row: Row | undefined;
    if (ingameId) {
      row = db.prepare('SELECT id, name, ingame_id, last_seen FROM players WHERE group_id = ? AND ingame_id = ?').get(g, ingameId) as Row | undefined;
      if (!row) {
        row = db
          .prepare('SELECT id, name, ingame_id, last_seen FROM players WHERE group_id = ? AND ingame_id IS NULL AND name = ? COLLATE NOCASE')
          .get(g, name) as Row | undefined;
        if (row) db.prepare('UPDATE players SET ingame_id = ? WHERE id = ?').run(ingameId, row.id);
      }
    } else {
      row = db
        .prepare('SELECT id, name, ingame_id, last_seen FROM players WHERE group_id = ? AND name = ? COLLATE NOCASE ORDER BY last_seen DESC')
        .get(g, name) as Row | undefined;
      row ??= db
        .prepare(
          `SELECT p.id, p.name, p.ingame_id, p.last_seen FROM player_aliases a JOIN players p ON p.id = a.player_id
           WHERE p.group_id = ? AND a.name = ? COLLATE NOCASE ORDER BY a.seen_until DESC`,
        )
        .get(g, name) as Row | undefined;
    }
    if (row) {
      if (ingameId && row.name !== name && row.name === placeholderPlayer(ingameId)) {
        db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, row.id);
        db.prepare('DELETE FROM player_aliases WHERE player_id = ? AND name = ?').run(row.id, name);
      } else if (ingameId && row.name !== name) {
        if (seenAt >= row.last_seen) {
          // newer data: renamed, keep the old name as alias
          db.prepare('INSERT OR REPLACE INTO player_aliases (player_id, name, seen_until) VALUES (?, ?, ?)').run(row.id, row.name, seenAt);
          db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, row.id);
          // the current name is no former name (renamed back)
          db.prepare('DELETE FROM player_aliases WHERE player_id = ? AND name = ?').run(row.id, name);
        } else {
          // older data (e.g. an old universe.json): the given name is a former name
          db.prepare(
            `INSERT INTO player_aliases (player_id, name, seen_until) VALUES (?, ?, ?)
             ON CONFLICT DO UPDATE SET seen_until = MAX(seen_until, excluded.seen_until)`,
          ).run(row.id, name, seenAt);
        }
      }
      db.prepare('UPDATE players SET last_seen = MAX(last_seen, ?) WHERE id = ?').run(seenAt, row.id);
      return row.id;
    }
    return Number(
      db
        .prepare('INSERT INTO players (group_id, ingame_id, name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)')
        .run(g, ingameId, name, seenAt, seenAt).lastInsertRowid,
    );
  }

  /** Player known only by id (universe.json without name): existing player, otherwise a placeholder name. */
  private playerById(ingameId: number, seenAt: number): number {
    const id = this.db.prepare('SELECT id FROM players WHERE group_id = ? AND ingame_id = ?').pluck().get(this.t.groupId, ingameId) as number | undefined;
    return id ?? this.player(ingameId, placeholderPlayer(ingameId), seenAt);
  }

  private playerStatus(playerId: number, status: string[], seenAt: number) {
    const json = JSON.stringify([...status].sort());
    const cur = this.db.prepare('SELECT status, last_seen FROM players WHERE id = ?').get(playerId) as { status: string; last_seen: number };
    // Older data pasted later must not overwrite the current status.
    if (cur.status === json || cur.last_seen > seenAt) return;
    this.db.prepare('UPDATE players SET status = ? WHERE id = ?').run(json, playerId);
    this.db.prepare('INSERT INTO player_status_log (player_id, status, seen_at) VALUES (?, ?, ?)').run(playerId, json, seenAt);
  }

  // ---------------------------------------------------------------- records

  private stats(r: StatsRecord) {
    if (!r.type || !r.statTime) {
      this.summary.warnings.push('stats_not_saved');
      return;
    }
    const db = this.db;
    const statTime = this.epoch(r.statTime)!;
    db.prepare('INSERT OR IGNORE INTO stat_snapshots (group_id, who, type, stat_time) VALUES (?, ?, ?, ?)').run(this.t.groupId, r.who, r.type, statTime);
    const snapshotId = db
      .prepare('SELECT id FROM stat_snapshots WHERE group_id = ? AND who = ? AND type = ? AND stat_time = ?')
      .pluck()
      .get(this.t.groupId, r.who, r.type, statTime) as number;

    for (const row of r.rows) {
      if (r.who === 'alliance') {
        const allyId = this.alliance(row.ingameId, row.name);
        const res = db
          .prepare('INSERT OR IGNORE INTO alliance_scores (snapshot_id, alliance_id, rank, rank_change, points, members) VALUES (?, ?, ?, ?, ?, ?)')
          .run(snapshotId, allyId, row.rank, row.rankChange, row.points, row.members ?? null);
        this.count('alliance_scores', res.changes > 0);
        continue;
      }
      const playerId = this.player(row.ingameId, row.name, statTime);
      const allyId = this.alliance(row.allyId, row.allyName);
      db.prepare('UPDATE players SET alliance_id = ? WHERE id = ? AND last_seen <= ?').run(allyId, playerId, statTime);
      this.playerStatus(playerId, row.status, statTime);
      const exists = db.prepare('SELECT 1 FROM player_scores WHERE snapshot_id = ? AND player_id = ?').get(snapshotId, playerId);
      db.prepare(
        `INSERT INTO player_scores (snapshot_id, player_id, rank, rank_change, points, title) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (snapshot_id, player_id) DO UPDATE SET rank_change = COALESCE(excluded.rank_change, rank_change),
           title = COALESCE(excluded.title, title)`,
      ).run(snapshotId, playerId, row.rank, row.rankChange, row.points, row.title ?? null);
      this.count('player_scores', !exists);
      if (!exists && (r.type === 1 || r.type === 2)) this.scoreEvents(playerId, r.type, statTime, row.points, row.status);
    }
  }

  private spy(r: SpyReportRecord) {
    const time = this.epoch(r.reportTime);
    if (!time) return;
    const playerId = r.playerName ? this.findPlayerByName(r.playerName) : null;
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO spy_reports (group_id, user_id, msg_id, g, s, p, planet_type, planet_name, player_name, player_id,
           report_time, sections, destroy_chance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.t.groupId, this.t.userId, r.msgId, r.coords.g, r.coords.s, r.coords.p, r.planetType, r.planetName,
        r.playerName, playerId, time, JSON.stringify(r.sections), r.destroyChance,
      );
    this.count('spy_reports', res.changes > 0);
    if (res.changes > 0 && r.planetType === 'moon' && r.sections[0]) this.phalanxEvent(r, time, playerId);
    if ((r.planetType === 'planet' || r.planetType === 'moon') && this.newestAt(r.coords, time)) {
      this.upsertPlanet(r.coords.g, r.coords.s, r.coords.p, {
        name: r.planetType === 'planet' ? r.planetName : null,
        moonName: r.planetType === 'moon' ? r.planetName : null,
        playerId,
        hasMoon: r.planetType === 'moon' ? 1 : null,
      });
    }
  }

  /**
   * Point loss (total) / fleet loss against the previous snapshot, and for the total points how long
   * a player has not grown: logged once when 6/12/18/24 h without growth are reached.
   */
  scoreEvents(playerId: number, type: number, statTime: number, points: number, status: string[]) {
    const history = this.db
      .prepare(
        `SELECT ps.points, s.stat_time FROM player_scores ps JOIN stat_snapshots s ON s.id = ps.snapshot_id
         WHERE ps.player_id = ? AND s.type = ? AND s.stat_time < ? ORDER BY s.stat_time DESC LIMIT 40`,
      )
      .all(playerId, type, statTime) as { points: number; stat_time: number }[];
    if (!history.length) return;
    const prev = history[0];
    if (points < prev.points) {
      this.log(type === 1 ? 'points_loss' : 'fleet_loss', statTime, null, null, playerId, {
        points, before: prev.points, delta: points - prev.points, since: prev.stat_time,
      });
    }
    if (type !== 1 || status.some((x) => x === 'inactive' || x === 'longinactive' || x === 'vacation')) return;
    // stagnation: walk back while the points did not increase
    let since = statTime;
    let next = points;
    for (const h of history) {
      if (h.points < next) break;
      since = h.stat_time;
      next = h.points;
    }
    const hours = (statTime - since) / 3600;
    const prevHours = (prev.stat_time - since) / 3600;
    const step = [24, 18, 12, 6].find((w) => hours >= w - 0.25);
    if (step && prevHours < step - 0.25) {
      this.log('no_growth', statTime, null, null, playerId, { hours: step, since, points }, `no_growth:${playerId}:${step}:${since}`);
    }
  }

  /** New or upgraded sensor phalanx compared to the previous moon report that showed the buildings. */
  phalanxEvent(r: SpyReportRecord, time: number, playerId: number | null) {
    const level = r.sections[0]?.[42] ?? 0;
    const prev = this.db
      .prepare(
        `SELECT sections FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = 'moon' AND report_time < ?
           AND sections LIKE '%"0":%' ORDER BY report_time DESC LIMIT 1`,
      )
      .pluck()
      .get(this.t.groupId, r.coords.g, r.coords.s, r.coords.p, time) as string | undefined;
    const before = prev ? ((JSON.parse(prev) as Record<string, Record<string, number>>)['0']?.['42'] ?? 0) : null;
    if (level > 0 && !before) {
      this.log('phalanx_new', time, r.coords, 'moon', playerId, { level, known: before != null });
    } else if (before != null && level > before) {
      this.log('phalanx_up', time, r.coords, 'moon', playerId, { level, before });
    }
  }

  private log(
    kind: string, time: number, coords: { g: number; s: number; p: number } | null, planetType: string | null,
    playerId: number | null, data: Record<string, unknown>, key = `${kind}:${coords ? `${coords.g}:${coords.s}:${coords.p}:${planetType}` : ''}:${playerId}:${time}`,
  ) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO activity_log (group_id, time, kind, g, s, p, planet_type, player_id, data, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.t.groupId, time, kind, coords?.g ?? null, coords?.s ?? null, coords?.p ?? null, planetType, playerId, JSON.stringify(data), key);
  }

  /** Current or former name (like `player()`), without creating a player. */
  private findPlayerByName(name: string): number | null {
    const db = this.db;
    return (
      (db
        .prepare('SELECT id FROM players WHERE group_id = ? AND name = ? COLLATE NOCASE ORDER BY last_seen DESC')
        .pluck()
        .get(this.t.groupId, name) as number | undefined) ??
      (db
        .prepare(
          `SELECT p.id FROM player_aliases a JOIN players p ON p.id = a.player_id
           WHERE p.group_id = ? AND a.name = ? COLLATE NOCASE ORDER BY a.seen_until DESC`,
        )
        .pluck()
        .get(this.t.groupId, name) as number | undefined) ??
      null
    );
  }

  /**
   * Whether a report of `time` is the newest known state of the position: neither the system's galaxy view nor
   * another spy report is newer. An older report pasted later must not bring back a former owner or a destroyed moon.
   */
  private newestAt(c: { g: number; s: number; p: number }, time: number): boolean {
    const seen = this.db.prepare('SELECT seen_at FROM galaxy_views WHERE group_id = ? AND g = ? AND s = ?').pluck().get(this.t.groupId, c.g, c.s) as
      | number
      | undefined;
    if (seen != null && seen >= time) return false;
    return !this.db
      .prepare('SELECT 1 FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND report_time > ?')
      .get(this.t.groupId, c.g, c.s, c.p, time);
  }

  private upsertPlanet(
    g: number, s: number, p: number,
    v: { name: string | null; moonName?: string | null; playerId: number | null; hasMoon: number | null },
  ) {
    this.db
      .prepare(
        `INSERT INTO planets (group_id, g, s, p, name, moon_name, player_id, has_moon) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0))
         ON CONFLICT (group_id, g, s, p) DO UPDATE SET
           name = COALESCE(excluded.name, name),
           moon_name = COALESCE(excluded.moon_name, moon_name),
           player_id = COALESCE(excluded.player_id, player_id),
           has_moon = MAX(has_moon, excluded.has_moon),
           updated_at = unixepoch()`,
      )
      .run(this.t.groupId, g, s, p, v.name, v.moonName ?? null, v.playerId, v.hasMoon);
  }

  /**
   * The same message synced once as HTML (with message id) and once as text (without) has different dedupe
   * keys: finds the stored row with the same content instead. Rows with different message ids stay apart
   * (two expeditions with the same result in the same second). Fills in what the stored row lacks.
   */
  private sameContent(table: string, content: Record<string, unknown>, msgId: number | null, fill: Record<string, unknown> = {}) {
    const cols = Object.keys(content);
    const id = this.db
      .prepare(
        `SELECT id FROM ${table} WHERE group_id = ? AND ${cols.map((c) => `${c} IS ?`).join(' AND ')}
         AND (msg_id IS NULL OR ? IS NULL OR msg_id = ?) AND dedupe_key NOT LIKE 'manual:%' LIMIT 1`,
      )
      .pluck()
      .get(this.t.groupId, ...Object.values(content), msgId, msgId) as number | undefined;
    if (id == null) return false;
    const set = { msg_id: msgId, ...fill };
    this.db
      .prepare(`UPDATE ${table} SET ${Object.keys(set).map((c) => `${c} = COALESCE(${c}, ?)`).join(', ')} WHERE id = ?`)
      .run(...Object.values(set), id);
    return true;
  }

  private battle(r: BattleRecord) {
    const time = this.epoch(r.time);
    const content = {
      user_id: this.t.userId, time, g: r.coords.g, s: r.coords.s, p: r.coords.p, planet_type: r.planetType,
      lost_attacker: r.lostAttacker, lost_defender: r.lostDefender, loot_metal: r.loot.metal, loot_crystal: r.loot.crystal,
      loot_deuterium: r.loot.deuterium, debris_metal: r.debris.metal, debris_crystal: r.debris.crystal,
    };
    if (this.sameContent('battle_reports', content, r.msgId, { report_id: r.reportId, outcome: r.outcome })) {
      return this.count('battle_reports', false);
    }
    const key =
      r.reportId ??
      (r.msgId ? `m${r.msgId}` : `h${fnv1a(JSON.stringify([r.time, r.coords, r.lostAttacker, r.lostDefender, r.loot, r.debris]))}`);
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO battle_reports (group_id, user_id, dedupe_key, msg_id, report_id, time, g, s, p, planet_type, outcome,
           lost_attacker, lost_defender, loot_metal, loot_crystal, loot_deuterium, debris_metal, debris_crystal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.t.groupId, this.t.userId, key, r.msgId, r.reportId, time, r.coords.g, r.coords.s, r.coords.p, r.planetType,
        r.outcome, r.lostAttacker, r.lostDefender, r.loot.metal, r.loot.crystal, r.loot.deuterium, r.debris.metal, r.debris.crystal,
      );
    this.count('battle_reports', res.changes > 0);
  }

  private expedition(r: ExpeditionRecord) {
    const time = this.epoch(r.time);
    const content = {
      user_id: this.t.userId, time, g: r.coords?.g ?? null, s: r.coords?.s ?? null, p: r.coords?.p ?? null, event: r.event, size: r.size,
      factor: r.factor, found_resources: JSON.stringify(r.foundResources), found_ships: JSON.stringify(r.foundShips),
    };
    if (this.sameContent('expeditions', content, r.msgId, { depletion: r.depletion })) return this.count('expeditions', false);
    const key = r.msgId
      ? `m${r.msgId}`
      : `h${fnv1a(JSON.stringify([r.time, r.coords, r.event, r.size, r.factor, r.foundResources, r.foundShips]))}`;
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO expeditions (group_id, user_id, dedupe_key, msg_id, time, g, s, p, event, size, factor, depletion,
           found_resources, found_ships) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.t.groupId, this.t.userId, key, r.msgId, time, r.coords?.g ?? null, r.coords?.s ?? null, r.coords?.p ?? null,
        r.event, r.size, r.factor, r.depletion, JSON.stringify(r.foundResources), JSON.stringify(r.foundShips),
      );
    this.count('expeditions', res.changes > 0);
  }

  private hostile(r: HostileSpyRecord) {
    const time = this.epoch(r.time);
    const content = {
      time, from_player: r.fromPlayerName, from_g: r.fromCoords.g, from_s: r.fromCoords.s, from_p: r.fromCoords.p,
      target_g: r.targetCoords.g, target_s: r.targetCoords.s, target_p: r.targetCoords.p,
    };
    if (this.sameContent('hostile_spying', content, r.msgId)) return this.count('hostile_spying', false);
    const key = r.msgId ? `m${r.msgId}` : `h${fnv1a(JSON.stringify([r.time, r.fromCoords, r.targetCoords, r.fromPlayerName]))}`;
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO hostile_spying (group_id, user_id, dedupe_key, msg_id, time, from_player, from_planet, from_g, from_s, from_p,
           from_type, target_planet, target_g, target_s, target_p, target_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.t.groupId, this.t.userId, key, r.msgId, time, r.fromPlayerName, r.fromPlanetName, r.fromCoords.g, r.fromCoords.s,
        r.fromCoords.p, r.fromType, r.targetPlanetName, r.targetCoords.g, r.targetCoords.s, r.targetCoords.p, r.targetType,
      );
    this.count('hostile_spying', res.changes > 0);
  }

  private galaxy(r: GalaxyRecord) {
    const db = this.db;
    const seenAt = r.seenAt ?? now();
    // Never overwrite a fresher view with older data (e.g. an old universe.json).
    const known = db.prepare('SELECT seen_at FROM galaxy_views WHERE group_id = ? AND g = ? AND s = ?').pluck().get(this.t.groupId, r.g, r.s) as
      | number
      | undefined;
    if (known != null && known > seenAt) {
      this.count('galaxy_systems', false);
      return;
    }
    db.prepare(
      `INSERT INTO galaxy_views (group_id, g, s, seen_at, user_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (group_id, g, s) DO UPDATE SET seen_at = excluded.seen_at, user_id = excluded.user_id`,
    ).run(this.t.groupId, r.g, r.s, seenAt, this.t.userId);

    // Planets/moons are only news when the system was known before (a first sync would report everything).
    const before = new Map(
      (db.prepare('SELECT id, p, player_id, has_moon, debris FROM planets WHERE group_id = ? AND g = ? AND s = ?').all(this.t.groupId, r.g, r.s) as {
        id: number; p: number; player_id: number | null; has_moon: number; debris: string | null;
      }[]).map((x) => [x.p, x]),
    );
    const positions = new Set(r.rows.map((row) => row.position));
    // Positions not listed anymore are empty now.
    for (const e of before.values()) {
      if (!positions.has(e.p)) db.prepare('DELETE FROM planets WHERE id = ?').run(e.id);
    }
    for (const row of r.rows) {
      // empty positions are only kept for a destroyed planet or a debris field
      if (!row.playerName && !row.playerId && !row.destroyed && !row.debris) continue;
      const playerId = row.playerName
        ? this.player(row.playerId, row.playerName, seenAt)
        : row.playerId
          ? this.playerById(row.playerId, seenAt)
          : null;
      if (playerId) {
        const allyId = this.alliance(row.allyId, row.allyName ?? null, row.allyTag);
        db.prepare('UPDATE players SET alliance_id = ? WHERE id = ? AND last_seen <= ?').run(allyId, playerId, seenAt);
        this.playerStatus(playerId, row.status, seenAt);
      }
      db.prepare(
        `INSERT INTO planets (group_id, g, s, p, name, player_id, has_moon, moon_name, destroyed, debris, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (group_id, g, s, p) DO UPDATE SET
           name = CASE WHEN excluded.name IS NULL AND player_id IS excluded.player_id THEN name ELSE excluded.name END, player_id = excluded.player_id,
           -- universe.json has no moon names: keep the known one while owner and moon stay the same
           moon_name = CASE WHEN excluded.has_moon = 1 AND excluded.moon_name IS NULL AND player_id IS excluded.player_id THEN moon_name ELSE excluded.moon_name END,
           has_moon = excluded.has_moon, destroyed = excluded.destroyed, debris = excluded.debris, updated_at = excluded.updated_at`,
      ).run(
        this.t.groupId, r.g, r.s, row.position, row.planetName || null, playerId, row.moon ? 1 : 0, (row.moon && row.moonName) || null,
        row.destroyed ? 1 : 0, row.debris ? JSON.stringify(row.debris) : null, seenAt,
      );
      const prev = before.get(row.position);
      const c = { g: r.g, s: r.s, p: row.position };
      if (known != null) {
        if (playerId && !prev?.player_id) this.log('planet_new', seenAt, c, 'planet', playerId, { name: row.planetName || null });
        if (playerId && row.moon && !prev?.has_moon) this.log('moon_new', seenAt, c, 'moon', playerId, {});
      }
      this.debrisEvent(c, seenAt, playerId, prev?.debris ?? null, row.debris, known == null);
    }
    // debris fields that disappeared
    for (const [p, prev] of before) {
      if (prev.debris && !r.rows.some((row) => row.position === p && row.debris)) {
        this.debrisEvent({ g: r.g, s: r.s, p }, seenAt, prev.player_id, prev.debris, null, false);
      }
    }
    this.count('galaxy_systems', true);
  }

  /** A debris field without known history (backfill). */
  debrisSeen(c: { g: number; s: number; p: number }, time: number, playerId: number | null, debris: { metal: string; crystal: string }) {
    this.debrisEvent(c, time, playerId, null, debris, true);
  }

  /** Debris field compared to the last known state: new (or first seen), grown, reduced or cleared. */
  private debrisEvent(
    c: { g: number; s: number; p: number }, time: number, playerId: number | null,
    prevJson: string | null, now: { metal: string; crystal: string } | null, firstSeen: boolean,
  ) {
    const prevRaw = prevJson ? (JSON.parse(prevJson) as { metal: string; crystal: string }) : null;
    const prev = prevRaw ? { metal: debrisAmount(prevRaw.metal), crystal: debrisAmount(prevRaw.crystal) } : null;
    const cur = now ? { metal: debrisAmount(now.metal), crystal: debrisAmount(now.crystal) } : null;
    const sum = (d: { metal: number; crystal: number }) => d.metal + d.crystal;
    if (cur && sum(cur) > 0 && (!prev || sum(prev) === 0)) {
      this.log('debris_new', time, c, null, playerId, { ...cur, firstSeen });
    } else if (cur && prev && sum(cur) > sum(prev)) {
      this.log('debris_grown', time, c, null, playerId, { ...cur, before: prev, delta: sum(cur) - sum(prev) });
    } else if (cur && prev && sum(cur) < sum(prev) && sum(cur) > 0) {
      this.log('debris_shrunk', time, c, null, playerId, { ...cur, before: prev, delta: sum(cur) - sum(prev) });
    } else if (prev && sum(prev) > 0 && (!cur || sum(cur) === 0)) {
      this.log('debris_cleared', time, c, null, playerId, { before: prev });
    }
  }

  private empire(r: EmpireRecord) {
    this.linkIngameName(r);
    // names of the member's own moons (only for positions known from the galaxy)
    for (const p of r.planets) {
      if (p.type !== 'moon' || !p.name) continue;
      this.db
        .prepare('UPDATE planets SET moon_name = ?, has_moon = 1 WHERE group_id = ? AND g = ? AND s = ? AND p = ?')
        .run(p.name, this.t.groupId, p.coords.g, p.coords.s, p.coords.p);
    }
    // page time (server clock) when known: the live view calculates from it
    this.db
      .prepare('INSERT INTO empire_snapshots (group_id, user_id, created_at, data) VALUES (?, ?, ?, ?)')
      .run(this.t.groupId, this.t.userId, this.epoch(r.pageTime ?? null) ?? now(), JSON.stringify(r));
    // Only the newest page is shown; the live fleet in the imperium also needs the first page after the last fleet
    // statistics update, which the last week covers. Older pages are never read.
    this.db
      .prepare(
        `DELETE FROM empire_snapshots WHERE group_id = ? AND user_id = ? AND created_at < ?
         AND id <> (SELECT id FROM empire_snapshots WHERE group_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1)`,
      )
      .run(this.t.groupId, this.t.userId, now() - EMPIRE_KEEP, this.t.groupId, this.t.userId);
    this.count('empire', true);
  }

  /** The member's in-game name: owner of their planets according to the galaxy data. */
  private linkIngameName(r: EmpireRecord) {
    for (const p of r.planets) {
      const name = this.db
        .prepare('SELECT pl.name FROM planets x JOIN players pl ON pl.id = x.player_id WHERE x.group_id = ? AND x.g = ? AND x.s = ? AND x.p = ?')
        .pluck()
        .get(this.t.groupId, p.coords.g, p.coords.s, p.coords.p) as string | undefined;
      if (!name) continue;
      this.db.prepare('UPDATE group_members SET ingame_name = ? WHERE group_id = ? AND user_id = ?').run(name, this.t.groupId, this.t.userId);
      return;
    }
  }

  private recycle(r: RecycleRecord) {
    const key = r.msgId ? `m${r.msgId}` : `r${fnv1a(JSON.stringify([r.time, r.coords, r.metal, r.crystal, r.totalMetal, r.totalCrystal]))}`;
    const time = this.epoch(r.time);
    const content = {
      user_id: this.t.userId, time, g: r.coords.g, s: r.coords.s, p: r.coords.p,
      metal: r.metal, crystal: r.crystal, total_metal: r.totalMetal, total_crystal: r.totalCrystal,
    };
    if (this.sameContent('recycle_reports', content, r.msgId)) return this.count('recycle_reports', false);
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO recycle_reports (group_id, user_id, dedupe_key, msg_id, time, g, s, p, metal, crystal, total_metal, total_crystal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.t.groupId, this.t.userId, key, r.msgId, time, r.coords.g, r.coords.s, r.coords.p,
        r.metal, r.crystal, r.totalMetal, r.totalCrystal,
      );
    this.count('recycle_reports', res.changes > 0);
    if (!res.changes || !time) return;
    this.recycleEvent(r, time, this.t.userId, key);
  }

  /** Debris reduced/cleared by a member's recyclers (exact amounts), also used by the backfill. */
  recycleEvent(r: RecycleRecord, time: number, userId: number | null, key: string) {
    const left = { metal: Math.max(0, r.totalMetal - r.metal), crystal: Math.max(0, r.totalCrystal - r.crystal) };
    const by = this.db
      .prepare('SELECT COALESCE(m.ingame_name, u.username) FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND m.user_id = ?')
      .pluck()
      .get(this.t.groupId, userId) as string | undefined;
    const data = { ...left, before: { metal: r.totalMetal, crystal: r.totalCrystal }, collected: { metal: r.metal, crystal: r.crystal }, by: by ?? null };
    this.log(left.metal + left.crystal > 0 ? 'debris_shrunk' : 'debris_cleared', time, r.coords, null, null, data, `recycle:${key}`);
    // exact remaining debris for the galaxy view, unless the galaxy was seen after the recycling
    const seen = this.db.prepare('SELECT seen_at FROM galaxy_views WHERE group_id = ? AND g = ? AND s = ?').pluck().get(this.t.groupId, r.coords.g, r.coords.s) as
      | number
      | undefined;
    if (seen == null || seen <= time) {
      this.db
        .prepare('UPDATE planets SET debris = ? WHERE group_id = ? AND g = ? AND s = ? AND p = ?')
        .run(
          left.metal + left.crystal > 0 ? JSON.stringify({ metal: String(left.metal), crystal: String(left.crystal) }) : null,
          this.t.groupId, r.coords.g, r.coords.s, r.coords.p,
        );
    }
  }

  private battleHall(r: BattleHallRecord) {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO battle_hall (group_id, report_id, time, attackers, defenders, winner, units) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of r.entries) {
      const res = insert.run(
        this.t.groupId, e.reportId, this.epoch(e.time), JSON.stringify(e.attackers), JSON.stringify(e.defenders), e.winner, e.units,
      );
      this.count('battle_hall', res.changes > 0);
    }
  }

  /** Pasted/synced report page: archived like the crawler does (needs the report id from the URL). */
  private combatReport(r: CombatReportRecord) {
    if (!r.reportId) {
      this.summary.warnings.push('battle_report_no_id');
      return;
    }
    this.count('combat_reports', storeCombatReport(this.db, this.t.groupId, r, this.epoch(r.time)));
  }

  private overview(r: OverviewRecord) {
    this.db
      .prepare('INSERT INTO overview_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)')
      .run(this.t.groupId, this.t.userId, this.epoch(r.pageTime) ?? now(), JSON.stringify(r));
    // only the newest overview page is ever read (live view)
    this.db
      .prepare(
        `DELETE FROM overview_snapshots WHERE group_id = ? AND user_id = ?
         AND id <> (SELECT id FROM overview_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC LIMIT 1)`,
      )
      .run(this.t.groupId, this.t.userId, this.t.groupId, this.t.userId);
    this.count('overview', true);
  }
}

/** Stores a battle report compactly; returns false when it was already archived. */
export function storeCombatReport(db: DB, groupId: number, r: CombatReportRecord, time: number | null): boolean {
  const fleets = r.fleets.map((f) => [
    f.side === 'attacker' ? 0 : 1,
    f.name,
    Object.entries(f.start).map(([id, n]) => [Number(id), n, f.end[Number(id)] ?? 0]),
  ]);
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(groupId, r.reportId, time, r.winner, r.rounds, r.lost.attacker, r.lost.defender, r.debris.metal, r.debris.crystal, JSON.stringify(fleets));
  db.prepare("UPDATE battle_hall SET report_status = 'archived' WHERE group_id = ? AND report_id = ?").run(groupId, r.reportId);
  return res.changes > 0;
}
