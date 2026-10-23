import { computed, ref } from 'vue';
import { uniApi } from './api';
import { nowSec, upcoming } from './clock';
import type { Fleet } from './components/FleetList.vue';
import { useStored } from './composables';

/** Something the members should notice (server: routes/notifications.ts): hostile fleets on a member, raid planner invitations. */
export type Notification = AttackNotification | InviteNotification;

interface Base {
  id: string;
  userId: number;
  member: string;
  time: number;
}

export interface AttackNotification extends Base {
  kind: 'attack';
  /** for an ACS: the lead fleet with the ships of all its fleets */
  fleet: Fleet;
  /** number of fleets of an ACS, 1 for a single fleet */
  fleets: number;
}

/** The viewer is invited to a plan (`member`: its creator). */
export interface InviteNotification extends Base {
  kind: 'invite';
  plan: {
    id: number; g: number | null; s: number | null; p: number | null; planet_type: 'planet' | 'moon'; mission: 'attack' | 'hold';
    time_precision: 'day' | 'hour' | 'exact';
  };
}

/** An invitation lasts until the end of the plan's day or hour. */
const SPAN = { day: 86400, hour: 3600, exact: 0 };
const until = (n: Notification) => (n.kind === 'invite' ? n.time + SPAN[n.plan.time_precision] : n.time);

const list = ref<Notification[]>([]);
/** Seconds now, ticking: arrived fleets drop out without a reload. */
const notifyClock = ref(nowSec());
let ticker: ReturnType<typeof setInterval> | undefined;
/** ids the viewer has seen (opened the list), per browser */
const seen = useStored<string[]>('notifications.seen', []);

/** Current notifications, the next first (loaded by the layout, kept up to date by live events). */
export const notifications = upcoming(list, until, notifyClock);
export const unseen = computed(() => notifications.value.filter((n) => !seen.value.includes(n.id)).length);
export const attacks = computed(() => notifications.value.filter((n) => n.kind === 'attack').length);

export async function loadNotifications(uni: string) {
  ticker ??= setInterval(() => (notifyClock.value = nowSec()), 1000);
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
