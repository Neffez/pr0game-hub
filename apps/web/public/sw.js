// Service worker of the pr0game Hub: shows push notifications (server: apps/server/src/push.ts) and opens the hub on a
// click. It caches nothing and handles no requests, so a deploy is never held back by it.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const scope = new URL(self.registration.scope).pathname;

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'pr0game Hub', {
      body: data.body || '',
      tag: data.tag,
      renotify: !!data.tag,
      icon: `${scope}icon-192.png`,
      badge: `${scope}icon-192.png`,
      data: { url: data.url || scope },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || scope, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const hub = tabs.find((c) => new URL(c.url).pathname.startsWith(scope));
      if (hub) {
        await hub.focus();
        return hub.navigate(url).catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    })(),
  );
});

// the push service replaced the subscription: hand the new one to the hub (the session cookie identifies the user)
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const sub =
        event.newSubscription ||
        (old && (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey })));
      if (!sub) return;
      await fetch(`${scope}api/push/subscriptions`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
    })(),
  );
});
