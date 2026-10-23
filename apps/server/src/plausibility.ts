import type { GalaxyRecord, HubRecord, StatsRecord } from '@pr0hub/core';
import type { DB } from './db.js';
import { Players } from './repo/players.js';

/** Below these sizes nothing is judged: a young group, a short page. */
const MIN_KNOWN = 50;
const MIN_ROWS = 20;
const MIN_ALLIANCES = 10;
const MIN_PLANETS = 5;
/** share of a statistics page the group must know, share of compared planets with another owner */
const MIN_KNOWN_SHARE = 0.3;
const MAX_OTHER_OWNER = 0.7;

/**
 * Whether parsed pages contradict what the group already knows about its universe, i.e. come from another
 * universe: a statistics page names mostly players (or alliances) the group has never seen, galaxy views show
 * mostly other owners on planets the group knows. Works for plain text too, unlike the markers of the HTML.
 */
export function foreignRecords(db: DB, groupId: number, records: HubRecord[]): boolean {
  const players = new Players(db, groupId);
  const stats = records.filter((r): r is StatsRecord => r.kind === 'stats');
  for (const r of stats) {
    if (r.rows.length < MIN_ROWS) continue;
    if (r.who === 'player') {
      if (count(db, 'players', groupId) < MIN_KNOWN) continue;
      const known = r.rows.filter((row) => players.byName(row.name) != null).length;
      if (known / r.rows.length < MIN_KNOWN_SHARE) return true;
    } else {
      if (count(db, 'alliances', groupId) < MIN_ALLIANCES) continue;
      const byName = db.prepare('SELECT 1 FROM alliances WHERE group_id = ? AND name = ?');
      const known = r.rows.filter((row) => byName.get(groupId, row.name)).length;
      if (known / r.rows.length < MIN_KNOWN_SHARE) return true;
    }
  }

  const owner = db.prepare(
    `SELECT p.id FROM planets pl JOIN players p ON p.id = pl.player_id
     WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ? AND pl.destroyed = 0`,
  ).pluck();
  let compared = 0;
  let other = 0;
  for (const r of records.filter((x): x is GalaxyRecord => x.kind === 'galaxy')) {
    for (const row of r.rows) {
      if (!row.playerName || row.destroyed) continue;
      const known = owner.get(groupId, r.g, r.s, row.position) as number | undefined;
      if (known == null) continue;
      compared++;
      if (players.byName(row.playerName) !== known) other++;
    }
  }
  return compared >= MIN_PLANETS && other / compared > MAX_OTHER_OWNER;
}

const count = (db: DB, table: 'players' | 'alliances', groupId: number) =>
  db.prepare(`SELECT COUNT(*) FROM ${table} WHERE group_id = ?`).pluck().get(groupId) as number;
