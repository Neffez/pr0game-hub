import { uniApi } from './api';
import type { StoredBuildOrder } from './components/BuildOrder.vue';

/** A step for the build order: +1 level of a building or research, or `count` ships or defense units. */
export interface NewStep {
  kind: 'building' | 'research' | 'ship';
  element: number;
  count?: number;
}

/**
 * Puts steps into the viewer's build order for the planet `key`: after the steps checked off (next in line), or starts a
 * build order from `base` (the current levels) when there is none. `source` marks who started it (`meta.source`).
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
  const { buildOrder } = await uniApi<{ buildOrder: StoredBuildOrder | null }>(uni, '/build-order');
  if (buildOrder) {
    const planned = [...(buildOrder.order.planets[key] ?? [])];
    let at = 0;
    while (at < planned.length && planned[at].done) at++;
    planned.splice(at, 0, ...(list as typeof planned));
    await uniApi(uni, '/build-order', { method: 'PATCH', body: { planets: { ...buildOrder.order.planets, [key]: planned } } });
  } else {
    await uniApi(uni, '/build-order', { method: 'PUT', body: { order: { base: base(), planets: { [key]: list } }, meta: { source } } });
  }
}
