import { computed, ref } from 'vue';
import { uniApi } from './api';
import type { Fleet } from './components/FleetList.vue';
import { useStored } from './composables';

/** Something the members should notice (server: routes/notifications.ts); for now hostile fleets on a member. */
export interface Notification {
  id: string;
  kind: 'attack';
  userId: number;
  member: string;
  time: number;
  /** for an ACS: the lead fleet with the ships of all its fleets */
  fleet: Fleet;
  /** number of fleets of an ACS, 1 for a single fleet */
  fleets: number;
}

const list = ref<Notification[]>([]);
/** Seconds now, ticking: arrived fleets drop out without a reload. */
export const notifyClock = ref(Math.floor(Date.now() / 1000));
let ticker: ReturnType<typeof setInterval> | undefined;
/** ids the viewer has seen (opened the list), per browser */
const seen = useStored<string[]>('notifications.seen', []);

/** Current notifications, the next first (loaded by the layout, kept up to date by live events). */
export const notifications = computed(() => list.value.filter((n) => n.time > notifyClock.value));
export const unseen = computed(() => notifications.value.filter((n) => !seen.value.includes(n.id)).length);
export const attacks = computed(() => notifications.value.filter((n) => n.kind === 'attack').length);

export async function loadNotifications(uni: string) {
  ticker ??= setInterval(() => (notifyClock.value = Math.floor(Date.now() / 1000)), 1000);
  try {
    list.value = await uniApi<Notification[]>(uni, '/notifications');
  } catch {
    /* kept until the next reload */
  }
}

export function clearNotifications() {
  list.value = [];
}

/** Opening the list marks everything in it as seen; ids of past notifications are dropped. */
export function markSeen() {
  seen.value = notifications.value.map((n) => n.id);
}
