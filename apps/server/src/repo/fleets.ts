import type { FleetBody, FleetMovement } from '@pr0hub/core';
import type { DB } from '../db.js';

/** Missions a user can hide from the other members (game mission ids). */
export const SHARE_MISSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17];

export interface FleetShare {
  enabled: boolean;
  /** mission ids not shared */
  hidden: number[];
  /** the own fleets also in the history of past movements */
  history: boolean;
}

export function fleetShare(db: DB, userId: number): FleetShare {
  const raw = db.prepare('SELECT fleet_share FROM users WHERE id = ?').pluck().get(userId) as string | null | undefined;
  const s = raw ? (JSON.parse(raw) as Partial<FleetShare>) : {};
  return { enabled: s.enabled ?? true, hidden: s.hidden ?? [], history: s.history ?? true };
}

/**
 * `fromPlayer`: owner of the start of a foreign or hostile fleet by the galaxy data (the game names none on attacks).
 * `shared`: for the member themself, whether the others see this own fleet.
 */
export type StoredFleet = FleetMovement & { arrival: number; fromPlayer?: { id: number; name: string } | null; shared?: boolean };

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

const PHASES: StoredFleet['phase'][] = ['out', 'hold', 'return'];

/**
 * A fleet and the later lines of the same flight in `list` (holding at the target, return): same mission and ends, the
 * next arrival of each later phase. A phase with several candidates (two flights between the same planets) is left out.
 */
export function flightLines(list: StoredFleet[], f: StoredFleet): StoredFleet[] {
  const ends = (x: StoredFleet) =>
    (sameBody(x.from, f.from) && sameBody(x.to, f.to)) || (sameBody(x.from, f.to) && sameBody(x.to, f.from));
  const lines = [f];
  for (const phase of PHASES.slice(PHASES.indexOf(f.phase) + 1)) {
    const next = list.filter((x) => x.owner === 'own' && x.phase === phase && (x.mission ?? null) === (f.mission ?? null) && x.arrival > f.arrival && ends(x));
    if (next.length === 1) lines.push(next[0]);
  }
  return lines;
}

/** Adds the owner of the start (galaxy data) to the fleets of others. */
export function withOrigins(db: DB, groupId: number, fleets: StoredFleet[]): StoredFleet[] {
  const owner = db.prepare(
    'SELECT pr.id, pr.name FROM planets pl JOIN players pr ON pr.id = pl.player_id WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ?',
  );
  return fleets.map((f) =>
    f.owner === 'own' ? f : { ...f, fromPlayer: (owner.get(groupId, f.from.coords.g, f.from.coords.s, f.from.coords.p) as { id: number; name: string } | undefined) ?? null },
  );
}

/** How long fleet lists are kept for the history of past movements (seconds). */
export const FLEET_HISTORY = 12 * 3600;

/** A member's choices for single fleets, ahead of their account setting (as `player_messages.share`). */
function shareChoices(db: DB, groupId: number, ownerId: number): { fleet: StoredFleet; share: boolean }[] {
  const rows = db.prepare('SELECT share, data FROM fleet_share_choices WHERE group_id = ? AND user_id = ? ORDER BY id DESC').all(groupId, ownerId) as {
    share: number;
    data: string;
  }[];
  return rows.map((r) => ({ fleet: JSON.parse(r.data) as StoredFleet, share: !!r.share }));
}

/**
 * Whether the other members see a fleet of `ownerId` (in the history: `past`): fleets of others always, own fleets by
 * the member's choice for that fleet, else by their sharing setting (`private`: they share none by default).
 */
export function fleetVisibility(db: DB, groupId: number, ownerId: number) {
  const share = fleetShare(db, ownerId);
  const choices = shareChoices(db, groupId, ownerId);
  return {
    private: !share.enabled,
    shared(f: StoredFleet, past = false): boolean {
      if (f.owner !== 'own') return true;
      const choice = choices.find((c) => sameFleet(c.fleet, f));
      if (choice) return choice.share;
      return share.enabled && (!past || share.history) && (f.mission == null || !share.hidden.includes(f.mission));
    },
  };
}

/** The fleets of `ownerId` as `viewerId` may see them (in the history: `past`); the member themself sees all, marked. */
function forViewer(db: DB, groupId: number, ownerId: number, viewerId: number, data: StoredFleet[], past = false) {
  const vis = fleetVisibility(db, groupId, ownerId);
  if (ownerId === viewerId) return { data: data.map((f) => (f.owner === 'own' ? { ...f, shared: vis.shared(f, past) } : f)), private: false };
  const shown = data.filter((f) => vis.shared(f, past));
  return { data: shown, private: vis.private && !shown.some((f) => f.owner === 'own') };
}

/** Stores the member's choice for a fleet and the later lines of its flight (`flightLines`); older choices are dropped. */
export function chooseFleetShare(db: DB, groupId: number, ownerId: number, lines: StoredFleet[], share: boolean, t: number) {
  const rows = db.prepare('SELECT id, data FROM fleet_share_choices WHERE group_id = ? AND user_id = ?').all(groupId, ownerId) as { id: number; data: string }[];
  const replaced = rows.filter((r) => lines.some((l) => sameFleet(JSON.parse(r.data) as StoredFleet, l))).map((r) => r.id);
  db.transaction(() => {
    db.prepare('DELETE FROM fleet_share_choices WHERE group_id = ? AND user_id = ? AND (arrival < ? OR id IN (SELECT value FROM json_each(?)))').run(
      groupId, ownerId, t - FLEET_HISTORY - 3600, JSON.stringify(replaced),
    );
    const insert = db.prepare('INSERT INTO fleet_share_choices (group_id, user_id, arrival, share, data, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const { shared: _, fromPlayer: __, ...line } of lines) insert.run(groupId, ownerId, line.arrival, share ? 1 : 0, JSON.stringify(line), t);
  })();
}

/**
 * Newest fleet movements of a member as another member may see them: all for the member themself (marked `shared`),
 * else their own fleets filtered by `fleetVisibility` (`private`: they share none of them). Fleets of others heading
 * for the member (incoming attacks, spying, friendly holds) are always shared. Applies when served, so a change counts
 * at once.
 */
export function sharedFleets(
  db: DB, groupId: number, ownerId: number, viewerId: number,
): { time: number; data: StoredFleet[]; private: boolean } | null {
  const row = db
    .prepare('SELECT page_time AS time, data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC LIMIT 1')
    .get(groupId, ownerId) as { time: number; data: string } | undefined;
  if (!row) return null;
  return { time: row.time, ...forViewer(db, groupId, ownerId, viewerId, withOrigins(db, groupId, JSON.parse(row.data) as StoredFleet[])) };
}

/**
 * Past fleet movements of a member from their older fleet lists (shared like `sharedFleets`, their own fleets by default
 * only when they share the history too), oldest first, arrived
 * after `since`. Each list stands for the fleets arriving until the next one was synced: a fleet missing from the next
 * list although it was due later was recalled and is left out. The arrived fleets of the newest list are not included.
 */
export function fleetHistory(db: DB, groupId: number, ownerId: number, viewerId: number, since: number): StoredFleet[] {
  const rows = db
    .prepare('SELECT page_time AS time, data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time, id')
    .all(groupId, ownerId) as { time: number; data: string }[];
  const past: StoredFleet[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const until = rows[i + 1].time;
    for (const f of JSON.parse(rows[i].data) as StoredFleet[]) {
      if (f.arrival > rows[i].time && f.arrival <= until && f.arrival >= since) past.push(f);
    }
  }
  return withOrigins(db, groupId, forViewer(db, groupId, ownerId, viewerId, past.sort((a, b) => a.arrival - b.arrival), true).data);
}
