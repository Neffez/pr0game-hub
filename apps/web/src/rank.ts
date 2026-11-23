import { computed } from 'vue';
import { achievements } from './achievements';
import type { MemberAchievements, Schema } from './apiTypes';

/**
 * The dynamic rank badge (server: repo/rank.ts): each of ten conditions is held by its leader among the members, one
 * point each; the points (0–10) are a rank shown like a military rank in the game's space style before the other
 * badges, wherever a member's name stands.
 */

export type MemberRank = MemberAchievements['rank'];
export type RankCondition = Schema<'RankCondition'>;

/** The conditions in the order of the server. */
export const RANK_CONDITIONS: RankCondition[] = [
  'fleetPoints', 'researchPoints', 'buildingPoints', 'totalPoints', 'unitsDestroyed', 'resources', 'unitsLost', 'winStreak', 'profitRatio', 'playersAttacked',
];
export const RANK_LEVELS = 10;

export type RankMetal = 'bronze' | 'silver' | 'gold' | 'marshal';
/** Gradient stops (top, bottom) of the metals. */
export const RANK_METALS: Record<RankMetal, [string, string, string?]> = {
  bronze: ['#f0b77f', '#94592a'],
  silver: ['#f4f7fa', '#8a96a4'],
  gold: ['#ffe680', '#b8860b'],
  marshal: ['#fff3b0', '#a8740a', '#f2c230'],
};

/**
 * The insignia of the ranks 1–10 in a 24×24 view box: delta-wing chevrons (bronze), hull bars (silver), ringed
 * planet, star in orbit, two stars over a horizon and a star in crossed orbits (gold). `url(#G)` is the metal's
 * gradient, replaced by an id of its own per icon.
 */
export const RANK_GLYPHS: { metal: RankMetal; body: string }[] = [
  { metal: 'bronze', body: '<path d="M2.5 17 L12 9.5 L21.5 17 L19 18.2 L12 13.1 L5 18.2 Z"/>' },
  { metal: 'bronze', body: '<path d="M2.5 13.5 L12 6 L21.5 13.5 L19 14.7 L12 9.6 L5 14.7 Z"/><path d="M2.5 19.5 L12 12 L21.5 19.5 L19 20.7 L12 15.6 L5 20.7 Z"/>' },
  { metal: 'bronze', body: '<path d="M2.5 10.5 L12 3 L21.5 10.5 L19 11.7 L12 6.6 L5 11.7 Z"/><path d="M2.5 16 L12 8.5 L21.5 16 L19 17.2 L12 12.1 L5 17.2 Z"/><path d="M2.5 21.5 L12 14 L21.5 21.5 L19 22.7 L12 17.6 L5 22.7 Z"/>' },
  { metal: 'silver', body: '<path d="M2.5 11.5 L12 4 L21.5 11.5 L19 12.54 L12 7.2 L5 12.54 Z"/><path d="M2.5 16.1 L12 8.6 L21.5 16.1 L19 17.14 L12 11.8 L5 17.14 Z"/><path d="M2.5 20.7 L12 13.2 L21.5 20.7 L19 21.74 L12 16.4 L5 21.74 Z"/><path d="M12 0 Q12 2.2 14.2 2.2 Q12 2.2 12 4.4 Q12 2.2 9.8 2.2 Q12 2.2 12 0Z"/><path d="M3 18.2 Q12 24 21 18.2 L21 20.2 Q12 26.5 3 20.2 Z"/>' },
  { metal: 'silver', body: '<path d="M9.8 20.5 L9.8 7 L12 3 L14.2 7 L14.2 20.5 Z"/>' },
  { metal: 'silver', body: '<path d="M5.6 20.5 L5.6 7 L7.8 3 L10 7 L10 20.5 Z"/><path d="M14 20.5 L14 7 L16.2 3 L18.4 7 L18.4 20.5 Z"/>' },
  { metal: 'gold', body: '<circle cx="12" cy="12" r="6.2"/><ellipse cx="12" cy="12" rx="10.5" ry="3.2" transform="rotate(-22 12 12)" fill="none" stroke="url(#G)" stroke-width="1.6"/><path d="M19.5 2.3 Q19.5 4.5 21.7 4.5 Q19.5 4.5 19.5 6.7 Q19.5 4.5 17.3 4.5 Q19.5 4.5 19.5 2.3Z"/>' },
  { metal: 'gold', body: '<ellipse cx="12" cy="12" rx="10.6" ry="4.2" transform="rotate(-25 12 12)" fill="none" stroke="url(#G)" stroke-width="1.3"/><polygon points="12,5.6 13.58,9.83 18.09,10.02 14.56,12.83 15.76,17.18 12,14.69 8.24,17.18 9.44,12.83 5.91,10.02 10.42,9.83"/><circle cx="2.8" cy="15.6" r="1.6"/>' },
  { metal: 'gold', body: '<path d="M2.5 17.5 Q12 22 21.5 17.5" fill="none" stroke="url(#G)" stroke-width="1.4"/><polygon points="6.6,5.6 7.93,9.17 11.74,9.33 8.76,11.7 9.77,15.37 6.6,13.27 3.43,15.37 4.44,11.7 1.46,9.33 5.27,9.17"/><polygon points="17.4,5.6 18.73,9.17 22.54,9.33 19.56,11.7 20.57,15.37 17.4,13.27 14.23,15.37 15.24,11.7 12.26,9.33 16.07,9.17"/>' },
  { metal: 'marshal', body: '<ellipse cx="12" cy="12" rx="11" ry="3.6" transform="rotate(30 12 12)" fill="none" stroke="url(#G)" stroke-width="1.3"/><ellipse cx="12" cy="12" rx="11" ry="3.6" transform="rotate(-30 12 12)" fill="none" stroke="url(#G)" stroke-width="1.3"/><polygon points="12,4.6 13.83,9.49 19.04,9.71 14.96,12.96 16.35,17.99 12,15.11 7.65,17.99 9.04,12.96 4.96,9.71 10.17,9.49"/><circle cx="12" cy="12" r="1.7" fill="#7fe3ff" stroke="none"/><path d="M21 1 Q21 3 23 3 Q21 3 21 5 Q21 3 19 3 Q21 3 21 1Z"/><path d="M3 19 Q3 21 5 21 Q3 21 3 23 Q3 21 1 21 Q3 21 3 19Z"/>' },
];

/** The members' ranks by user, player and name (from the achievements). */
const index = computed(() => {
  const byUser = new Map<number, MemberRank>();
  const byPlayer = new Map<number, MemberRank>();
  const byName = new Map<string, MemberRank>();
  for (const m of achievements.value ?? []) {
    byUser.set(m.userId, m.rank);
    if (m.playerId != null) byPlayer.set(m.playerId, m.rank);
    byName.set(m.name.toLowerCase(), m.rank);
  }
  return { byUser, byPlayer, byName };
});

/** The rank of a member by user id, player id or display name (the first one given that is known), null for none. */
export function rankOf(who: { userId?: number | null; playerId?: number | null; name?: string | null }): MemberRank | null {
  const i = index.value;
  return (
    (who.userId != null ? i.byUser.get(who.userId) : undefined) ??
    (who.playerId != null ? i.byPlayer.get(who.playerId) : undefined) ??
    (who.name ? i.byName.get(who.name.toLowerCase()) : undefined) ??
    null
  );
}
