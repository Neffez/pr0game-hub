import { detectDone, simulate, type BuildOrder, type OwnFleet, type Simulation, type Step, type StepResult } from '@pr0hub/planner';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import type { BuildingPlanet, BuildingsState } from './buildings.js';
import { fleetHistory, sharedFleets, type StoredFleet } from './fleets.js';

/**
 * A member's build order (`build_orders`): the steps per planet with their base, and where it came from (`meta`, as
 * the import dialog sent it: the file's settings, the planet mapping, actions left out).
 */
export interface StoredBuildOrder {
  order: BuildOrder;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export function buildOrderOf(db: DB, ctx: Pick<GroupContext, 'groupId'>, userId: number): StoredBuildOrder | null {
  const row = db.prepare('SELECT data, meta, created_at, updated_at FROM build_orders WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId) as
    | { data: string; meta: string; created_at: number; updated_at: number }
    | undefined;
  if (!row) return null;
  return { order: JSON.parse(row.data) as BuildOrder, meta: JSON.parse(row.meta) as Record<string, unknown>, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** The member's own fleet movements (newest list and history since `since`), planets by hub key. */
function ownFleets(db: DB, groupId: number, userId: number, since: number): OwnFleet[] {
  const key = (b: StoredFleet['from']) => `${b.coords.g}:${b.coords.s}:${b.coords.p}:${b.type ?? 'planet'}`;
  const list = [...(sharedFleets(db, groupId, userId, userId)?.data ?? []), ...fleetHistory(db, groupId, userId, userId, since)];
  return list
    .filter((f) => f.owner === 'own' && f.phase === 'out' && f.to && f.resources)
    .map((f) => ({ from: key(f.from), to: key(f.to!), mission: f.mission, resources: f.resources!, arrival: f.arrival }));
}

/**
 * Checks off the production and transport steps the synced pages show as done (empire page's production setting, own
 * transports after the import) and keeps that, so it stays when the setting changes again or the fleet drops out of
 * the history. Returns the build order as stored now.
 */
export function syncBuildOrder(db: DB, ctx: Pick<GroupContext, 'groupId'>, userId: number, stored: StoredBuildOrder, state: BuildingsState): StoredBuildOrder {
  const ids = new Set(detectDone(stored.order, state, ownFleets(db, ctx.groupId, userId, stored.createdAt), stored.createdAt));
  if (!ids.size) return stored;
  const planets = Object.fromEntries(
    Object.entries(stored.order.planets).map(([key, steps]) => [key, steps.map((s): Step => (ids.has(s.id) ? { ...s, done: true } : s))]),
  );
  const order = { ...stored.order, planets };
  db.prepare('UPDATE build_orders SET data = ? WHERE group_id = ? AND user_id = ?').run(JSON.stringify(order), ctx.groupId, userId);
  return { ...stored, order };
}

/** The next step of a planet's list and when it can start by the timeline (`start` <= now: it can start now). */
export interface NextStep {
  planet: BuildingPlanet;
  step: Step;
  result: StepResult;
}

/** The timeline of the build order from the member's hub state at `t`. */
export function buildOrderTimeline(order: BuildOrder, state: BuildingsState, t: number): Simulation {
  return simulate(order, state, { now: t });
}

/** The next open step of every planet of the build order that is still a synced planet. */
export function nextSteps(order: BuildOrder, state: BuildingsState, t: number): NextStep[] {
  const sim = buildOrderTimeline(order, state, t);
  const out: NextStep[] = [];
  for (const [key, id] of Object.entries(sim.next)) {
    const planet = state.planets.find((p) => p.key === key);
    const step = order.planets[key]?.find((s) => s.id === id);
    const result = sim.steps.find((s) => s.id === id);
    if (planet && step && result) out.push({ planet, step, result });
  }
  return out;
}
