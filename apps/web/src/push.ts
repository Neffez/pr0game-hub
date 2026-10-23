import { ref } from 'vue';
import { api, session } from './api';

/**
 * Web push of this browser (server: push.ts, worker: public/sw.js). The browser asks for permission only when the
 * user switches it on here; nothing subscribes by itself. A subscription belongs to the user who switched it on: it is
 * removed before logging out, and dropped when someone else logs in to this browser.
 */
export type PushStatus = 'loading' | 'unsupported' | 'disabled' | 'denied' | 'off' | 'on';

export const pushStatus = ref<PushStatus>('loading');

const BASE = import.meta.env.BASE_URL;
const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Registers the service worker (no caching, only push); harmless without push. */
export function registerWorker() {
  if (!supported()) return;
  navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).catch(() => {
    /* e.g. insecure origin in development */
  });
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration(BASE)) ?? navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE });
}

let key: string | null = null;

/** Which user this browser's subscription belongs to (per browser). */
const OWNER = 'hub.push.user';
function setOwner(userId: number | null) {
  try {
    if (userId == null) localStorage.removeItem(OWNER);
    else localStorage.setItem(OWNER, String(userId));
  } catch {
    /* storage unavailable */
  }
}
function owner() {
  try {
    return localStorage.getItem(OWNER);
  } catch {
    return null;
  }
}

/**
 * After login: a subscription of this browser made by another user (who did not log out here, e.g. the session ran
 * out) is dropped; this user did not switch push on. The push service then rejects it and the hub forgets it.
 */
export async function checkPushOwner(userId: number) {
  if (!supported()) return;
  const sub = await (await navigator.serviceWorker.getRegistration(BASE))?.pushManager.getSubscription();
  if (!sub || owner() === String(userId)) return;
  await sub.unsubscribe();
  setOwner(null);
}

/** Current state of this browser: supported, configured on the server, allowed, subscribed. */
export async function loadPushStatus() {
  if (!supported()) return (pushStatus.value = 'unsupported');
  try {
    const res = await api<{ enabled: boolean; publicKey: string | null }>('/push/key');
    key = res.publicKey;
    if (!res.enabled || !key) return (pushStatus.value = 'disabled');
    if (Notification.permission === 'denied') return (pushStatus.value = 'denied');
    if (session.me?.user) await checkPushOwner(session.me.user.id);
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      // re-registers the browser (the hub may have dropped it, e.g. after an error of the push service)
      await api('/push/subscriptions', { body: sub.toJSON() });
      return (pushStatus.value = 'on');
    }
    return (pushStatus.value = 'off');
  } catch {
    return (pushStatus.value = 'unsupported');
  }
}

const keyBytes = (base64url: string) => {
  const raw = atob((base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Asks for permission (call from a click only) and subscribes this browser. */
export async function enablePush() {
  if (!key) await loadPushStatus();
  if (!key) return pushStatus.value;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return (pushStatus.value = permission === 'denied' ? 'denied' : 'off');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api('/push/subscriptions', { body: sub.toJSON() });
  setOwner(session.me?.user?.id ?? null);
  return (pushStatus.value = 'on');
}

/** Unsubscribes this browser (also before logging out). */
export async function disablePush() {
  if (!supported()) return;
  const sub = await (await navigator.serviceWorker.getRegistration(BASE))?.pushManager.getSubscription();
  if (!sub) return;
  try {
    await api('/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  } finally {
    await sub.unsubscribe();
    setOwner(null);
    if (pushStatus.value === 'on') pushStatus.value = 'off';
  }
}

/** Test notification to all devices of the user; returns how many were reached. */
export const testPush = () => api<{ devices: number }>('/push/test', { body: {} }).then((r) => r.devices);
