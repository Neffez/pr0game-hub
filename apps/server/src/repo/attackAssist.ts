import { steal } from '@pr0hub/battle';
import { resourceAt } from '@pr0hub/core/buildings';
import { elementPoints, STORAGE, storageCapacity } from '@pr0hub/core/tech';
import { withUnits } from '@pr0hub/core/units';
import { distance, drivesFromResearch, flightDuration, launchFor, slowestShip } from '@pr0hub/flight';
import { planetFromSpy, runInWorker, simSettingsOf, throttle, type ApiSlot } from '../battle.js';
import { catalogOf, type GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { latestEmpire, latestEmpires, spyEmpire } from './empire.js';
import { TOLERANCE } from './fleets.js';
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
    const planet: ApiSlot | null = body ? planetFromSpy({ ...body.values, 109: research[109] ?? 0, 110: research[110] ?? 0, 111: research[111] ?? 0 }, attack.member, units).planet : null;

    // ---- attacker: the fleets of the movement with the research of the newest spy reports
    const spy = attack.player ? spyEmpire(db, ctx, attack.player.id, attack.player.name) : null;
    const attackerResearch = spy?.researchTime ? spy.research : {};
    const fleets = attack.fleets.filter((f) => Object.values(f.ships).some((n) => n > 0));
    const attackers: ApiSlot[] = fleets.map((f) => ({
      units: Object.fromEntries(Object.entries(f.ships).filter(([, n]) => n > 0)), research: attackerResearch, from: [attack.from.g, attack.from.s, attack.from.p],
      speed: 100, carried: 0, name: attack.player?.name ?? null,
    }));
    const loot = resources && attackers.length ? steal(attackers, resources) : null;

    // ---- helpers: other members' bodies with ships that can still land before the impact
    const helpers: AttackHelper[] = [];
    const names = new Map(
      (db.prepare('SELECT m.user_id, COALESCE(m.ingame_name, u.username) AS name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ?').all(ctx.groupId) as
        { user_id: number; name: string }[]).map((r) => [r.user_id, r.name]),
    );
    for (const e of latestEmpires(db, ctx)) {
      if (e.userId === attack.memberId || !names.has(e.userId)) continue;
      const drives = drivesFromResearch(e.rec.research ?? {});
      for (const pl of e.rec.planets) {
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
        ? { ...attack.to, name: body.name, values: body.values, resources, empireTime: empire!.time, deuterium: body.resources?.[903] ?? null, perHour: body.perHour ?? null }
        : null,
      /** the member's bodies (fleet save targets) and research (drives) */
      bodies: (empire?.rec.planets ?? []).map((p) => ({ ...p.coords, type: p.type, name: p.name })),
      research,
      attacker: {
        player: attack.player,
        research: spy?.researchTime ? { values: spy.research, time: spy.researchTime } : null,
        ships: attackers.reduce<Record<string, number>>((sum, a) => {
          for (const [id, n] of Object.entries(a.units)) sum[id] = (sum[id] ?? 0) + n;
          return sum;
        }, {}),
      },
      loot,
      helpers: helpers.slice(0, MAX_HELPERS),
      holdPlan: plan ?? null,
      phalanx,
      setup: planet && attackers.length ? { attackers, planet, resources } : null,
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
        defenders: [{ units: a.setup.planet.units, research: a.setup.planet.research }],
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
