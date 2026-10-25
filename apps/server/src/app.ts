import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { bootstrapAdmin, HttpError, loadRequestUser } from './auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { openapiRoutes } from './routes/openapi.js';
import { config } from './config.js';
import type { DB } from './db.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { claimsRoutes } from './routes/claims.js';
import { plansRoutes } from './routes/plans.js';
import { settlementRoutes } from './routes/settlements.js';
import { commentsRoutes } from './routes/comments.js';
import { notificationRoutes } from './routes/notifications.js';
import { discordRoutes } from './routes/discord.js';
import { pushRoutes } from './routes/push.js';
import { events } from './events.js';
import { PushService, type PushOptions } from './push.js';
import { DiscordService, type DiscordOptions } from './discord.js';
import { deckRoutes } from './routes/deck.js';
import { eventRoutes } from './routes/events.js';
import { galaxyRoutes } from './routes/galaxy.js';
import { buildingsRoutes } from './routes/buildings.js';
import { imperiumRoutes } from './routes/imperium.js';
import { ingestRoutes } from './routes/ingest.js';
import { messageRoutes } from './routes/messages.js';
import { overviewRoutes } from './routes/overview.js';
import { playersRoutes } from './routes/players.js';
import { reportsRoutes } from './routes/reports.js';
import { spyRoutes } from './routes/spy.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** web push of the notifications (main.ts starts its launch reminders) */
    push: PushService;
    /** Discord webhooks of users and groups (main.ts starts its launch reminders) */
    discord: DiscordService;
  }
}

export function buildApp(db: DB, opts: { logger?: boolean; push?: PushOptions; discord?: DiscordOptions } = {}): FastifyInstance {
  const app = Fastify({
    bodyLimit: config.bodyLimit,
    // a hop count as function: Fastify's types only take booleans, addresses and functions
    trustProxy: typeof config.trustProxy === 'number' ? hopsTrusted(config.trustProxy) : config.trustProxy,
    logger:
      opts.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            serializers: {
              req: (req) => ({ method: req.method, url: req.url }),
            },
          },
  });

  app.register(fastifyCookie);
  const push = new PushService(db, events, { log: app.log, ...opts.push });
  app.decorate('push', push);
  const discord = new DiscordService(db, events, { log: app.log, ...opts.discord });
  app.decorate('discord', discord);
  const stopListening = [push.listen(), discord.listen()];
  app.addHook('onClose', async () => {
    for (const stop of stopListening) stop();
    push.close();
    discord.close();
  });
  app.decorateRequest('user', null);
  app.decorateRequest('authSource', null);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal error', code: 'internal' });
  });

  app.register(
    async (scope) => {
      // only API requests need the session (not the static files)
      scope.addHook('onRequest', async (req) => {
        const auth = loadRequestUser(db, req);
        req.user = auth.user;
        req.authSource = auth.authSource;
      });
      scope.addHook('preHandler', async (req) => {
        const m = req.method;
        if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
        if (crossOrigin(req)) throw new HttpError(403, 'cross_origin', 'Cross-origin requests are not allowed');
        if (req.authSource === 'token') throw new HttpError(403, 'read_only_token', 'API tokens are read-only');
      });
      scope.get('/api/health', async () => ({ ok: true }));
      openapiRoutes(scope);
      catalogRoutes(scope);
      authRoutes(scope, db);
      adminRoutes(scope, db);
      ingestRoutes(scope, db);
      eventRoutes(scope, db);
      claimsRoutes(scope, db);
      plansRoutes(scope, db);
      settlementRoutes(scope, db);
      commentsRoutes(scope, db);
      notificationRoutes(scope, db);
      pushRoutes(scope, db, push);
      discordRoutes(scope, db, discord);
      for (const routes of [overviewRoutes, playersRoutes, spyRoutes, galaxyRoutes, reportsRoutes, deckRoutes, imperiumRoutes, buildingsRoutes, messageRoutes]) routes(scope, db);
    },
    { prefix: config.basePath },
  );

  // Registered at the root so reply.sendFile is also available in the not-found handler.
  if (existsSync(config.webDir)) {
    app.register(fastifyStatic, {
      root: config.webDir,
      prefix: config.basePath + '/',
      wildcard: false,
      index: ['index.html'],
      // Hashed assets may be cached forever; files with fixed names (index.html, the service worker, the manifest,
      // icons) must be revalidated after a deploy. Without `cacheControl: false` the plugin overwrites the header.
      cacheControl: false,
      setHeaders: (res, filePath) => {
        res.header('Cache-Control', relative(config.webDir, filePath).startsWith('assets' + sep) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  // SPA fallback: unknown non-API paths below the base path get index.html.
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0];
    // Missing files (e.g. old asset hashes) must 404 - serving index.html as JS breaks lazy route loading.
    const isFile = /\.[a-z0-9]+$/i.test(path);
    if (req.method === 'GET' && path.startsWith(config.basePath + '/') && !path.startsWith(config.basePath + '/api/') && !isFile && existsSync(config.webDir)) {
      return reply.header('Cache-Control', 'no-cache').type('text/html').sendFile('index.html', config.webDir);
    }
    if (req.method === 'GET' && path === config.basePath) return reply.redirect(config.basePath + '/');
    return reply.code(404).send({ error: 'Not Found' });
  });

  app.addHook('onReady', async () => bootstrapAdmin(db, app.log));
  return app;
}

/** Trusts the nearest `hops` proxies, like proxy-addr's hop count. */
const hopsTrusted = (hops: number) => (_address: string, hop: number) => hop < hops;

/**
 * Browsers send `Origin` with every write: one from another site (the session cookie is also sent from sibling
 * subdomains) is refused. Clients without the header (scripts, tests) are not browsers and carry no cookie of a victim.
 */
function crossOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}
