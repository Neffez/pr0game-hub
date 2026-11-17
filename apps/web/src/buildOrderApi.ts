import { ApiError, uniApi } from './api';
import type { BuildOrderAnswer, StoredBuildOrder } from './apiTypes';
import { t } from './i18n';

/** A write of the build order: method, path below `/build-order` (`/assign`) and body. */
export interface BuildOrderWrite {
  method: 'PUT' | 'PATCH' | 'POST' | 'DELETE';
  path?: '' | '/assign';
  body?: unknown;
}

/**
 * The build order was changed elsewhere (another tab, a script, an assistant) and the change could not be applied to
 * the new one: `current` is the build order now (show it instead of the stale copy).
 */
export class BuildOrderChanged extends Error {
  constructor(public current: BuildOrderAnswer) {
    super(t('buildOrder.changedElsewhere'));
  }
}

/** The current build order of a 412 answer (the write was based on an older revision), else null. */
export function conflictOf(e: unknown): BuildOrderAnswer | null {
  if (!(e instanceof ApiError) || e.status !== 412 || e.code !== 'build_order_conflict') return null;
  const data = e.data as Partial<BuildOrderAnswer> | undefined;
  return { buildOrder: data?.buildOrder ?? null };
}

/** The precondition of a write based on `base`: its revision, or none may exist yet. */
const preconditionOf = (base: StoredBuildOrder | null): Record<string, string> =>
  base ? { 'if-match': `"${base.revision}"` } : { 'if-none-match': '*' };

/**
 * Writes a change of the viewer's build order based on `base` (the copy the page shows), so that changes made
 * elsewhere in between are not overwritten: the server refuses a stale revision with the current build order, the
 * change is built again on that one and sent once more. `change` builds the request from a build order (null: there
 * is none); it returns null when the change no longer applies to it, then `BuildOrderChanged` is thrown with the
 * current build order. Returns the answer of the write (the stored build order with its new revision).
 */
export async function changeBuildOrder(
  uni: string,
  base: StoredBuildOrder | null,
  change: (from: StoredBuildOrder | null) => BuildOrderWrite | null,
  tries = 3,
): Promise<BuildOrderAnswer> {
  let from = base;
  for (let attempt = 1; ; attempt++) {
    const write = change(from);
    if (!write) throw new BuildOrderChanged({ buildOrder: from });
    try {
      return await uniApi<BuildOrderAnswer>(uni, `/build-order${write.path ?? ''}`, { method: write.method, body: write.body, headers: preconditionOf(from) });
    } catch (e) {
      const current = conflictOf(e);
      if (!current) throw e;
      if (attempt >= tries) throw new BuildOrderChanged(current);
      from = current.buildOrder;
    }
  }
}
