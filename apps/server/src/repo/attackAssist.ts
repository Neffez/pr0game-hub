import { steal } from '@pr0hub/battle';
import { resourceAt } from '@pr0hub/core/buildings';
import { elementPoints, STORAGE, storageCapacity } from '@pr0hub/core/tech';
import { withUnits } from '@pr0hub/core/units';
import { distance, drivesFromResearch, flightDuration, launchFor, slowestShip } from '@pr0hub/flight';
import { planetFromSpy, runInWorker, simSettingsOf, throttle, type ApiSlot } from '../battle.js';
import { catalogOf, type GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { DISPLAY } from '../routes/util.js';
import { latestEmpire, latestEmpires, spyEmpire } from './empire.js';
import { CLASS_FLEET } from '@pr0hub/core/tech';
import { sharedFleets, TOLERANCE, type StoredFleet } from './fleets.js';
import { hostileAttacks, type HostileAttack } from './hostile.js';
import { phalanxExposure } from './phalanx.js';

/**
 * Incoming attack assistant: one hostile attack on a member with what the hub knows to answer it — the planet's
 * fleet and defense from the member's newest empire page, a battle simulation against the attacking ships, the loot
 * at risk at the impact, the member's other bodies for a fleet save, and the members who can still reach the planet
 * with a hold before the impact.
 */

/** Fleets holding at the planet land this long before the impact (like the raid planner's holds). */
const HOLD_LEAD = 1;
/** Battle runs of the assistant's simulation. */
const RUNS = 20;
const MAX_HELPERS = 30;

type Res = { metal: number; crystal: number; deuterium: number };

export interface AttackHelper {
  userId: number;
  member: string;
  from: { g: number; s: number; p: number; type: 'planet' | 'moon'; name: string };
  /** ships that can fly */
  ships: Record<string, number>;
  points: number;
  /** one-way seconds at full speed */
  duration: number;
  /** latest launch to land `HOLD_LEAD` seconds before the impact */
  launch: number;
}

/** A fleet holding (mission 5) at the attacked body at the impact, from the members' synced fleet lists. */
export interface HoldFleet {
  /** member it belongs to (own fleet in their list, or a member's planet as its start), null for others */
  member: string | null;
  player: string | null;
  from: { g: number; s: number; p: number; type: string | null };
  ships: Record<string, number>;
  research: Record<string, number>;
  /** landing at the body; null when it is holding there already */
  arrival: number | null;
}

const HOLD = 5;
const at = (b: StoredFleet['from'] | null, c: { g: number; s: number; p: number; type: string }) =>
  !!b && b.coords.g === c.g && b.coords.s === c.s && b.coords.p === c.p && b.type === c.type;

/**
 * Hold fleets at the attacked body at the impact: in every member's newest fleet list (as the viewer may see it) the
 * outbound hold flights to the body landing before the impact and the fleets holding there, unless their holding
 * line ends before the impact. The same fleet in several lists (the sender's and the attacked member's) counts once.
 * Research: the empire page of the member it belongs to.
 */
function holdFleets(db: DB, ctx: GroupContext, attack: HostileAttack, names: Map<number, string>): HoldFleet[] {
  const empires = latestEmpires(db, ctx);
  const memberAt = (c: { g: number; s: number; p: number }) =>
    empires.find((e) => e.rec.planets.some((p) => p.coords.g === c.g && p.coords.s === c.s && p.coords.p === c.p)) ?? null;
  const out = new Map<string, HoldFleet>();
  for (const userId of names.keys()) {
    const list = sharedFleets(db, ctx.groupId, userId, ctx.user.id)?.data ?? [];
    // one flight per owner and start: its outbound line (landing) and its holding line (end of the stay)
    const flights = new Map<string, { out?: StoredFleet; hold?: StoredFleet }>();
    for (const f of list) {
      if (f.mission !== HOLD || f.owner === 'hostile' || !at(f.to, attack.to) || (f.phase !== 'out' && f.phase !== 'hold')) continue;
      const id = `${f.owner}|${f.from.coords.g}:${f.from.coords.s}:${f.from.coords.p}:${f.from.type}`;
      flights.set(id, { ...flights.get(id), [f.phase]: f });
    }
    for (const { out: o, hold: h } of flights.values()) {
      // there at the impact: landed before it (or holding already) and still holding after it
      if ((o && o.arrival >= attack.arrival) || (h && h.arrival <= attack.arrival)) continue;
      const f = (o ?? h)!;
      const ships = Object.fromEntries(Object.entries(f.ships).filter(([, n]) => n > 0));
      if (!Object.keys(ships).length) continue;
      const owner = f.owner === 'own' ? (empires.find((e) => e.userId === userId) ?? null) : memberAt(f.from.coords);
      const key = `${f.from.coords.g}:${f.from.coords.s}:${f.from.coords.p}:${f.from.type}|${JSON.stringify(Object.entries(ships).sort())}`;
      if (out.has(key)) continue;
      out.set(key, {
        member: owner ? (names.get(owner.userId) ?? null) : null, player: f.player ?? f.fromPlayer?.name ?? null,
        from: { ...f.from.coords, type: f.from.type ?? null }, ships, research: owner?.rec.research ?? {}, arrival: o ? o.arrival : null,
      });
    }
  }
  return [...out.values()];
}

/** Ships of the member that left the attacked body after their newest empire page and are not back by the impact. */
export interface SentAway {
  ships: Record<string, number>;
  fleets: number;
  /** no fleet list from before the empire page: fleets in flight may have been away already then (nothing taken off) */
  unknown: boolean;
}

/**
 * Own fleets of the member started from the attacked body that are still away at the impact (outbound, holding, or on
 * the way back landing after it; a deploy elsewhere stays away), from their newest fleet list synced after the empire
 * page. Fleets already in a fleet list synced up to the empire page were away then and are not in its numbers anyway.
 */
function sentAway(db: DB, ctx: GroupContext, memberId: number, body: { g: number; s: number; p: number; type: string }, impact: number, empireTime: number): SentAway {
  const none = { ships: {}, fleets: 0, unknown: false };
  const newest = sharedFleets(db, ctx.groupId, memberId, ctx.user.id);
  if (!newest || newest.time <= empireTime) return none;
  const before = db
    .prepare('SELECT data FROM fleet_snapshots WHERE group_id = ? AND user_id = ? AND page_time <= ? ORDER BY page_time DESC, id DESC LIMIT 1')
    .pluck()
    .get(ctx.groupId, memberId, empireTime + 60) as string | undefined;
  const old = before ? (JSON.parse(before) as StoredFleet[]) : null;
  const same = (a: StoredFleet, b: StoredFleet) =>
    b.owner === 'own' && a.mission === b.mission && a.phase === b.phase && Math.abs(a.arrival - b.arrival) <= TOLERANCE &&
    at(b.from, { ...a.from.coords, type: a.from.type ?? 'planet' });
  const list = newest.data.filter((f) => f.owner === 'own');
  const used = new Set<StoredFleet>();
  const ships: Record<string, number> = {};
  let fleets = 0;
  for (const f of list) {
    if (used.has(f)) continue;
    // the flight's lines from its first one: outbound or holding from the body, or only the way back to it
    const starts = (f.phase === 'out' || f.phase === 'hold') && at(f.from, body);
    const back = f.phase === 'return' && at(f.to, body);
    if (!starts && !back) continue;
    // later lines of the same flight: same mission and ships, between the same ends, the next of each phase
    const shipsOf = (x: StoredFleet) => JSON.stringify(Object.entries(x.ships).filter(([, n]) => n > 0).sort());
    const later = (phase: StoredFleet['phase']) =>
      list
        .filter((x) => !used.has(x) && x !== f && x.phase === phase && x.mission === f.mission && x.arrival > f.arrival && shipsOf(x) === shipsOf(f) &&
          (phase === 'return' ? at(x.from, { ...f.to!.coords, type: f.to!.type ?? 'planet' }) && at(x.to, body) : at(x.from, body)))
        .sort((x, y) => x.arrival - y.arrival)[0];
    const lines = starts ? [f, ...(f.phase === 'out' ? [later('hold')] : []), ...(f.to ? [later('return')] : [])].filter((x): x is StoredFleet => !!x) : [f];
    lines.forEach((x) => used.add(x));
    const home = lines.find((x) => x.phase === 'return' && at(x.to, body));
    if (home ? home.arrival <= impact : f.mission !== 4 && !starts) continue;
    if (old?.some((o) => lines.some((x) => same(x, o)))) continue;
    if (!old) return { ships: {}, fleets: 0, unknown: true };
    fleets++;
    for (const [id, n] of Object.entries(f.ships)) if (n > 0) ships[id] = (ships[id] ?? 0) + n;
  }
  return { ships, fleets, unknown: false };
}

/** The attack by its key, or by member, arrival (± the fleet tolerance) and origin. */
export function findAttack(db: DB, ctx: GroupContext, q: { key?: string; member?: number; arrival?: number; from?: string }): HostileAttack | null {
  const list = hostileAttacks(db, ctx);
  if (q.key) {
    const same = list.filter((a) => a.key === q.key);
    return (q.arrival != null ? same.find((a) => Math.abs(a.arrival - q.arrival!) <= TOLERANCE) : same[0]) ?? null;
  }
  return (
    list.find(
      (a) => a.memberId === q.member && q.arrival != null && Math.abs(a.arrival - q.arrival) <= TOLERANCE && `${a.from.g}:${a.from.s}:${a.from.p}` === q.from,
    ) ?? null
  );
}

export function attackAssist(db: DB, ctx: GroupContext, attack: HostileAttack) {
  const units = catalogOf(ctx.universe);
  const u = ctx.universe.settings;
  const t = ctx.now;
  return withUnits(units, () => {
    // ---- defender: the attacked body from the member's newest empire page
    const empire = attack.memberId != null ? latestEmpire(db, ctx, attack.memberId) : null;
    const body = empire?.rec.planets.find((p) => p.coords.g === attack.to.g && p.coords.s === attack.to.s && p.coords.p === attack.to.p && p.type === attack.to.type) ?? null;
    const research = empire?.rec.research ?? {};
    let resources: Res | null = null;
    if (body?.resources) {
      const factor = u.storageMultiplier ?? 1;
      const at = (id: number) => {
        const cap = storageCapacity(body.values[STORAGE[id]] ?? 0, factor);
        return Math.floor(resourceAt(body.resources![id] ?? 0, body.perHour?.[id] ?? 0, cap, empire!.time, Math.max(attack.arrival, empire!.time)));
      };
      resources = { metal: at(901), crystal: at(902), deuterium: at(903) };
    }
    // ships that left the body since the empire page and are not back by the impact don't defend
    const away = body && attack.memberId != null ? sentAway(db, ctx, attack.memberId, attack.to, attack.arrival, empire!.time) : null;
    const values = body ? { ...body.values } : {};
    for (const [id, n] of Object.entries(away?.ships ?? {})) values[Number(id)] = Math.max(0, (values[Number(id)] ?? 0) - n);
    const planet: ApiSlot | null = body ? planetFromSpy({ ...values, 109: research[109] ?? 0, 110: research[110] ?? 0, 111: research[111] ?? 0 }, attack.member, units).planet : null;

    // ---- attacker: the fleets of the movement with the research of the newest spy reports
    const spy = attack.player ? spyEmpire(db, ctx, attack.player.id, attack.player.name) : null;
    const attackerResearch = spy?.researchTime ? spy.research : {};
    let fleets = attack.fleets.filter((f) => Object.values(f.ships).some((n) => n > 0));
    // the movement shows no ships: the fleet of the newest spy report of the origin (flying ships only) as an estimate
    let estimated: { time: number } | null = null;
    if (!fleets.length) {
      const row = db
        .prepare(
          `SELECT report_time, json_extract(sections, '$."${CLASS_FLEET}"') AS fleet FROM spy_reports WHERE group_id = ? AND g = ? AND s = ? AND p = ? AND planet_type = ?
             AND json_extract(sections, '$."${CLASS_FLEET}"') IS NOT NULL ORDER BY report_time DESC LIMIT 1`,
        )
        .get(ctx.groupId, attack.from.g, attack.from.s, attack.from.p, attack.from.type) as { report_time: number; fleet: string } | undefined;
      const ships = row ? Object.fromEntries(Object.entries(JSON.parse(row.fleet) as Record<string, number>).filter(([id, n]) => n > 0 && (units.drives[id]?.speed.some((v) => v > 0) ?? false))) : {};
      if (Object.keys(ships).length) {
        fleets = [{ mission: attack.fleets[0]?.mission ?? null, ships }];
        estimated = { time: row!.report_time };
      }
    }
    const attackers: ApiSlot[] = fleets.map((f) => ({
      units: Object.fromEntries(Object.entries(f.ships).filter(([, n]) => n > 0)), research: attackerResearch, from: [attack.from.g, attack.from.s, attack.from.p],
      speed: 100, carried: 0, name: attack.player?.name ?? null,
    }));
    const loot = resources && attackers.length ? steal(attackers, resources) : null;

    // ---- helpers: other members' bodies with ships that can still land before the impact
    const helpers: AttackHelper[] = [];
    const names = new Map(
      (db.prepare(`SELECT m.user_id, ${DISPLAY} AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?`).all(ctx.groupId) as
        { user_id: number; name: string }[]).map((r) => [r.user_id, r.name]),
    );
    const holds = holdFleets(db, ctx, attack, names);
    const holding = new Set(holds.map((h) => `${h.from.g}:${h.from.s}:${h.from.p}:${h.from.type}`));
    for (const e of latestEmpires(db, ctx)) {
      if (e.userId === attack.memberId || !names.has(e.userId)) continue;
      const drives = drivesFromResearch(e.rec.research ?? {});
      for (const pl of e.rec.planets) {
        if (holding.has(`${pl.coords.g}:${pl.coords.s}:${pl.coords.p}:${pl.type}`)) continue;
        const ships = Object.fromEntries(Object.keys(units.drives).filter((id) => (pl.values[Number(id)] ?? 0) > 0).map((id) => [id, pl.values[Number(id)]]));
        const slowest = slowestShip(ships, drives, units.drives);
        if (!slowest || slowest.speed <= 0) continue;
        const duration = flightDuration(u, distance(u, [pl.coords.g, pl.coords.s, pl.coords.p], [attack.to.g, attack.to.s, attack.to.p]), slowest.speed, 100);
        const launch = launchFor(attack.arrival - HOLD_LEAD, duration);
        if (launch <= t) continue;
        const points = Math.round(Object.entries(ships).reduce((s, [id, n]) => s + elementPoints(id, n), 0));
        helpers.push({
          userId: e.userId, member: names.get(e.userId)!, from: { ...pl.coords, type: pl.type, name: pl.name }, ships, points, duration: Math.floor(duration), launch,
        });
      }
    }
    helpers.sort((a, b) => b.points - a.points || b.launch - a.launch);

    const plan = db
      .prepare(
        `SELECT a.id FROM attack_plans a JOIN attack_plan_enemy e ON e.plan_id = a.id
         WHERE a.group_id = ? AND a.mission = 'hold' AND a.status IN ('planning', 'launched') AND e.to_g = ? AND e.to_s = ? AND e.to_p = ? AND e.to_type = ?
           AND ABS(e.arrival - ?) <= ? ORDER BY a.id DESC LIMIT 1`,
      )
      .pluck()
      .get(ctx.groupId, attack.to.g, attack.to.s, attack.to.p, attack.to.type, attack.arrival, TOLERANCE) as number | undefined;

    const phalanx = body && body.type === 'planet' ? (phalanxExposure(db, ctx, [{ ...attack.to, name: body.name }])[0]?.threats ?? []) : [];
    return {
      attack,
      member: attack.memberId != null ? { id: attack.memberId, name: names.get(attack.memberId) ?? attack.member } : null,
      target: body
        ? {
            ...attack.to, name: body.name, values: body.values,
            /** `values` without the ships sent away since the empire page: what defends in the simulation and can still be saved */
            present: values,
            resources, empireTime: empire!.time, deuterium: body.resources?.[903] ?? null, perHour: body.perHour ?? null,
          }
        : null,
      /** the member's bodies (fleet save targets) and research (drives) */
      bodies: (empire?.rec.planets ?? []).map((p) => ({ ...p.coords, type: p.type, name: p.name })),
      research,
      attacker: {
        player: attack.player,
        research: spy?.researchTime ? { values: spy.research, time: spy.researchTime } : null,
        /** ships estimated from the newest spy report of the origin (the movement shows none) */
        estimated,
        ships: attackers.reduce<Record<string, number>>((sum, a) => {
          for (const [id, n] of Object.entries(a.units)) sum[id] = (sum[id] ?? 0) + n;
          return sum;
        }, {}),
      },
      loot,
      away,
      helpers: helpers.slice(0, MAX_HELPERS),
      holds,
      holdPlan: plan ?? null,
      phalanx,
      setup: planet && attackers.length ? { attackers, planet, holds, resources } : null,
    };
  });
}

export type AttackAssist = ReturnType<typeof attackAssist>;

/** The battle of the attack on the planet as it is known (`null` without ships or planet; errors as a code). */
export async function attackSimulation(ctx: GroupContext, a: AttackAssist) {
  if (!a.setup) return null;
  try {
    throttle(ctx.user.id);
    const settings = simSettingsOf(ctx.universe.settings, {});
    const { typical, ...summary } = await runInWorker(
      {
        attackers: a.setup.attackers.map((x) => ({ units: x.units, research: x.research })),
        defenders: [{ units: a.setup.planet.units, research: a.setup.planet.research }, ...a.setup.holds.map((h) => ({ units: h.ships, research: h.research }))],
        resources: a.setup.resources ?? undefined,
      },
      RUNS,
      settings,
      ctx.universe.units,
    );
    return { ...summary, rounds: typical.run.rounds, error: null };
  } catch (err) {
    return { error: (err as { code?: string }).code ?? 'sim_failed' };
  }
}
