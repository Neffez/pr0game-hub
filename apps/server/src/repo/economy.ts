import { deriveResourceSpeed } from '@pr0hub/core/production';
import type { GroupContext } from '../context.js';
import type { DB } from '../db.js';
import { storageFactorOf } from './buildings.js';
import { latestEmpire, latestEmpires } from './empire.js';

export interface Economy {
  /** resource multiplier as a factor (game `resource_multiplier` / 2500) */
  resourceSpeed: number;
  /** where it comes from: the universe setting, the members' synced production, or 1x for lack of both */
  speedSource: 'settings' | 'empire' | 'default';
  /** storage capacity factor (from the viewer's empire page, else the universe setting) */
  storageFactor: number;
}

const cache = new WeakMap<GroupContext, Economy>();

/** Production settings of the universe for projections of foreign planets, once per request. */
export function economyOf(db: DB, ctx: GroupContext): Economy {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const settings = ctx.universe.settings;
  let resourceSpeed = settings.resourceMultiplier ? settings.resourceMultiplier / 2500 : null;
  let speedSource: Economy['speedSource'] = 'settings';
  if (resourceSpeed == null) {
    resourceSpeed = deriveResourceSpeed(
      latestEmpires(db, ctx).flatMap((e) => e.rec.planets.filter((p) => p.type === 'planet').map((p) => ({ levels: p.values, research: e.rec.research, temp: p.temp, perHour: p.perHour }))),
    );
    speedSource = resourceSpeed != null ? 'empire' : 'default';
    resourceSpeed ??= 1;
  }
  const own = latestEmpire(db, ctx, ctx.user.id);
  const storageFactor = storageFactorOf(own?.rec ?? null, null) ?? settings.storageMultiplier ?? 1;
  const out = { resourceSpeed, speedSource, storageFactor };
  cache.set(ctx, out);
  return out;
}
