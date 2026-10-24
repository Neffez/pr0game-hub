import type { FleetBody } from '@pr0hub/core';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { sharedFleets, type StoredFleet } from './fleets.js';

/** A notification for the arrival of one of the user's own fleets (`lead`: minutes before it). */
export interface FleetAlert {
  id: number;
  arrival: number;
  lead: number;
  /** the movement as last seen in the user's fleet list */
  fleet: StoredFleet;
  created_at: number;
}

/** Fleet alerts are listed (bell) and kept this long after the arrival. */
export const FLEET_KEEP = 10 * 60;
/** Arrivals of one movement in two fleet lists differ by up to this much (remaining time vs. shown clock). */
const TOLERANCE = 5;

const sameBody = (a: FleetBody | null, b: FleetBody | null) =>
  a == null || b == null
    ? a == b
    : a.coords.g === b.coords.g && a.coords.s === b.coords.s && a.coords.p === b.coords.p && (a.type ?? null) === (b.type ?? null);

/** Whether two fleet movements are the same one (the game gives them no id). */
export function sameFleet(a: Pick<StoredFleet, 'mission' | 'phase' | 'from' | 'to' | 'arrival'>, b: StoredFleet): boolean {
  return (
    b.owner === 'own' && (a.mission ?? null) === (b.mission ?? null) && a.phase === b.phase && sameBody(a.from, b.from) && sameBody(a.to, b.to) &&
    Math.abs(a.arrival - b.arrival) <= TOLERANCE
  );
}

/**
 * The user's fleet alerts, matched against their newest fleet list: a matched alert takes the fleet's arrival, an alert
 * whose fleet is missing from a list synced after it was set and before its arrival is removed (recalled), as are
 * alerts whose arrival is longer than `FLEET_KEEP` ago.
 */
export function openFleetAlerts(db: DB, ctx: GroupContext, userId: number, t: number): FleetAlert[] {
  const rows = db
    .prepare('SELECT id, arrival, lead, data, created_at FROM fleet_alerts WHERE group_id = ? AND user_id = ? ORDER BY arrival, id')
    .all(ctx.groupId, userId) as { id: number; arrival: number; lead: number; data: string; created_at: number }[];
  if (!rows.length) return [];
  const list = sharedFleets(db, ctx.groupId, userId, userId);
  const update = db.prepare('UPDATE fleet_alerts SET arrival = ?, data = ? WHERE id = ?');
  const gone: number[] = [];
  const open: FleetAlert[] = [];
  for (const r of rows) {
    let fleet = JSON.parse(r.data) as StoredFleet;
    let arrival = r.arrival;
    const match = list?.data.find((f) => sameFleet(fleet, f));
    if (match) {
      if (match.arrival !== arrival || JSON.stringify(match) !== r.data) update.run(match.arrival, JSON.stringify(match), r.id);
      fleet = match;
      arrival = match.arrival;
    } else if (list && list.time > r.created_at && arrival > list.time) {
      gone.push(r.id);
      continue;
    }
    if (arrival + FLEET_KEEP < t) {
      gone.push(r.id);
      continue;
    }
    open.push({ id: r.id, arrival, lead: r.lead, fleet, created_at: r.created_at });
  }
  if (gone.length) db.prepare('DELETE FROM fleet_alerts WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(gone));
  return open;
}

/** The earliest reminder time after `t` of the group's fleet alerts (arrival minus lead), null when there is none. */
export function nextFleetAlert(db: DB, groupId: number, t: number): number | null {
  return (db.prepare('SELECT MIN(arrival - lead * 60) FROM fleet_alerts WHERE group_id = ? AND arrival - lead * 60 > ?').pluck().get(groupId, t) ??
    null) as number | null;
}
