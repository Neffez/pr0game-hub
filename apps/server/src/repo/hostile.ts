import { distance, flightDuration, slowestShip } from '@pr0hub/flight';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { spyEmpire } from './empire.js';
import { sharedFleets, type StoredFleet } from './fleets.js';

/** Missions worth a retime: attack, ACS attack, destroy. */
const RETIME_MISSIONS = [1, 2, 9];
const DRIVE_IDS = [115, 117, 118];
const NO_DRIVES = { combustion: 0, impulse: 0, hyperspace: 0 };

export interface Body {
  g: number;
  s: number;
  p: number;
  type: 'planet' | 'moon';
}

export interface EnemyFleet {
  mission: number | null;
  ships: Record<number, number>;
}

/** A hostile attack (single fleet or ACS) heading for a member, from the members' overview pastes. */
export interface HostileAttack {
  /** stable while the attack lasts: route and the lead fleet's ships */
  key: string;
  memberId: number;
  member: string;
  /** page time of the overview it was seen on */
  seen: number;
  arrival: number;
  from: Body;
  to: Body;
  /** the lead first */
  fleets: EnemyFleet[];
  /** owner of the origin according to the galaxy data */
  player: { id: number; name: string } | null;
  /** owner's drive research from the newest spy report showing research */
  drives: { research: Record<number, number>; time: number | null } | null;
  /** latest possible return: slowest speed without any drive research */
  until: number;
}

const shipsKey = (ships: Record<number, number>) =>
  JSON.stringify(Object.entries(ships).filter(([, n]) => n > 0).sort(([a], [b]) => Number(a) - Number(b)));

/** Same attack across pastes and members: route and the ships of the lead fleet (the arrival may move by delays). */
export const attackKey = (from: Body, to: Body, lead: Record<number, number>) =>
  `${from.g}:${from.s}:${from.p}:${from.type}>${to.g}:${to.s}:${to.p}:${to.type}|${shipsKey(lead)}`;

/** Hostile attacks worth a retime in one fleet list: ACS fleets as one group, the lead first. */
function attackGroups(data: StoredFleet[]): { key: string; from: Body; to: Body; fleets: StoredFleet[] }[] {
  const groups = new Map<string, StoredFleet[]>();
  data.forEach((f, i) => {
    if (f.owner !== 'hostile' || f.phase !== 'out' || f.mission == null || !RETIME_MISSIONS.includes(f.mission)) return;
    if (!f.to || (f.from.type !== 'planet' && f.from.type !== 'moon') || (f.to.type !== 'planet' && f.to.type !== 'moon')) return;
    const id = f.acs != null ? `acs${f.acs}` : `f${i}`;
    groups.set(id, [...(groups.get(id) ?? []), f]);
  });
  return [...groups.values()].map((fleets) => {
    const lead = fleets[0];
    const from = { ...lead.from.coords, type: lead.from.type as Body['type'] };
    const to = { ...lead.to!.coords, type: lead.to!.type as Body['type'] };
    return { key: attackKey(from, to, lead.ships), from, to, fleets };
  });
}

/**
 * Hostile attacks on the members, from the newest fleet snapshot of every member (incoming fleets are always shared),
 * ACS fleets as one attack. Listed until their latest possible return; the same attack seen twice counts once.
 */
export function hostileAttacks(db: DB, ctx: GroupContext): HostileAttack[] {
  const u = ctx.universe.settings;
  const t = now();
  const members = db
    .prepare('SELECT m.user_id, COALESCE(m.ingame_name, u.username) AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
    .all(ctx.groupId) as { user_id: number; name: string }[];
  const byKey = new Map<string, HostileAttack>();
  for (const m of members) {
    const snap = sharedFleets(db, ctx.groupId, m.user_id, ctx.user.id);
    if (!snap) continue;
    for (const { key, from, to, fleets: list } of attackGroups(snap.data)) {
      const lead = list[0];
      const dist = distance(u, [from.g, from.s, from.p], [to.g, to.s, to.p]);
      const longest = Math.max(...list.map((f) => flightDuration(u, dist, slowestShip(f.ships, NO_DRIVES)?.speed ?? 0, 10)));
      const until = Math.floor(lead.arrival + longest);
      if (until < t) continue;
      const seen = byKey.get(key);
      if (seen && seen.seen >= snap.time) continue;
      byKey.set(key, {
        key, memberId: m.user_id, member: m.name, seen: snap.time, arrival: lead.arrival, from, to,
        fleets: list.map((f) => ({ mission: f.mission, ships: f.ships })), player: null, drives: null, until,
      });
    }
  }
  const owner = db.prepare(
    'SELECT pr.id, pr.name FROM planets pl JOIN players pr ON pr.id = pl.player_id WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ?',
  );
  const list = [...byKey.values()].sort((a, b) => a.arrival - b.arrival);
  for (const a of list) {
    a.player = (owner.get(ctx.groupId, a.from.g, a.from.s, a.from.p) as { id: number; name: string } | undefined) ?? null;
    const spy = a.player ? spyEmpire(db, ctx, a.player.id, a.player.name) : null;
    if (spy?.researchTime) {
      a.drives = { research: Object.fromEntries(DRIVE_IDS.map((id) => [id, spy.research[id] ?? 0])), time: spy.researchTime };
    }
  }
  return list;
}

/**
 * Recall of an attack seen by a member: it vanished from their overview before it arrived. The window runs from the
 * last fleet list still showing it to the next one without it (both before the arrival); null when not seen so.
 */
export function recallWindow(db: DB, groupId: number, memberId: number, key: string): { from: number; to: number } | null {
  const rows = db
    .prepare('SELECT page_time AS time, data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time, id')
    .all(groupId, memberId) as { time: number; data: string }[];
  let last: { time: number; arrival: number } | null = null;
  let gone: number | null = null;
  for (const row of rows) {
    const attack = attackGroups(JSON.parse(row.data) as StoredFleet[]).find((a) => a.key === key);
    if (attack) {
      last = { time: row.time, arrival: attack.fleets[0].arrival };
      gone = null;
    } else if (last && gone == null && row.time < last.arrival) {
      gone = row.time;
    }
  }
  return last && gone != null ? { from: last.time, to: gone } : null;
}
