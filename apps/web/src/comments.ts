import { ref } from 'vue';
import { uniApi } from './api';

/** Number of comments per player id and per planet "g:s:p:type" of the group (server: routes/comments.ts). */
const counts = ref<{ players: Record<number, number>; planets: Record<string, number> }>({ players: {}, planets: {} });

/** Loaded by the layout, again when comments change (live events). */
export async function loadCommentCounts(uni: string) {
  try {
    counts.value = await uniApi(uni, '/comments/counts');
  } catch {
    /* badges only */
  }
}

export function clearCommentCounts() {
  counts.value = { players: {}, planets: {} };
}

export const planetComments = (g: number, s: number, p: number, type: 'planet' | 'moon') => counts.value.planets[`${g}:${s}:${p}:${type}`] ?? 0;
export const playerComments = (id: number) => counts.value.players[id] ?? 0;
