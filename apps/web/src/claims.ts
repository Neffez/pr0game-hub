import { ref } from 'vue';
import { uniApi } from './api';
import { upcoming } from './clock';

/** Target a member claimed for a while (server: routes/claims.ts). */
export interface Claim {
  id: number;
  user_id: number;
  member: string;
  g: number;
  s: number;
  p: number;
  planet_type: 'planet' | 'moon';
  kind: 'farm' | 'attack' | 'spy';
  note: string | null;
  created_at: number;
  expires_at: number;
  player_id: number | null;
  player_name: string | null;
  planet_name: string | null;
}

export const CLAIM_KINDS = ['farm', 'attack', 'spy'] as const;
/** Durations offered when claiming or extending, in minutes. */
export const CLAIM_MINUTES = [30, 60, 120, 240, 480, 1440];

const claims = ref<Claim[]>([]);
/** Seconds now, ticking: claims run out without a reload. */
export const clock = ref(Math.floor(Date.now() / 1000));
let ticker: ReturnType<typeof setInterval> | undefined;

/** Active claims of the group (loaded by the layout, kept up to date by live events). */
export const activeClaims = upcoming(claims, (c) => c.expires_at, clock);

export async function loadClaims(uni: string) {
  ticker ??= setInterval(() => (clock.value = Math.floor(Date.now() / 1000)), 15_000);
  try {
    claims.value = await uniApi<Claim[]>(uni, '/claims');
    clock.value = Math.floor(Date.now() / 1000);
  } catch {
    /* kept until the next reload */
  }
}

export function clearClaims() {
  claims.value = [];
}

export const claimOf = (g: number, s: number, p: number, type: 'planet' | 'moon') =>
  activeClaims.value.find((c) => c.g === g && c.s === s && c.p === p && c.planet_type === type) ?? null;

/** Time left, "1:05 h" or "25 min". */
export function remaining(c: Claim): string {
  const min = Math.max(1, Math.ceil((c.expires_at - clock.value) / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
}
