import {
  debrisAmount,
  fnv1a,
  localToEpoch,
  nearestClock,
  type BattleHallRecord,
  type BattleRecord,
  type BuildingsRecord,
  type ResearchRecord,
  type CombatReportRecord,
  type EmpireRecord,
  type ExpeditionRecord,
  type FleetReturnRecord,
  type FleetsRecord,
  type GalaxyRecord,
  type HostileSpyRecord,
  type HubRecord,
  type OverviewRecord,
  type PlayerMessageRecord,
  type RecycleRecord,
  type SpyReportRecord,
  type StatsRecord,
} from '@pr0hub/core';
import { CLASS_BUILDINGS, PHALANX } from '@pr0hub/core/tech';
import { now, type DB } from './db.js';
import type { IngestSummary, IngestTarget } from './ingest.js';
import { fleetActivity, galaxyMark } from './repo/activity.js';
import { FLEET_HISTORY } from './repo/fleets.js';
import { Players } from './repo/players.js';

/** Empire pages are kept a week (besides the newest), see `empire()`. */
const EMPIRE_KEEP = 7 * 86400;

/** Writes parsed records of one sync into the group's tables (and the activity log). */
export class Store {
  private players: Players;

  constructor(
    private db: DB,
    private t: IngestTarget,
    private summary: IngestSummary,
  ) {
    this.players = new Players(db, t.groupId);
  }

  private count(kind: string, isNew: boolean) {
    const c = (this.summary.counts[kind] ??= { new: 0, duplicate: 0 });
    if (isNew) c.new++;
    else c.duplicate++;
  }

  private epoch(local: string | null): number | null {
    // a time of the hour repeated in autumn: the one of its two instants that is already past
    return local ? localToEpoch(local, this.t.timezone, now()) : null;
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
      case 'buildings':
        return this.buildings(r);
      case 'research':
        return this.research(r);
      case 'fleets':
        return this.fleets(r);
      case 'recycle':
        return this.recycle(r);
      case 'fleetReturn':
        return this.fleetReturn(r);
      case 'playerMessage':
        return this.playerMessage(r);
      case 'battleHall':
        return this.battleHall(r);
      case 'combatReport':
        return this.combatReport(r);
    }
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
        const allyId = this.players.alliance(row.ingameId, row.name);
        const res = db
          .prepare('INSERT OR IGNORE INTO alliance_scores (snapshot_id, alliance_id, rank, rank_change, points, members) VALUES (?, ?, ?, ?, ?, ?)')
          .run(snapshotId, allyId, row.rank, row.rankChange, row.points, row.members ?? null);
        this.count('alliance_scores', res.changes > 0);
        continue;
      }
      const playerId = this.players.player(row.ingameId, row.name, statTime);
      const allyId = this.players.alliance(row.allyId, row.allyName);
      db.prepare('UPDATE players SET alliance_id = ? WHERE id = ? AND last_seen <= ?').run(allyId, playerId, statTime);
      this.players.playerStatus(playerId, row.status, statTime);
      const exists = db.prepare('SELECT 1 FROM player_scores WHERE snapshot_id = ? AND player_id = ?').get(snapshotId, playerId);
      db.prepare(
        `INSERT INTO player_scores (snapshot_id, player_id, rank, rank_change, points, title, type, stat_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (snapshot_id, player_id) DO UPDATE SET rank_change = COALESCE(excluded.rank_change, rank_change),
           title = COALESCE(excluded.title, title)`,
      ).run(snapshotId, playerId, row.rank, row.rankChange, row.points, row.title ?? null, r.type, statTime);
      this.count('player_scores', !exists);
      if (!exists && (r.type === 1 || r.type === 2)) this.scoreEvents(playerId, r.type, statTime, row.points, row.status);
    }
  }

  private spy(r: SpyReportRecord) {
    const time = this.epoch(r.reportTime);
    if (!time) return;
    const playerId = r.playerName ? this.players.byName(r.playerName) : null;
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
        'SELECT points, stat_time FROM player_scores WHERE player_id = ? AND type = ? AND stat_time < ? ORDER BY stat_time DESC LIMIT 40',
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
    const level = r.sections[CLASS_BUILDINGS]?.[PHALANX] ?? 0;
    const prev = this.db
      .prepare(
        `SELECT sections FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = 'moon' AND report_time < ?
           AND json_extract(sections, '$."0"') IS NOT NULL ORDER BY report_time DESC LIMIT 1`,
      )
      .pluck()
      .get(this.t.groupId, r.coords.g, r.coords.s, r.coords.p, time) as string | undefined;
    const before = prev ? ((JSON.parse(prev) as Record<string, Record<string, number>>)[CLASS_BUILDINGS]?.[PHALANX] ?? 0) : null;
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
        ? this.players.player(row.playerId, row.playerName, seenAt)
        : row.playerId
          ? this.players.playerById(row.playerId, seenAt)
          : null;
      if (playerId) {
        const allyId = this.players.alliance(row.allyId, row.allyName ?? null, row.allyTag);
        db.prepare('UPDATE players SET alliance_id = ? WHERE id = ? AND last_seen <= ?').run(allyId, playerId, seenAt);
        this.players.playerStatus(playerId, row.status, seenAt);
        if (row.activity != null) galaxyMark(db, this.t.groupId, playerId, { g: r.g, s: r.s, p: row.position }, row.activity, seenAt);
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

  /** Kept per member (visibility follows their sharing setting); the key is the same for the sender's and the recipient's copy. */
  private playerMessage(r: PlayerMessageRecord) {
    const time = this.epoch(r.time);
    if (!time) return;
    const coords = (c: { g: number; s: number; p: number } | null) => (c ? `${c.g}:${c.s}:${c.p}` : null);
    const to = r.to.map((p) => ({ name: p.name, coords: coords(p.coords) }));
    // whitespace differs between an HTML and a plain text copy
    const key = fnv1a(JSON.stringify([time, r.from.name, to.map((p) => p.name), r.subject, r.body.replace(/\s+/g, ' ')]));
    const exists = this.db
      .prepare('SELECT 1 FROM player_messages WHERE group_id = ? AND user_id = ? AND dedupe_key = ?')
      .get(this.t.groupId, this.t.userId, key);
    // a later HTML copy of a message first pasted as text adds what only the HTML has
    this.db
      .prepare(
        `INSERT INTO player_messages (group_id, user_id, dedupe_key, msg_id, time, from_name, from_coords, recipients, subject, body, thread, partner_ingame_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (group_id, user_id, dedupe_key) DO UPDATE SET msg_id = COALESCE(msg_id, excluded.msg_id),
           thread = COALESCE(thread, excluded.thread), partner_ingame_id = COALESCE(partner_ingame_id, excluded.partner_ingame_id)`,
      )
      .run(
        this.t.groupId, this.t.userId, key, r.msgId, time, r.from.name, coords(r.from.coords), JSON.stringify(to), r.subject, r.body,
        r.thread, r.partnerId,
      );
    this.count('player_messages', !exists);
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

  /** Fleet return message of an attack: what the fleet brings home. */
  private fleetReturn(r: FleetReturnRecord) {
    const key = r.msgId ? `m${r.msgId}` : `f${fnv1a(JSON.stringify([r.time, r.target, r.home, r.metal, r.crystal, r.deuterium]))}`;
    const time = this.epoch(r.time);
    const content = {
      user_id: this.t.userId, time, g: r.target.g, s: r.target.s, p: r.target.p, home_g: r.home.g, home_s: r.home.s, home_p: r.home.p,
      metal: r.metal, crystal: r.crystal, deuterium: r.deuterium,
    };
    if (this.sameContent('fleet_returns', content, r.msgId)) return this.count('fleet_returns', false);
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO fleet_returns (group_id, user_id, dedupe_key, msg_id, time, g, s, p, home_g, home_s, home_p, metal, crystal, deuterium)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.t.groupId, this.t.userId, key, r.msgId, time, r.target.g, r.target.s, r.target.p, r.home.g, r.home.s, r.home.p,
        r.metal, r.crystal, r.deuterium,
      );
    this.count('fleet_returns', res.changes > 0);
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

  /**
   * Pasted/synced report page: archived like the crawler does. Without the report id (copied text) it takes the id of
   * the group's battle message at the same target and time (same loot when both show it), else a local id from the
   * target and time; without target and id it cannot be told apart and is skipped.
   */
  private combatReport(r: CombatReportRecord) {
    const time = this.epoch(r.time);
    let id = r.reportId;
    if (!id && r.target && time != null) {
      const { g, s, p } = r.target.coords;
      id =
        (this.db
          .prepare(
            `SELECT report_id FROM battle_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ? AND report_id IS NOT NULL
               AND time BETWEEN ? AND ? AND ((loot_metal = ? AND loot_crystal = ? AND loot_deuterium = ?) OR loot_metal + loot_crystal + loot_deuterium = 0)
             ORDER BY ABS(time - ?) LIMIT 1`,
          )
          .pluck()
          .get(this.t.groupId, g, s, p, r.target.type, time - REPORT_SLACK, time + REPORT_SLACK, r.loot.metal, r.loot.crystal, r.loot.deuterium, time) as
          | string
          | undefined) ??
        // the same battle archived from its public page (coordinates hidden until a paste fills them): same time and losses
        (this.db
          .prepare(
            `SELECT report_id FROM combat_reports WHERE group_id = ? AND (g IS NULL OR (g = ? AND s = ? AND p = ? AND planet_type = ?))
               AND time BETWEEN ? AND ? AND lost_attacker = ? AND lost_defender = ?
             ORDER BY ABS(time - ?) LIMIT 1`,
          )
          .pluck()
          .get(this.t.groupId, g, s, p, r.target.type, time - REPORT_SLACK, time + REPORT_SLACK, r.lost.attacker, r.lost.defender, time) as
          | string
          | undefined) ??
        `text-${time}-${g}-${s}-${p}`;
    }
    if (!id) {
      this.summary.warnings.push('battle_report_no_id');
      return;
    }
    this.count('combat_reports', storeCombatReport(this.db, this.t.groupId, { ...r, reportId: id }, time));
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

  /** Buildings page of one planet/moon: only the newest per planet is ever read. */
  private buildings(r: BuildingsRecord) {
    this.planetPage('building_snapshots', r);
    this.count('buildings', true);
  }

  /** Research page of one planet: only the newest per planet is ever read. */
  private research(r: ResearchRecord) {
    this.planetPage('research_snapshots', r);
    this.count('research', true);
  }

  /** Stores a page of one planet and keeps only the newest of that planet. */
  private planetPage(table: 'building_snapshots' | 'research_snapshots', r: BuildingsRecord | ResearchRecord) {
    const { g, s, p } = r.coords;
    this.db
      .prepare(`INSERT INTO ${table} (group_id, user_id, g, s, p, planet_type, page_time, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(this.t.groupId, this.t.userId, g, s, p, r.type, this.epoch(r.pageTime) ?? now(), JSON.stringify(r));
    this.db
      .prepare(
        `DELETE FROM ${table} WHERE group_id = ? AND user_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ?
         AND id <> (SELECT id FROM ${table} WHERE group_id = ? AND user_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ?
                    ORDER BY page_time DESC, id DESC LIMIT 1)`,
      )
      .run(this.t.groupId, this.t.userId, g, s, p, r.type, this.t.groupId, this.t.userId, g, s, p, r.type);
  }

  /**
   * Fleet list of the member; arrivals from the remaining time, set to the shown clock when copied as text. The lists of
   * the last 12 hours are kept for the history, and the newest one before that (it holds the fleets arriving after it).
   */
  private fleets(r: FleetsRecord) {
    const pageTime = this.epoch(r.pageTime) ?? now();
    const fleets = r.fleets.map((f) => {
      const approx = pageTime + f.seconds;
      return { ...f, arrival: f.clock ? nearestClock(approx, f.clock, this.t.timezone) : approx };
    });
    const prev = this.db
      .prepare('SELECT page_time AS time, data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? AND page_time < ? ORDER BY page_time DESC, id DESC LIMIT 1')
      .get(this.t.groupId, this.t.userId, pageTime) as { time: number; data: string } | undefined;
    fleetActivity(this.db, this.t.groupId, this.t.userId, prev ? { time: prev.time, data: JSON.parse(prev.data) } : null, { time: pageTime, data: fleets });
    this.db
      .prepare('INSERT INTO fleet_snapshots (group_id, user_id, page_time, data) VALUES (?, ?, ?, ?)')
      .run(this.t.groupId, this.t.userId, pageTime, JSON.stringify(fleets));
    const cutoff = now() - FLEET_HISTORY;
    this.db
      .prepare(
        `DELETE FROM fleet_snapshots WHERE group_id = ? AND user_id = ? AND page_time < ?
         AND id <> (SELECT id FROM fleet_snapshots WHERE group_id = ? AND user_id = ? AND page_time < ? ORDER BY page_time DESC, id DESC LIMIT 1)`,
      )
      .run(this.t.groupId, this.t.userId, cutoff, this.t.groupId, this.t.userId, cutoff);
    this.count('fleets', true);
  }
}

/** Seconds a battle report and its battle message may lie apart. */
export const REPORT_SLACK = 5;

/**
 * Stores a battle report compactly. An archived report gets what it lacked (the target hidden on the public page, the
 * loot of reports archived before it was read); returns false when it was already archived with nothing to add.
 * A report with its game id takes over the same battle pasted as text earlier (local id, same time and losses).
 */
export function storeCombatReport(db: DB, groupId: number, r: CombatReportRecord, time: number | null): boolean {
  let renamed = false;
  if (r.reportId && !r.reportId.startsWith('text-') && time != null) {
    const exists = db.prepare('SELECT 1 FROM combat_reports WHERE group_id = ? AND report_id = ?').get(groupId, r.reportId);
    const local = exists
      ? undefined
      : (db
          .prepare(
            `SELECT report_id FROM combat_reports WHERE group_id = ? AND report_id LIKE 'text-%' AND time BETWEEN ? AND ?
               AND lost_attacker = ? AND lost_defender = ? ORDER BY ABS(time - ?) LIMIT 1`,
          )
          .pluck()
          .get(groupId, time - REPORT_SLACK, time + REPORT_SLACK, r.lost.attacker, r.lost.defender, time) as string | undefined);
    if (local) {
      db.prepare('UPDATE combat_reports SET report_id = ? WHERE group_id = ? AND report_id = ?').run(r.reportId, groupId, local);
      renamed = true;
    }
  }
  const fleets = r.fleets.map((f) => [
    f.side === 'attacker' ? 0 : 1,
    f.name,
    Object.entries(f.start).map(([id, n]) => [Number(id), n, f.end[Number(id)] ?? 0]),
  ]);
  const res = db
    .prepare(
      `INSERT INTO combat_reports (group_id, report_id, time, winner, rounds, lost_attacker, lost_defender, debris_metal, debris_crystal, fleets,
         loot_metal, loot_crystal, loot_deuterium, g, s, p, planet_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (group_id, report_id) DO UPDATE SET
         g = COALESCE(g, excluded.g), s = COALESCE(s, excluded.s), p = COALESCE(p, excluded.p),
         planet_type = COALESCE(planet_type, excluded.planet_type),
         loot_metal = IIF(loot_metal + loot_crystal + loot_deuterium = 0, excluded.loot_metal, loot_metal),
         loot_crystal = IIF(loot_metal + loot_crystal + loot_deuterium = 0, excluded.loot_crystal, loot_crystal),
         loot_deuterium = IIF(loot_metal + loot_crystal + loot_deuterium = 0, excluded.loot_deuterium, loot_deuterium)
       WHERE (g IS NULL AND excluded.g IS NOT NULL)
         OR (loot_metal + loot_crystal + loot_deuterium = 0 AND excluded.loot_metal + excluded.loot_crystal + excluded.loot_deuterium > 0)`,
    )
    .run(
      groupId, r.reportId, time, r.winner, r.rounds, r.lost.attacker, r.lost.defender, r.debris.metal, r.debris.crystal, JSON.stringify(fleets),
      r.loot.metal, r.loot.crystal, r.loot.deuterium, r.target?.coords.g ?? null, r.target?.coords.s ?? null, r.target?.coords.p ?? null,
      r.target?.type ?? null,
    );
  db.prepare("UPDATE battle_hall SET report_status = 'archived' WHERE group_id = ? AND report_id = ?").run(groupId, r.reportId);
  return renamed || res.changes > 0;
}
