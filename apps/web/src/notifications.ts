import { computed, ref } from 'vue';
import { api, session, uniApi } from './api';
import type { AccessRequests, ApiResponse, Schema } from './apiTypes';
import { nowSec, upcoming } from './clock';
import { useStored } from './composables';

/**
 * Something the members should notice (server: repo/notifications.ts): hostile fleets on a member, raid planner
 * invitations, new comments in the viewer's threads, the launch of the viewer's plan fleets, the next level of a
 * building the viewer waits for being affordable, the arrival of an own fleet with an alert, a full storage on one of
 * the viewer's planets, a hostile sensor phalanx newly known to reach the viewer's planets, a free expedition slot.
 */
export type Notification = Schema<'Notification'>;
export type AttackNotification = Schema<'AttackNotification'>;
export type InviteNotification = Schema<'InviteNotification'>;
export type CommentNotification = Schema<'CommentNotification'>;
export type LaunchNotification = Schema<'LaunchNotification'>;
export type BuildingNotification = Schema<'BuildingNotification'>;
export type FleetNotification = Schema<'FleetNotification'>;
export type StorageNotification = Schema<'StorageNotification'>;
export type BuildOrderNotification = Schema<'BuildOrderNotification'>;
export type SettlementNotification = Schema<'SettlementNotification'>;
export type PhalanxNotification = Schema<'PhalanxNotification'>;
export type ExpeditionNotification = Schema<'ExpeditionNotification'>;

/**
 * An invitation lasts until the end of the plan's day or hour, new comments two days, affordable buildings one day,
 * full storages and new hostile phalanxes one day, arrived fleets with an alert ten minutes, free expedition slots six
 * hours (the server drops them earlier with a newer fleet list).
 */
const SPAN = { day: 86400, hour: 3600, exact: 0 };
const COMMENT_SPAN = 48 * 3600;
const BUILDING_SPAN = 24 * 3600;
const FLEET_SPAN = 10 * 60;
const EXPEDITION_SPAN = 6 * 3600;
const until = (n: Notification) => {
  switch (n.kind) {
    case 'invite':
      return n.time + SPAN[n.plan.time_precision];
    case 'comment':
      return n.time + COMMENT_SPAN;
    case 'building':
    case 'storage':
    case 'buildorder':
    case 'phalanx':
      return n.time + BUILDING_SPAN;
    case 'fleet':
      return n.time + FLEET_SPAN;
    case 'expedition':
      return n.time + EXPEDITION_SPAN;
    case 'settlement':
      return n.time + 2 * 86400;
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
/** Open access requests from the login page (global and alliance admins; they open the admin page). */
export type AccessRequest = AccessRequests['requests'][number];
export const accessRequests = ref<AccessRequest[]>([]);
const accessId = (r: AccessRequest) => `access:${r.id}`;
export const unseen = computed(
  () => notifications.value.filter((n) => !seen.value.includes(n.id)).length + accessRequests.value.filter((r) => !seen.value.includes(accessId(r))).length,
);
export const attacks = computed(() => notifications.value.filter((n) => n.kind === 'attack').length);

export async function loadNotifications(uni: string) {
  ticker ??= setInterval(() => (notifyClock.value = nowSec()), 1000);
  try {
    list.value = await uniApi<ApiResponse<'/api/{uni}/notifications'>>(uni, '/notifications');
  } catch {
    /* kept until the next reload */
  }
  await loadAccessRequests();
}

/** Global and alliance admins: the requests waiting for an assignment. */
export async function loadAccessRequests() {
  if (!session.me?.user?.isAdmin && !session.me?.groups.some((g) => g.role === 'admin')) return;
  try {
    accessRequests.value = (await api<AccessRequests>('/admin/access-requests')).requests;
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
