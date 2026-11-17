import { assignSynced, detectDone, simulate, withPlanned, type BuildOrder, type HubState, type OwnFleet, type Simulation, type Step, type StepResult } from '@pr0hub/planner';
import { planetStartResources, type UniverseSettings } from '@pr0hub/core/universe';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { buildingsState, pruneAlerts, type BuildingPlanet, type BuildingsState } from './buildings.js';
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
  /**
   * Raised on every client write and on the automatic assignment of a planned planet (not when a sync only stores
   * steps seen done): the version clients base their changes on (ETag / If-Match).
   */
  revision: number;
}

export function buildOrderOf(db: DB, ctx: Pick<GroupContext, 'groupId'>, userId: number): StoredBuildOrder | null {
  const row = db.prepare('SELECT data, meta, created_at, updated_at, revision FROM build_orders WHERE group_id = ? AND user_id = ?').get(ctx.groupId, userId) as
    | { data: string; meta: string; created_at: number; updated_at: number; revision: number }
    | undefined;
  if (!row) return null;
  return {
    order: JSON.parse(row.data) as BuildOrder, meta: JSON.parse(row.meta) as Record<string, unknown>, createdAt: row.created_at, updatedAt: row.updated_at,
    revision: row.revision,
  };
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
export function syncBuildOrder(
  db: DB, ctx: Pick<GroupContext, 'groupId'>, userId: number, stored: StoredBuildOrder, state: BuildingsState, persist = true,
): StoredBuildOrder {
  const ids = new Set(detectDone(stored.order, state, ownFleets(db, ctx.groupId, userId, stored.createdAt), stored.createdAt));
  if (!ids.size) return stored;
  const planets = Object.fromEntries(
    Object.entries(stored.order.planets).map(([key, steps]) => [key, steps.map((s): Step => (ids.has(s.id) ? { ...s, done: true } : s))]),
  );
  const order = { ...stored.order, planets };
  // the revision stays: storing what the game shows done must not invalidate the clients' copies (a step sent back
  // as not done is checked off again by the next sync)
  if (persist) db.prepare('UPDATE build_orders SET data = ? WHERE group_id = ? AND user_id = ?').run(JSON.stringify(order), ctx.groupId, userId);
  return { ...stored, order };
}

/** The next step of a planet's list and when it can start by the timeline (`start` <= now: it can start now). */
export interface NextStep {
  planet: BuildingPlanet;
  step: Step;
  result: StepResult;
}

/**
 * The timeline of the build order from the member's hub state at `t`; planned planets are simulated as new planets
 * (start planets before the first sync, colonies once their colonization lands, colonies without one from now on
 * without counting against the planet limit, see `simulate`). With the universe's settings transports with ships
 * fly by the flight formula and colonizations wait for astrophysics.
 */
export function buildOrderTimeline(order: BuildOrder, state: BuildingsState, t: number, universe?: UniverseSettings): Simulation {
  return simulate(order, timelineHub(order, state, t, universe), { now: t, units: state.units, universe });
}

/** The hub state the timeline simulates: the member's state plus the build order's planned planets as new planets. */
export function timelineHub(order: BuildOrder, state: BuildingsState, t: number, universe?: UniverseSettings): HubState {
  const home = state.planets.find((p) => p.type === 'planet');
  const resources = planetStartResources(universe, home?.planet);
  return withPlanned(order, state, t, { resources, universe, home: home?.planet });
}

/** The next open step of every planet of the build order that is still a synced planet. */
export function nextSteps(order: BuildOrder, state: BuildingsState, t: number, universe?: UniverseSettings): NextStep[] {
  const sim = buildOrderTimeline(order, state, t, universe);
  const out: NextStep[] = [];
  for (const [key, id] of Object.entries(sim.next)) {
    const planet = state.planets.find((p) => p.key === key);
    const step = order.planets[key]?.find((s) => s.id === id);
    const result = sim.steps.find((s) => s.id === id);
    if (planet && step && result) out.push({ planet, step, result });
  }
  return out;
}

/**
 * Stores what the member's synced pages now show (after a paste): build order steps seen done are checked off and
 * alerts of built or queued levels are removed. The GETs only show this, they do not write.
 */
export function catchUpBuildState(db: DB, ctx: GroupContext): void {
  const state = buildingsState(db, ctx, ctx.user.id);
  pruneAlerts(db, ctx, state);
  const found = buildOrderOf(db, ctx, ctx.user.id);
  if (!found || !state.planets.length) return;
  const stored = syncBuildOrder(db, ctx, ctx.user.id, found, state);
  // a planned planet whose coordinates are synced now (the colony was founded) moves there
  const assigned = assignSynced(stored.order, state.planets.filter((p) => p.type === 'planet').map((p) => p.key));
  if (!assigned) return;
  const meta = stored.meta as { mapping?: Record<string, string | null> };
  if (meta.mapping) meta.mapping = Object.fromEntries(Object.entries(meta.mapping).map(([id, k]) => [id, (k && assigned.moved[k]) || k]));
  // steps move to new keys: a client's copy is stale now
  db.prepare('UPDATE build_orders SET data = ?, meta = ?, revision = revision + 1 WHERE group_id = ? AND user_id = ?').run(
    JSON.stringify(assigned.order), JSON.stringify(meta), ctx.groupId, ctx.user.id,
  );
}
