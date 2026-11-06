import { ref } from 'vue';
import { uniApi } from './api';

/** What the member should paste next (server: repo/syncHints.ts), most important first. */
export interface SyncHint {
  key: 'empire' | 'stats' | 'overview' | 'galaxy' | 'buildings' | 'research' | 'messages' | 'market';
  level: 'high' | 'medium' | 'low';
  scope: 'me' | 'group';
  time: number | null;
  count?: number;
  total?: number;
  update?: number;
  /** stats: `update` is expected after the interval learned from the synced updates, not synced yet */
  estimated?: boolean;
  interval?: number;
  types?: number[];
}

/** Shared by the sync page, the quick sync sheet and the overview: one request, reloaded after a sync. */
export const syncHints = ref<SyncHint[] | null>(null);
export const messagesDays = ref(14);
let loadedFor = '';
let pending: Promise<void> | null = null;

export function loadSyncHints(uni: string, force = false): Promise<void> {
  if (!force && loadedFor === uni && (pending || syncHints.value)) return pending ?? Promise.resolve();
  if (loadedFor !== uni) syncHints.value = null;
  loadedFor = uni;
  const run = uniApi<{ hints: SyncHint[]; messagesDays: number }>(uni, '/sync-hints')
    .then((res) => {
      if (loadedFor !== uni) return;
      syncHints.value = res.hints;
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
}
