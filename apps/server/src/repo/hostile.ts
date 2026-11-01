import { distance, flightDuration, slowestShip } from '@pr0hub/flight';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { spyEmpire } from './empire.js';
import { fleetHistory, sharedFleets, TOLERANCE, type StoredFleet } from './fleets.js';

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

/** A hostile attack (single fleet or ACS), from the members' overview pastes or a phalanx result. */
export interface HostileAttack {
  /** stable while the attack lasts: route and the lead fleet's ships */
  key: string;
  /** member it heads for (overview); null when only seen in a phalanx */
  memberId: number | null;
  /** that member, or the attacked player by the galaxy data (phalanx) */
  member: string | null;
  source: 'overview' | 'phalanx';
  /** member who pasted the phalanx */
  reporter: string | null;
  /** landing back home when a phalanx of the attacker's planet shows the return */
  home: number | null;
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

/** Ships as a comparable key (amounts above zero, by id). */
export const shipsKey = (ships: Record<number, number>) =>
  JSON.stringify(Object.entries(ships).filter(([, n]) => n > 0).sort(([a], [b]) => Number(a) - Number(b)));

/** Same attack across pastes and members: route and the ships of the lead fleet (the arrival may move by delays). */
export const attackKey = (from: Body, to: Body, lead: Record<number, number>) =>
  `${from.g}:${from.s}:${from.p}:${from.type}>${to.g}:${to.s}:${to.p}:${to.type}|${shipsKey(lead)}`;

type AttackGroup = { key: string; from: Body; to: Body; fleets: StoredFleet[] };
const sameBody = (b: StoredFleet['from'] | null, c: Body) => !!b && b.coords.g === c.g && b.coords.s === c.s && b.coords.p === c.p && b.type === c.type;

/**
 * Attacks worth a retime in one fleet list (`owners`: hostile ones on the viewer, in a phalanx also the scanned
 * player's own ones): ACS fleets as one group, the lead first.
 */
export function attackGroups(data: StoredFleet[], owners: StoredFleet['owner'][]): AttackGroup[] {
  const groups = new Map<string, StoredFleet[]>();
  data.forEach((f, i) => {
    if (!owners.includes(f.owner) || f.phase !== 'out' || f.mission == null || !RETIME_MISSIONS.includes(f.mission)) return;
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

/** Phalanx results are listed for a day. */
export const PHALANX_KEEP = 86400;

/**
 * Hostile attacks on the members, from the newest fleet snapshot of every member (incoming fleets are always shared),
 * and from the phalanx results of the last day pasted into the raid planner (attacks on the scanned planet, and the
 * scanned player's own attacks from it, with their return when the phalanx shows it). ACS fleets as one attack.
 * Listed until their latest possible return, also after the impact (from the member's older fleet lists: the fleet is
 * gone from the newer ones, the retime still runs); the same attack seen twice counts once, with the newest arrival.
 */
export function hostileAttacks(db: DB, ctx: GroupContext): HostileAttack[] {
  const u = ctx.universe.settings;
  const t = ctx.now;
  const byKey = new Map<string, HostileAttack>();
  const add = (g: AttackGroup, seen: number, who: Pick<HostileAttack, 'memberId' | 'member' | 'source' | 'reporter'>, home: number | null) => {
    const lead = g.fleets[0];
    const dist = distance(u, [g.from.g, g.from.s, g.from.p], [g.to.g, g.to.s, g.to.p]);
    const longest = Math.max(...g.fleets.map((f) => flightDuration(u, dist, slowestShip(f.ships, NO_DRIVES)?.speed ?? 0, 10)));
    const until = home ?? Math.floor(lead.arrival + longest);
    if (until < t) return;
    const known = byKey.get(g.key);
    if (known) {
      // the same attack again (another member, a phalanx): the newest arrival and fleets count
      if (seen > known.seen) Object.assign(known, { seen, arrival: lead.arrival, until, fleets: g.fleets.map((f) => ({ mission: f.mission, ships: f.ships })) });
      known.home ??= home;
      return;
    }
    byKey.set(g.key, {
      key: g.key, ...who, seen, arrival: lead.arrival, from: g.from, to: g.to,
      fleets: g.fleets.map((f) => ({ mission: f.mission, ships: f.ships })), player: null, drives: null, until, home,
    });
  };

  const members = db
    .prepare('SELECT m.user_id, COALESCE(m.ingame_name, u.username) AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?')
    .all(ctx.groupId) as { user_id: number; name: string }[];
  for (const m of members) {
    const snap = sharedFleets(db, ctx.groupId, m.user_id, ctx.user.id);
    if (!snap) continue;
    const who = { memberId: m.user_id, member: m.name, source: 'overview', reporter: null } as const;
    // arrived before the newest list: last seen on the list before
    for (const g of attackGroups(fleetHistory(db, ctx.groupId, m.user_id, ctx.user.id, 0), ['hostile'])) add(g, g.fleets[0].arrival, who, null);
    for (const g of attackGroups(snap.data, ['hostile'])) add(g, snap.time, who, null);
  }

  const pastes = db
    .prepare(
      `SELECT p.page_time AS time, p.data, COALESCE(gm.ingame_name, u.username) AS reporter FROM phalanx_snapshots p
       LEFT JOIN users u ON u.id = p.user_id LEFT JOIN group_members gm ON gm.group_id = p.group_id AND gm.user_id = p.user_id
       WHERE p.group_id = ? AND p.page_time > ? ORDER BY p.page_time, p.id`,
    )
    .all(ctx.groupId, t - PHALANX_KEEP) as { time: number; data: string; reporter: string | null }[];
  for (const paste of pastes) {
    const data = JSON.parse(paste.data) as StoredFleet[];
    for (const g of attackGroups(data, ['hostile', 'own'])) {
      // the scanned player's own attack: the phalanx also shows its return home
      const lead = g.fleets[0];
      const back = lead.owner === 'own'
        ? data.find((f) => f.phase === 'return' && sameBody(f.from, g.to) && sameBody(f.to, g.from) && shipsKey(f.ships) === shipsKey(lead.ships))
        : undefined;
      add(g, paste.time, { memberId: null, member: null, source: 'phalanx', reporter: paste.reporter }, back?.arrival ?? null);
    }
  }

  const owner = db.prepare(
    'SELECT pr.id, pr.name FROM planets pl JOIN players pr ON pr.id = pl.player_id WHERE pl.group_id = ? AND pl.g = ? AND pl.s = ? AND pl.p = ?',
  );
  const list = [...byKey.values()].sort((a, b) => a.arrival - b.arrival);
  for (const a of list) {
    a.player = (owner.get(ctx.groupId, a.from.g, a.from.s, a.from.p) as { id: number; name: string } | undefined) ?? null;
    // seen in a phalanx only: the attacked player from the galaxy data
    a.member ??= (owner.get(ctx.groupId, a.to.g, a.to.s, a.to.p) as { name: string } | undefined)?.name ?? null;
    const spy = a.player ? spyEmpire(db, ctx, a.player.id, a.player.name) : null;
    if (spy?.researchTime) {
      a.drives = { research: Object.fromEntries(DRIVE_IDS.map((id) => [id, spy.research[id] ?? 0])), time: spy.researchTime };
    }
  }
  return list;
}

const ATTACK_OWNERS: StoredFleet['owner'][] = ['own', 'hostile', 'foreign'];

/** Attacks (missions 1/2/9) in a member's newest overview paste, for admin cleanup. */
export function memberFleetAttacks(
  db: DB,
  groupId: number,
  userId: number,
): { key: string; owner: StoredFleet['owner']; arrival: number; from: Body; to: Body; mission: number | null; fleets: number }[] {
  const snap = db
    .prepare('SELECT data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? ORDER BY page_time DESC, id DESC LIMIT 1')
    .get(groupId, userId) as { data: string } | undefined;
  if (!snap) return [];
  const data = JSON.parse(snap.data) as StoredFleet[];
  return attackGroups(data, ATTACK_OWNERS).map((g) => ({
    key: g.key,
    owner: g.fleets[0].owner,
    arrival: g.fleets[0].arrival,
    from: g.from,
    to: g.to,
    mission: g.fleets[0].mission,
    fleets: g.fleets.length,
  }));
}

/**
 * Removes one attack (solo or ACS) from every stored fleet list of the member. Waves with the same route and ships
 * share the key: `arrival` picks one of them, without it all go. The alliance's "hidden" mark of the key goes only when
 * no fleet list of the group still holds an attack with it (another wave stays hidden). Returns how many snapshots
 * were changed.
 */
export function removeStoredAttack(db: DB, groupId: number, userId: number, key: string, arrival?: number): number {
  const rows = db
    .prepare('SELECT id, data FROM fleet_snapshots WHERE group_id = ? AND user_id = ?')
    .all(groupId, userId) as { id: number; data: string }[];
  const update = db.prepare('UPDATE fleet_snapshots SET data = ? WHERE id = ?');
  let changed = 0;
  for (const row of rows) {
    const data = JSON.parse(row.data) as StoredFleet[];
    const groups = attackGroups(data, ATTACK_OWNERS).filter(
      (g) => g.key === key && (arrival == null || Math.abs(g.fleets[0].arrival - arrival) <= TOLERANCE),
    );
    const drop = new Set<number>();
    for (const group of groups) {
      const lead = group.fleets[0];
      data.forEach((f, i) => {
        if (lead.acs != null) {
          if (f.acs === lead.acs && Math.abs(f.arrival - lead.arrival) <= TOLERANCE) drop.add(i);
        } else if (group.fleets.includes(f)) drop.add(i);
      });
    }
    if (!drop.size) continue;
    update.run(JSON.stringify(data.filter((_, i) => !drop.has(i))), row.id);
    changed++;
  }
  if (changed && !storedAttackKeys(db, groupId).has(key)) {
    db.prepare('DELETE FROM hidden_attacks WHERE group_id = ? AND attack_key = ?').run(groupId, key);
  }
  return changed;
}

/** Keys of the attacks in all stored fleet lists of the group. */
function storedAttackKeys(db: DB, groupId: number): Set<string> {
  const keys = new Set<string>();
  for (const data of db.prepare('SELECT data FROM fleet_snapshots WHERE group_id = ?').pluck().all(groupId) as string[]) {
    for (const g of attackGroups(JSON.parse(data) as StoredFleet[], ATTACK_OWNERS)) keys.add(g.key);
  }
  return keys;
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
    const attack = attackGroups(JSON.parse(row.data) as StoredFleet[], ['hostile']).find((a) => a.key === key);
    if (attack) {
      last = { time: row.time, arrival: attack.fleets[0].arrival };
      gone = null;
    } else if (last && gone == null && row.time < last.arrival) {
      gone = row.time;
    }
  }
  return last && gone != null ? { from: last.time, to: gone } : null;
}
