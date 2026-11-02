import { simulate, type BuildOrder, type Simulation, type Step, type StepResult } from '@pr0hub/planner';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import type { BuildingPlanet, BuildingsState } from './buildings.js';

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
