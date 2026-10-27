import { computed, ref } from 'vue';
import { api, session, uniApi } from './api';
import { nowSec, upcoming } from './clock';
import type { Fleet } from './components/FleetList.vue';
import { useStored } from './composables';

/**
 * Something the members should notice (server: repo/notifications.ts): hostile fleets on a member, raid planner
 * invitations, new comments in the viewer's threads, the launch of the viewer's plan fleets, the next level of a
 * building the viewer waits for being affordable, the arrival of an own fleet with an alert, a full storage on one of
 * the viewer's planets.
 */
export type Notification =
  | AttackNotification | InviteNotification | CommentNotification | LaunchNotification | BuildingNotification | FleetNotification | StorageNotification;

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

/** New comments of others in a thread the viewer wrote in (`member`: the newest author). */
export interface CommentNotification extends Base {
  kind: 'comment';
  thread: { player: number; name: string } | { plan: number; g: number; s: number; p: number; type: 'planet' | 'moon' } | { g: number; s: number; p: number; type: 'planet' | 'moon'; owner: string | null };
  excerpt: string;
  count: number;
}

/** A fleet of the viewer in a plan has to launch at `time`. */
export interface LaunchNotification extends Base {
  kind: 'launch';
  plan: { id: number; g: number; s: number; p: number; planet_type: 'planet' | 'moon'; mission: 'attack' | 'hold'; target_time: number };
  from: { g: number; s: number; p: number; type: 'planet' | 'moon' };
}

/** The resources for `level` of a building on one of the viewer's planets are there since `time`. */
export interface BuildingNotification extends Base {
  kind: 'building';
  alert: number;
  planet: { g: number; s: number; p: number; type: 'planet' | 'moon'; name: string };
  element: number;
  level: number;
}

/** An own fleet with an alert arrives at `time` (shown from `lead` minutes before). */
export interface FleetNotification extends Base {
  kind: 'fleet';
  alert: number;
  fleet: Fleet;
  lead: number;
}

/** A storage on one of the viewer's planets is full since `time` (production stopped). */
export interface StorageNotification extends Base {
  kind: 'storage';
  planet: { g: number; s: number; p: number; name: string };
  /** 901 metal, 902 crystal, 903 deuterium */
  resource: number;
}

/**
 * An invitation lasts until the end of the plan's day or hour, new comments two days, affordable buildings one day,
 * full storages one day, arrived fleets with an alert ten minutes.
 */
const SPAN = { day: 86400, hour: 3600, exact: 0 };
const COMMENT_SPAN = 48 * 3600;
const BUILDING_SPAN = 24 * 3600;
const FLEET_SPAN = 10 * 60;
const until = (n: Notification) => {
  switch (n.kind) {
    case 'invite':
      return n.time + SPAN[n.plan.time_precision];
    case 'comment':
      return n.time + COMMENT_SPAN;
    case 'building':
    case 'storage':
      return n.time + BUILDING_SPAN;
    case 'fleet':
      return n.time + FLEET_SPAN;
    default:
      return n.time;
  }
};

const list = ref<Notification[]>([]);
/** Seconds now, ticking: arrived fleets drop out without a reload. */
const notifyClock = ref(nowSec());
let ticker: ReturnType<typeof setInterval> | undefined;
/** ids the viewer has seen (opened the list), per browser */
const seen = useStored<string[]>('notifications.seen', []);

/**
 * Fleet alerts come ahead of time and show from `lead` minutes before the arrival on; the key changes only when one
 * comes due, not on every tick.
 */
const dueKey = computed(() => list.value.map((n) => (n.kind !== 'fleet' || n.time - n.lead * 60 <= notifyClock.value ? 1 : 0)).join(''));
const due = computed(() => {
  const k = dueKey.value;
  return list.value.filter((_, i) => k[i] === '1');
});
/** Current notifications, the next first (loaded by the layout, kept up to date by live events). */
export const notifications = upcoming(due, until, notifyClock);
/** Open access requests from the login page (global admins only; they open the admin page). */
export interface AccessRequest {
  id: number;
  username: string;
  message: string;
  created_at: number;
}
export const accessRequests = ref<AccessRequest[]>([]);
const accessId = (r: AccessRequest) => `access:${r.id}`;
export const unseen = computed(
  () => notifications.value.filter((n) => !seen.value.includes(n.id)).length + accessRequests.value.filter((r) => !seen.value.includes(accessId(r))).length,
);
export const attacks = computed(() => notifications.value.filter((n) => n.kind === 'attack').length);

export async function loadNotifications(uni: string) {
  ticker ??= setInterval(() => (notifyClock.value = nowSec()), 1000);
  try {
    list.value = await uniApi<Notification[]>(uni, '/notifications');
  } catch {
    /* kept until the next reload */
  }
  await loadAccessRequests();
}

/** Global admins: the requests waiting for an assignment. */
export async function loadAccessRequests() {
  if (!session.me?.user?.isAdmin) return;
  try {
    accessRequests.value = (await api<{ requests: AccessRequest[] }>('/admin/access-requests')).requests;
  } catch {
    /* kept until the next reload */
  }
}

export function clearNotifications() {
  list.value = [];
  accessRequests.value = [];
}

/** Opening the list marks everything in it as seen; ids of past notifications are dropped. */
export function markSeen() {
  seen.value = [...notifications.value.map((n) => n.id), ...accessRequests.value.map(accessId)];
}
