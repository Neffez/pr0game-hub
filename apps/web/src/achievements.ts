import { ref } from 'vue';
import { uniApi } from './api';
import type { Achievements, Badge, MemberAchievements } from './apiTypes';

/** Badges and streaks of the members (server: repo/achievements.ts), shared by the health page and the online list. */
export const achievements = ref<MemberAchievements[] | null>(null);
let loadedFor = '';
let loadedAt = 0;
let pending: Promise<void> | null = null;
/** The online list reloads at most this often (ms); the health page forces a reload. */
const FRESH_MS = 5 * 60_000;

export function loadAchievements(uni: string, force = false): Promise<void> {
  if (!force && loadedFor === uni && (pending || (achievements.value && Date.now() - loadedAt < FRESH_MS))) return pending ?? Promise.resolve();
  if (loadedFor !== uni) achievements.value = null;
  loadedFor = uni;
  const run = uniApi<Achievements>(uni, '/achievements')
    .then((res) => {
      if (loadedFor !== uni) return;
      achievements.value = res.members;
      loadedAt = Date.now();
    })
    .catch(() => {
      /* optional */
    })
    .finally(() => {
      if (pending === run) pending = null;
    });
  pending = run;
  return run;
}

/** The badges a member shows next to the name: the highest levels first, then the nearest next level. */
export function topBadges(badges: Badge[], n = 3): Badge[] {
  const progress = (b: Badge) => (b.next ? b.count / b.next : 1);
  return badges
    .filter((b) => b.level > 0)
    .sort((a, b) => b.level / b.levels - a.level / a.levels || b.level - a.level || progress(b) - progress(a))
    .slice(0, n);
}
