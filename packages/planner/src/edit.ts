import { levelsAfterQueue, researchAfterQueue, type HubState } from './hub.js';
import type { Base, BuildOrder, Step } from './types.js';

/** A step added by hand: +1 level of a building or research, `count` units of a ship or defense. */
export type NewStep = Pick<Step, 'kind' | 'element' | 'count'> & { kind: 'building' | 'research' | 'ship' | 'defense'; element: number };

/**
 * Inserts steps into a planet's list at `at` (index, clamped; past the end appends). Steps are "+1 level", so an
 * element the build order has no step of yet (on this planet; research in the whole order) starts from the hub's
 * level now (queues included) instead of the base: a base of 0 or an old file level would make the new step a level
 * that is long built. Elements that already have steps keep their base, so existing steps keep their levels.
 * Planets the hub does not know (planned planets) keep their base. `newId` gives the step ids.
 */
export function insertSteps(order: BuildOrder, key: string, add: NewStep[], at: number, hub: HubState, newId: () => string): BuildOrder {
  const list = order.planets[key] ?? [];
  const pos = Math.max(0, Math.min(Math.floor(at), list.length));
  const steps: Step[] = add.map((s) => {
    const step: Step = { id: newId(), kind: s.kind, element: s.element };
    if (s.kind === 'ship' || s.kind === 'defense') step.count = Math.max(1, Math.floor(s.count ?? 1));
    return step;
  });
  const base: Base = { planets: { ...order.base.planets }, research: { ...order.base.research } };
  const planet = hub.planets.find((p) => p.key === key);
  const hasStep = (s: NewStep) =>
    s.kind === 'research'
      ? Object.values(order.planets).some((l) => l.some((x) => x.kind === 'research' && x.element === s.element))
      : list.some((x) => x.kind === s.kind && x.element === s.element);
  for (const s of add) {
    if (hasStep(s)) continue;
    if (s.kind === 'research') base.research[s.element] = researchAfterQueue(hub)[s.element] ?? 0;
    else if (planet) base.planets[key] = { ...base.planets[key], [s.element]: levelsAfterQueue(planet.planet)[s.element] ?? 0 };
  }
  return { base, planets: { ...order.planets, [key]: [...list.slice(0, pos), ...steps, ...list.slice(pos)] } };
}
