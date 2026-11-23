import type { DB } from '../db.js';
import type { StoredFleet } from './fleets.js';
import { EXPEDITION_MISSION, REPORT_TOLERANCE } from './slots.js';

/** Most ships one entry may name (manual losses). */
const MAX_SHIP_COUNT = 1e12;

/**
 * Ships of the expeditions of a member that a black hole swallowed, from their synced fleet lists: the report is
 * written at the end of the stay, so the own expedition holding at the report's position until then is the lost
 * fleet (the newest list before the report that shows it). Fills only rows without lost ships (none entered by
 * hand); a fleet that was never synced stays unknown and can be entered by hand (`setManualLoss`).
 */
export function blackHoleLosses(db: DB, groupId: number, userId: number): number {
  const open = db
    .prepare(
      `SELECT id, time, g, s, p FROM expeditions WHERE group_id = ? AND user_id = ? AND event = 'BlackHole'
       AND lost_ships IS NULL AND time IS NOT NULL AND g IS NOT NULL`,
    )
    .all(groupId, userId) as { id: number; time: number; g: number; s: number; p: number }[];
  if (!open.length) return 0;
  const lists = db
    .prepare('SELECT page_time AS time, data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC')
    .all(groupId, userId) as { time: number; data: string }[];
  const parsed = lists.map((l) => ({ time: l.time, data: JSON.parse(l.data) as StoredFleet[] }));
  const set = db.prepare("UPDATE expeditions SET lost_ships = ?, lost_source = 'fleet' WHERE id = ? AND group_id = ?");
  let filled = 0;
  for (const e of open) {
    for (const list of parsed) {
      if (list.time > e.time + REPORT_TOLERANCE) continue;
      const hold = list.data.find((f) => {
        const at = f.to ?? f.from;
        return f.owner === 'own' && f.mission === EXPEDITION_MISSION && f.phase === 'hold' && Math.abs(f.arrival - e.time) <= REPORT_TOLERANCE &&
          at.coords.g === e.g && at.coords.s === e.s && at.coords.p === e.p && Object.keys(f.ships).length > 0;
      });
      if (!hold) continue;
      set.run(JSON.stringify(hold.ships), e.id, groupId);
      filled++;
      break;
    }
  }
  return filled;
}

/**
 * Checks ships entered by hand as a loss: unit ids with whole, non-negative counts; zero counts are dropped. Null when
 * the input is invalid.
 */
export function cleanShips(raw: unknown, isShip: (id: number) => boolean): Record<number, number> | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 100) return null;
  const out: Record<number, number> = {};
  for (const [k, n] of entries) {
    const id = Number(k);
    if (!isShip(id) || typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_SHIP_COUNT) return null;
    if (n > 0) out[id] = n;
  }
  return out;
}
