import { now, type DB } from '../db.js';
import { likeTerm } from './sql.js';

/**
 * Names of players/alliances only known by id (universe.json without names). Replaced by the real name once
 * known, never kept as a former name.
 */
export const placeholderPlayer = (ingameId: number) => `Spieler #${ingameId}`;
export const placeholderAlliance = (ingameId: number) => `Allianz #${ingameId}`;

/**
 * Players and alliances of a group: found by in-game id or (former) name, created while syncing. The sync and
 * the routes resolve names through this, so both treat aliases and upper/lower case the same.
 */
export class Players {
  constructor(
    private db: DB,
    private groupId: number,
  ) {}

  alliance(ingameId: number | null, name: string | null, tag: string | null = null): number | null {
    if (!ingameId && !name && !tag) return null;
    const db = this.db;
    let row: { id: number } | undefined;
    if (ingameId) row = db.prepare('SELECT id FROM alliances WHERE group_id = ? AND ingame_id = ?').get(this.groupId, ingameId) as typeof row;
    if (!row && name) {
      row = db
        .prepare('SELECT id FROM alliances WHERE group_id = ? AND name = ? AND (ingame_id IS NULL OR ? IS NULL)')
        .get(this.groupId, name, ingameId) as typeof row;
    }
    if (!row && tag) row = db.prepare('SELECT id FROM alliances WHERE group_id = ? AND tag = ?').get(this.groupId, tag) as typeof row;
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
        .run(this.groupId, ingameId, name ?? tag ?? placeholderAlliance(ingameId!), tag).lastInsertRowid,
    );
  }

  /**
   * Finds or creates a player. With an in-game id the id is authoritative (renames
   * are recorded as aliases); a name-only player gets the id attached once known.
   * A name-only page matches a former name only for data of the time the player still had it (see `aliasAt`):
   * a newer player who took over an abandoned name is not merged into the old one.
   */
  player(ingameId: number | null, name: string, seenAt: number): number {
    const db = this.db;
    const g = this.groupId;
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
      const alias = this.aliasAt(name, seenAt);
      if (alias != null) row = db.prepare('SELECT id, name, ingame_id, last_seen FROM players WHERE id = ?').get(alias) as Row;
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
  playerById(ingameId: number, seenAt: number): number {
    const id = this.db.prepare('SELECT id FROM players WHERE group_id = ? AND ingame_id = ?').pluck().get(this.groupId, ingameId) as number | undefined;
    return id ?? this.player(ingameId, placeholderPlayer(ingameId), seenAt);
  }

  playerStatus(playerId: number, status: string[], seenAt: number) {
    const json = JSON.stringify([...status].sort());
    const cur = this.db.prepare('SELECT status, last_seen FROM players WHERE id = ?').get(playerId) as { status: string; last_seen: number };
    // Older data pasted later must not overwrite the current status.
    if (cur.status === json || cur.last_seen > seenAt) return;
    this.db.prepare('UPDATE players SET status = ? WHERE id = ?').run(json, playerId);
    this.db.prepare('INSERT INTO player_status_log (player_id, status, seen_at) VALUES (?, ?, ?)').run(playerId, json, seenAt);
  }

  /**
   * Players known by id in a statistics snapshot, by `scoreKey`: a line without an id (plain text) with the same rank
   * and points is that player, whatever its name says (a rename the hub has not seen yet would otherwise create a
   * second player). A rank held twice with the same points decides nothing.
   */
  snapshotPlayers(snapshotId: number): Map<string, number | null> {
    const rows = this.db
      .prepare(
        `SELECT s.rank, s.points, s.player_id FROM player_scores s JOIN players p ON p.id = s.player_id
         WHERE s.snapshot_id = ? AND p.ingame_id IS NOT NULL`,
      )
      .all(snapshotId) as { rank: number; points: number; player_id: number }[];
    const known = new Map<string, number | null>();
    for (const r of rows) {
      const key = scoreKey(r.rank, r.points);
      known.set(key, known.has(key) ? null : r.player_id);
    }
    return known;
  }

  /**
   * Merges name-only doubles into the players of a statistics snapshot that are known by id: a plain-text line named
   * a player the hub knew by another name (renamed, not yet synced with its id) and created a second one. The same
   * name alone proves nothing (an abandoned name is taken over by others); a double is merged only when both hold
   * the same rank with the same points in one snapshot (which is of one type and time).
   */
  mergeDoubles(snapshotId: number): number {
    const pairs = this.db
      .prepare(
        `SELECT DISTINCT d.id AS ghost, p.id AS player
         FROM player_scores cur
         JOIN players p ON p.id = cur.player_id AND p.ingame_id IS NOT NULL
         JOIN players d ON d.group_id = p.group_id AND d.name = p.name COLLATE NOCASE AND d.ingame_id IS NULL
         WHERE cur.snapshot_id = ? AND p.group_id = ?
           AND EXISTS (SELECT 1 FROM player_scores a JOIN player_scores b
                         ON b.snapshot_id = a.snapshot_id AND b.rank = a.rank AND b.points = a.points
                       WHERE a.player_id = d.id AND b.player_id = p.id)`,
      )
      .all(snapshotId, this.groupId) as { ghost: number; player: number }[];
    let merged = 0;
    for (const { ghost, player } of pairs) if (mergePlayers(this.db, this.groupId, ghost, player)) merged++;
    return merged;
  }

  /**
   * Player who had `name` as a former name at time `at`: the alias was still seen then (`seen_until` is the time of
   * the first data with the new name). The earliest such alias wins (the era `at` falls into).
   */
  private aliasAt(name: string, at: number): number | null {
    return (
      (this.db
        .prepare(
          `SELECT p.id FROM player_aliases a JOIN players p ON p.id = a.player_id
           WHERE p.group_id = ? AND a.name = ? COLLATE NOCASE AND a.seen_until >= ? ORDER BY a.seen_until LIMIT 1`,
        )
        .pluck()
        .get(this.groupId, name, at) as number | undefined) ?? null
    );
  }

  /**
   * Current or former name, without creating a player. With `at` (time of the data) a former name only counts like
   * in `player()`; without it (search, display) any former name does, the newest first.
   */
  byName(name: string, at?: number): number | null {
    const db = this.db;
    const current = db
      .prepare('SELECT id FROM players WHERE group_id = ? AND name = ? COLLATE NOCASE ORDER BY last_seen DESC')
      .pluck()
      .get(this.groupId, name) as number | undefined;
    if (current != null) return current;
    if (at != null) return this.aliasAt(name, at);
    return (
      (db
        .prepare(
          `SELECT p.id FROM player_aliases a JOIN players p ON p.id = a.player_id
           WHERE p.group_id = ? AND a.name = ? COLLATE NOCASE ORDER BY a.seen_until DESC`,
        )
        .pluck()
        .get(this.groupId, name) as number | undefined) ?? null
    );
  }
}

/** Key of a line in a statistics snapshot, see `Players.snapshotPlayers`. */
export const scoreKey = (rank: number, points: number) => `${rank}:${points}`;

/** Every column that references `players` (scores, spy reports, plans, comments, …). */
function playerReferences(db: DB): { table: string; column: string }[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
  return tables.flatMap((t) =>
    (db.pragma(`foreign_key_list(${JSON.stringify(t)})`) as { table: string; from: string }[])
      .filter((fk) => fk.table === 'players')
      .map((fk) => ({ table: t, column: fk.from })),
  );
}

/**
 * Merges player `from` into `into` (both of the group): everything that points at `from` moves over, where both
 * have a row (e.g. a score in the same snapshot) the target's is kept. A different name of `from` stays as a former
 * name. False when the two are not different players of the group.
 */
export function mergePlayers(db: DB, groupId: number, from: number, into: number): boolean {
  type Row = { id: number; name: string; ingame_id: number | null; first_seen: number; last_seen: number };
  const both = db.prepare('SELECT id, name, ingame_id, first_seen, last_seen FROM players WHERE group_id = ? AND id IN (?, ?)').all(groupId, from, into) as Row[];
  if (from === into || both.length !== 2) return false;
  const src = both.find((p) => p.id === from)!;
  const target = both.find((p) => p.id === into)!;
  db.transaction(() => {
    for (const { table, column } of playerReferences(db)) {
      db.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`).run(into, from);
    }
    if (src.name.toLowerCase() !== target.name.toLowerCase()) {
      db.prepare('INSERT OR REPLACE INTO player_aliases (player_id, name, seen_until) VALUES (?, ?, ?)').run(into, src.name, src.last_seen);
    }
    if (src.ingame_id) db.prepare('UPDATE players SET ingame_id = NULL WHERE id = ?').run(from);
    db.prepare('UPDATE players SET ingame_id = COALESCE(ingame_id, ?), first_seen = MIN(first_seen, ?) WHERE id = ?').run(src.ingame_id, src.first_seen, into);
    db.prepare('DELETE FROM players WHERE id = ?').run(from);
  })();
  return true;
}

/**
 * SQL filter for battle hall participant search: substring match on the stored JSON and exact participant names
 * (current and former) of every player whose current or alias name matches `q`.
 */
export function battleHallParticipantFilter(db: DB, groupId: number, q: string): { clause: string; args: unknown[] } {
  const like = likeTerm(q);
  const args: unknown[] = [like, like];
  let clause = `(h.attackers LIKE ? ESCAPE '\\' OR h.defenders LIKE ? ESCAPE '\\'`;
  // current and former names of every matching player, in one query
  const names = db
    .prepare(
      `WITH ids AS (
         SELECT id FROM players p WHERE p.group_id = ?
           AND (p.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM player_aliases a WHERE a.player_id = p.id AND a.name LIKE ? ESCAPE '\\')))
       SELECT name FROM players WHERE id IN (SELECT id FROM ids)
       UNION SELECT name FROM player_aliases WHERE player_id IN (SELECT id FROM ids)`,
    )
    .pluck()
    .all(groupId, like, like) as string[];
  if (names.length) {
    const json = JSON.stringify(names);
    clause +=
      " OR EXISTS (SELECT 1 FROM json_each(h.attackers) a WHERE a.value COLLATE NOCASE IN (SELECT value FROM json_each(?)))" +
      " OR EXISTS (SELECT 1 FROM json_each(h.defenders) d WHERE d.value COLLATE NOCASE IN (SELECT value FROM json_each(?)))";
    args.push(json, json);
  }
  clause += ')';
  return { clause, args };
}
