import { ref } from 'vue';
import { uniApi } from './api';
import type { Freshness, OwnSyncTimes, SyncHint, SyncHints } from './apiTypes';

export type { OwnSyncTimes, SyncHint } from './apiTypes';

/** Shared by the sync page, the quick sync sheet, the overview and the "data outdated" notes: one request, reloaded after a sync. */
export const syncHints = ref<SyncHint[] | null>(null);
/** When the member last synced the own pages other pages calculate with (server: `ownSyncTimes`). */
export const syncTimes = ref<OwnSyncTimes | null>(null);
/** How fresh the member's own pages are (server: `myFreshness`). */
export const freshness = ref<Freshness | null>(null);
export const messagesDays = ref(14);
let loadedFor = '';
let pending: Promise<void> | null = null;

export function loadSyncHints(uni: string, force = false): Promise<void> {
  if (!force && loadedFor === uni && (pending || syncHints.value)) return pending ?? Promise.resolve();
  if (loadedFor !== uni) {
    syncHints.value = null;
    syncTimes.value = null;
    freshness.value = null;
  }
  loadedFor = uni;
  const run = uniApi<SyncHints>(uni, '/sync-hints')
    .then((res) => {
      if (loadedFor !== uni) return;
      syncHints.value = res.hints;
      syncTimes.value = res.times;
      freshness.value = res.freshness;
      messagesDays.value = res.messagesDays;
    })
    .catch(() => {
      /* hints are optional: kept until the next load */
    })
    .finally(() => {
      if (pending === run) pending = null;
    });
  pending = run;
  return run;
}

/** After a sync or a group switch: load again on the next use. */
export const refreshSyncHints = (uni: string) => loadSyncHints(uni, true);
export function clearSyncHints() {
  loadedFor = '';
  syncHints.value = null;
  syncTimes.value = null;
  freshness.value = null;
}
