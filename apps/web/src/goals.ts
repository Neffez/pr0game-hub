import { ref } from 'vue';
import { uniApi } from './api';
import type { Goal, Goals } from './apiTypes';

/** Alliance goals (server: repo/goals.ts), shared by the goals card and the overview's sync section head. */
export const goals = ref<Goal[] | null>(null);
let loadedFor = '';
let pending: Promise<void> | null = null;

export function loadGoals(uni: string, force = false): Promise<void> {
  if (!force && loadedFor === uni && (pending || goals.value)) return pending ?? Promise.resolve();
  if (loadedFor !== uni) goals.value = null;
  loadedFor = uni;
  const run = uniApi<Goals>(uni, '/goals')
    .then((res) => {
      if (loadedFor === uni) goals.value = res.goals;
    })
    .catch(() => {
      /* optional: kept until the next load */
    })
    .finally(() => {
      if (pending === run) pending = null;
    });
  pending = run;
  return run;
}

/** Goals at their target (a goal without a value yet is not). */
export const reachedGoals = (list: Goal[]) => list.filter((g) => g.value != null && g.value >= g.target).length;
