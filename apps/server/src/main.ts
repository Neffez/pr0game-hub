import { join } from 'node:path';
import { buildApp } from './app.js';
import { config } from './config.js';
import { startCrawler } from './crawler.js';
import { openDb } from './db.js';
import { startMonitor } from './monitor.js';

const db = openDb(join(config.dataDir, 'hub.db'));
const app = buildApp(db);

const stopCrawler = startCrawler(db, app.log);
const stopReminders = app.push.start();
const stopDiscordReminders = app.discord.start();
const stopMonitor = startMonitor(db, app.log);

const shutdown = async () => {
  stopCrawler();
  stopReminders();
  stopDiscordReminders();
  stopMonitor();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
