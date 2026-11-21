import { ref } from 'vue';
import { uniApi } from './api';
import type { Achievements, Badge, MemberAchievements } from './apiTypes';

/** The icon of each badge (Icon.vue). */
export const BADGE_ICONS: Record<Badge['key'], string> = {
  imperator: 'imperium', cartographer: 'galaxy', scout: 'spy', fleeter: 'attack', expeditioner: 'expeditions', trader: 'market',
  socializer: 'messages', chronicler: 'stats', fresh: 'freshness', streak: 'bolt', raider: 'raids', collector: 'cargo', forist: 'comment', miner: 'buildings',
  livingLegend: 'eagle',
};
/** Badges that global admins award by hand (server: `MANUAL_BADGES`): one level, no count. */
export const MANUAL_BADGES: readonly Badge['key'][] = ['livingLegend'];
export const isManualBadge = (key: Badge['key']) => MANUAL_BADGES.includes(key);
/** Colours of the levels: bronze, silver, gold, then platinum, sapphire, amethyst, ruby. */
const LEVEL_COLORS = ['#b87333', '#a9b4bf', '#d4af37', '#5fc9c4', '#4f8ff7', '#b36bf0', '#e5484d'];
/** The colour of a reached level, null for none. */
export const levelColor = (level: number): string | null => (level ? LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length) - 1] : null);
/** Colour of a badge awarded by hand: always gold. */
const MANUAL_COLOR = '#d4af37';
/** The colour of a badge: its level's, gold for one awarded by hand, null while not reached. */
export const badgeColor = (b: Pick<Badge, 'key' | 'level'>): string | null => (b.level && isManualBadge(b.key) ? MANUAL_COLOR : levelColor(b.level));

/** A badge at a level, from the levels' counts (`steps`): for the icon and its tooltip where only key and level are known. */
export function badgeAt(key: Badge['key'], level: number, steps: number[]): Badge {
  return { key, count: steps[level - 1] ?? 0, level, levels: steps.length || level, next: steps[level] ?? null, steps };
}

/** Badges and streaks of the members (server: repo/achievements.ts), shared by the alliance progress page and the online list. */
export const achievements = ref<MemberAchievements[] | null>(null);
let loadedFor = '';
let loadedAt = 0;
let pending: Promise<void> | null = null;
/** The online list reloads at most this often (ms); the alliance progress page forces a reload. */
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

/** The reached badges by value: awarded by hand first, then the highest level (its colour), then the larger share of the levels, then the nearest next level. */
export function topBadges(badges: Badge[], n = 3): Badge[] {
  const progress = (b: Badge) => (b.next ? b.count / b.next : 1);
  return badges
    .filter((b) => b.level > 0)
    .sort((a, b) => +isManualBadge(b.key) - +isManualBadge(a.key) || b.level - a.level || b.level / b.levels - a.level / a.levels || progress(b) - progress(a))
    .slice(0, n);
}
