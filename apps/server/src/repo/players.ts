import { now, type DB } from '../db.js';
import { likeTerm } from '../routes/util.js';

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

  /** Current or former name (like `player()`), without creating a player. */
  byName(name: string): number | null {
    const db = this.db;
    return (
      (db
        .prepare('SELECT id FROM players WHERE group_id = ? AND name = ? COLLATE NOCASE ORDER BY last_seen DESC')
        .pluck()
        .get(this.groupId, name) as number | undefined) ??
      (db
        .prepare(
          `SELECT p.id FROM player_aliases a JOIN players p ON p.id = a.player_id
           WHERE p.group_id = ? AND a.name = ? COLLATE NOCASE ORDER BY a.seen_until DESC`,
        )
        .pluck()
        .get(this.groupId, name) as number | undefined) ??
      null
    );
  }
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
