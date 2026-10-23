import type { FastifyInstance } from 'fastify';
import { HttpError, requireUser } from '../auth.js';
import { now, type DB } from '../db.js';
import { parsePushPrefs, pushPrefs, testPayload, type PushService } from '../push.js';

/** Subscriptions per user (browsers and phones); the oldest goes when a new one comes beyond this. */
const MAX_SUBSCRIPTIONS = 10;

interface SubscriptionBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

const endpointOf = (v: unknown) => {
  const endpoint = String(v ?? '');
  if (!/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 1000) throw new HttpError(400, 'push_endpoint_invalid', 'Invalid push endpoint');
  return endpoint;
};

export function pushRoutes(app: FastifyInstance, db: DB, push: PushService) {
  /** Whether push is configured on this hub, and the key the browser subscribes with. */
  app.get('/api/push/key', async (req) => {
    requireUser(req);
    return { enabled: push.enabled, publicKey: push.publicKey };
  });

  /** Registers this browser for the user; a browser registered by another user before moves to this one. */
  app.post<{ Body: SubscriptionBody }>('/api/push/subscriptions', async (req) => {
    const user = requireUser(req);
    if (!push.enabled) throw new HttpError(409, 'push_disabled', 'Push notifications are not configured on this hub');
    const endpoint = endpointOf(req.body?.endpoint);
    const p256dh = String(req.body?.keys?.p256dh ?? '');
    const auth = String(req.body?.keys?.auth ?? '');
    if (!/^[\w-]{20,200}$/.test(p256dh) || !/^[\w-]{8,100}$/.test(auth)) throw new HttpError(400, 'push_keys_invalid', 'Invalid subscription keys');
    const agent = String(req.headers['user-agent'] ?? '').slice(0, 300) || null;
    db.transaction(() => {
      db.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
           user_agent = excluded.user_agent, created_at = excluded.created_at`,
      ).run(user.id, endpoint, p256dh, auth, agent, now());
      db.prepare(
        `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN
           (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ${MAX_SUBSCRIPTIONS})`,
      ).run(user.id, user.id);
    })();
    return { ok: true };
  });

  /** Unregisters a browser of the user (switched off, or before logging out). */
  app.delete<{ Body: SubscriptionBody }>('/api/push/subscriptions', async (req) => {
    const user = requireUser(req);
    const endpoint = endpointOf(req.body?.endpoint);
    const res = db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(user.id, endpoint);
    return { ok: true, removed: res.changes };
  });

  /** A test notification to all of the user's devices. */
  app.post('/api/push/test', async (req) => {
    const user = requireUser(req);
    if (!push.enabled) throw new HttpError(409, 'push_disabled', 'Push notifications are not configured on this hub');
    return { devices: await push.sendTo(user.id, testPayload(user.lang === 'en' ? 'en' : 'de')) };
  });

  /** Which notifications the user wants pushed (all of their devices). */
  app.get('/api/auth/push-settings', async (req) => pushPrefs(db, requireUser(req).id));

  app.post<{ Body: Record<string, unknown> }>('/api/auth/push-settings', async (req) => {
    const user = requireUser(req);
    const prefs = parsePushPrefs(pushPrefs(db, user.id), req.body ?? {});
    if (!prefs) throw new HttpError(400, 'push_settings_invalid', 'Invalid push settings');
    db.prepare('UPDATE users SET push_prefs = ? WHERE id = ?').run(JSON.stringify(prefs), user.id);
    return prefs;
  });
}
