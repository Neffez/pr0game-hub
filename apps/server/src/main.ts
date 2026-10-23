import { join } from 'node:path';
import { buildApp } from './app.js';
import { config } from './config.js';
import { startCrawler } from './crawler.js';
import { openDb } from './db.js';

const db = openDb(join(config.dataDir, 'hub.db'));
const app = buildApp(db);

const stopCrawler = startCrawler(db, app.log);
const stopReminders = app.push.start();

const shutdown = async () => {
  stopCrawler();
  stopReminders();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
