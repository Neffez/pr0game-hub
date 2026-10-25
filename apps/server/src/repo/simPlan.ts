import type { CombatFleet, CombatReportRecord } from '@pr0hub/core/combat';
import type { GroupContext } from '../context.js';
import { now, type DB } from '../db.js';
import { shipsKey, type Body } from './hostile.js';
import { memberByName } from './reportPlan.js';

/** Combat research the simulation shows per fleet (weapons, shields, armour). */
const COMBAT_TECHS = [109, 110, 111];

/**
 * Battle simulation taken over into an attack plan (`attack_plans.sim`): the target's ships, defense and combat
 * research (the first defender), the combat research of guest fleets by their start (`bodyKey`) and of members by
 * their user id (research is the player's: one recognised fleet gives it to all of theirs).
 */
export interface PlanSim {
  time: number;
  user_id: number;
  values: Record<number, number> | null;
  guests: Record<string, Record<number, number>>;
  members?: Record<string, Record<number, number>>;
}

interface Guest {
  player: { id: number; name: string } | null;
  name?: string;
  from: Body;
  mission: number | null;
  ships: Record<number, number>;
}

export const bodyKey = (b: Body) => `${b.g}:${b.s}:${b.p}:${b.type}`;
const flying = (ships: Record<number, number>) => Object.fromEntries(Object.entries(ships).filter(([id, n]) => Number(id) >= 200 && Number(id) < 300 && n > 0));
/** Ship types of a fleet, to recognise it without the amounts. */
const typesKey = (ships: Record<number, number>) => Object.keys(flying(ships)).sort().join(',');
const lower = (s: string) => s.trim().toLowerCase();

export interface SimResult {
  defender: boolean;
  /** attacker fleets in the simulation, recognised as a plan fleet or guest, and changed by it */
  attackers: number;
  identified: number;
  updated: number;
}

/**
 * Takes a battle simulation (or report) over into an attack plan. Simulations carry dummy coordinates, so nothing is
 * read from them: the first defender becomes the target's ships, defense and combat research for the simulators
 * (`PlanSim.values`). Attacker fleets only change the plan where they are recognised: by the name of a member or guest,
 * else by the slot (the hub's simulator links fill the slots in the plan's order) with the same ship types, else as the
 * only open fleet with those ship types. A recognised member fleet takes the ships and gives its member the combat
 * research (used where the member's own is unknown, `simResearch`), a guest its research and, unless the plan follows a running attack, the
 * ships.
 */
export function applySimulation(db: DB, ctx: GroupContext, planId: number, report: CombatReportRecord): SimResult {
  const plan = db.prepare('SELECT guests, sim, attack_key FROM attack_plans WHERE id = ?').get(planId) as {
    guests: string | null; sim: string | null; attack_key: string | null;
  };
  const guests = (plan.guests ? JSON.parse(plan.guests) : []) as Guest[];
  const prev = plan.sim ? (JSON.parse(plan.sim) as PlanSim) : null;
  const fleets = (
    db.prepare('SELECT id, user_id, ships, status FROM attack_plan_fleets WHERE plan_id = ? ORDER BY id').all(planId) as {
      id: number; user_id: number; ships: string; status: string;
    }[]
  )
    .map((f) => ({ ...f, ships: JSON.parse(f.ships) as Record<number, number> }))
    .filter((f) => f.status !== 'withdrawn' && Object.keys(flying(f.ships)).length);
  const byName = memberByName(db, ctx);

  // the simulators' attacker slots: the plan's fleets, then its guests
  type Slot = { ships: Record<number, number>; named: (name: string) => boolean } & ({ fleet: number; user: number } | { guest: number });
  const slots: Slot[] = [
    ...fleets.map((f) => ({ fleet: f.id, user: f.user_id, ships: f.ships, named: (name: string) => byName(name) === f.user_id })),
    ...guests.map((g, i) => ({ guest: i, ships: g.ships, named: (name: string) => [g.player?.name, g.name].some((n) => n && lower(n) === lower(name)) })),
  ];
  const used = new Set<number>();
  const free = (k: number) => !used.has(k);
  const slotOf = (f: CombatFleet, index: number): number => {
    const types = typesKey(f.start);
    const named = slots.map((_, k) => k).filter((k) => free(k) && slots[k].named(f.name));
    if (named.length) return named.find((k) => typesKey(slots[k].ships) === types) ?? named[0];
    if (slots[index] && free(index) && typesKey(slots[index].ships) === types) return index;
    const same = slots.map((_, k) => k).filter((k) => free(k) && typesKey(slots[k].ships) === types);
    return same.length === 1 ? same[0] : -1;
  };

  const attackers = report.fleets.filter((f) => f.side === 'attacker');
  const guestResearch = { ...(prev?.guests ?? {}) };
  const memberResearch = { ...(prev?.members ?? {}) };
  const differs = (a: Record<number, number> | undefined, b: Record<number, number> | undefined) => JSON.stringify(a) !== JSON.stringify(b);
  const setShips = db.prepare('UPDATE attack_plan_fleets SET ships = ?, updated_at = ? WHERE id = ?');
  let identified = 0;
  let updated = 0;
  let guestsChanged = false;
  attackers.forEach((f, i) => {
    const k = slotOf(f, i);
    if (k < 0) return;
    used.add(k);
    identified++;
    const slot = slots[k];
    const ships = flying(f.start);
    const shipsChanged = shipsKey(ships) !== shipsKey(slot.ships);
    if ('fleet' in slot) {
      const research = f.research && differs(f.research, memberResearch[slot.user]) ? f.research : null;
      if (shipsChanged) setShips.run(JSON.stringify(ships), now(), slot.fleet);
      if (research) memberResearch[slot.user] = research;
      if (shipsChanged || research) updated++;
      return;
    }
    const guest = guests[slot.guest];
    const key = bodyKey(guest.from);
    const research = f.research && differs(f.research, guestResearch[key]) ? f.research : null;
    // guests of a running attack are renewed from the overview (`syncOwnPlans`): their ships are what flies
    if (shipsChanged && !plan.attack_key) {
      guest.ships = ships;
      guestsChanged = true;
    }
    if (research) guestResearch[key] = research;
    if ((shipsChanged && !plan.attack_key) || research) updated++;
  });

  const target = report.fleets.find((f) => f.side === 'defender');
  const values = target
    ? { ...Object.fromEntries(Object.entries(target.start).filter(([, n]) => n > 0)), ...Object.fromEntries(COMBAT_TECHS.map((id) => [id, target.research?.[id] ?? 0])) }
    : (prev?.values ?? null);
  const sim: PlanSim = { time: now(), user_id: ctx.user.id, values, guests: guestResearch, members: memberResearch };
  db.prepare(`UPDATE attack_plans SET sim = ?, ${guestsChanged ? 'guests = ?, ' : ''}updated_at = ? WHERE id = ?`).run(
    ...[JSON.stringify(sim), ...(guestsChanged ? [JSON.stringify(guests)] : []), now(), planId],
  );
  return { defender: !!target, attackers: attackers.length, identified, updated };
}

/**
 * Combat research of a member from a taken-over simulation, for the simulators: only the levels the member's own
 * research (empire page, spy report, by hand) does not have; null when there are none.
 */
export function simResearch(sim: PlanSim | null, userId: number, known: Record<number, number> | undefined): Record<number, number> | null {
  const research = sim?.members?.[userId];
  if (!research) return null;
  const missing = COMBAT_TECHS.filter((id) => known?.[id] == null && research[id] != null);
  return missing.length ? Object.fromEntries(missing.map((id) => [id, research[id]])) : null;
}

/**
 * Values of an attack plan's target for the simulators: the target's spy report with the ships, defense and combat
 * research of a taken-over simulation, unless the spy report is newer. Resources and buildings stay from the report.
 */
export function withSim(
  spy: { time: number; values: Record<string, number> } | null, sim: PlanSim | null,
): { time: number; values: Record<string, number>; source: 'spy' | 'sim' } | null {
  if (!sim?.values || (spy && spy.time > sim.time)) return spy && { ...spy, source: 'spy' };
  const kept = Object.entries(spy?.values ?? {}).filter(([k]) => {
    const id = Number(k);
    return !(id >= 200 && id < 300) && !(id >= 400 && id < 500) && !COMBAT_TECHS.includes(id);
  });
  return { time: sim.time, values: { ...Object.fromEntries(kept), ...sim.values }, source: 'sim' };
}
