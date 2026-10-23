import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { bootstrapAdmin, HttpError, loadSessionUser } from './auth.js';
import { config } from './config.js';
import type { DB } from './db.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { claimsRoutes } from './routes/claims.js';
import { plansRoutes } from './routes/plans.js';
import { commentsRoutes } from './routes/comments.js';
import { notificationRoutes } from './routes/notifications.js';
import { deckRoutes } from './routes/deck.js';
import { eventRoutes } from './routes/events.js';
import { galaxyRoutes } from './routes/galaxy.js';
import { imperiumRoutes } from './routes/imperium.js';
import { ingestRoutes } from './routes/ingest.js';
import { messageRoutes } from './routes/messages.js';
import { overviewRoutes } from './routes/overview.js';
import { playersRoutes } from './routes/players.js';
import { reportsRoutes } from './routes/reports.js';
import { spyRoutes } from './routes/spy.js';

export function buildApp(db: DB, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    bodyLimit: config.bodyLimit,
    trustProxy: true,
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
  app.decorateRequest('user', null);

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
        req.user = loadSessionUser(db, req);
      });
      scope.get('/api/health', async () => ({ ok: true }));
      authRoutes(scope, db);
      adminRoutes(scope, db);
      ingestRoutes(scope, db);
      eventRoutes(scope, db);
      claimsRoutes(scope, db);
      plansRoutes(scope, db);
      commentsRoutes(scope, db);
      notificationRoutes(scope, db);
      for (const routes of [overviewRoutes, playersRoutes, spyRoutes, galaxyRoutes, reportsRoutes, deckRoutes, imperiumRoutes, messageRoutes]) routes(scope, db);
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
      // Hashed assets may be cached forever, index.html must always be revalidated after a deploy.
      setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
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
