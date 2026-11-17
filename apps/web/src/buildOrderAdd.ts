import { uniApi } from './api';
import type { BuildOrderAnswer } from './apiTypes';
import { changeBuildOrder } from './buildOrderApi';

/** A step for the build order: +1 level of a building or research, or `count` ships or defense units. */
export interface NewStep {
  kind: 'building' | 'research' | 'ship';
  element: number;
  count?: number;
}

/**
 * Puts steps into the viewer's build order for the planet `key`: after the steps checked off (next in line), or starts a
 * build order from `base` (the current levels) when there is none. `source` marks who started it (`meta.source`).
 * Changed elsewhere in between, the steps go into the build order as it is then.
 */
export async function addToBuildOrder(
  uni: string,
  key: string,
  steps: NewStep[],
  base: () => { planets: Record<string, Record<string, number>>; research: Record<string, number> },
  source: string,
): Promise<void> {
  const stamp = Date.now().toString(36);
  const list = steps.map((s, i) => ({ id: `${source.slice(0, 3)}-${stamp}-${i}`, ...s }));
  const { buildOrder } = await uniApi<BuildOrderAnswer>(uni, '/build-order');
  await changeBuildOrder(uni, buildOrder, (from) => {
    if (!from) return { method: 'PUT', body: { order: { base: base(), planets: { [key]: list } }, meta: { source } } };
    const planned = [...(from.order.planets[key] ?? [])];
    let at = 0;
    while (at < planned.length && planned[at].done) at++;
    planned.splice(at, 0, ...(list as typeof planned));
    return { method: 'PATCH', body: { planets: { ...from.order.planets, [key]: planned } } };
  });
}
