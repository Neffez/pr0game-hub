-- Hourly operating figures for the admin page (monitor.ts): database size and free pages, WAL, memory, event loop
-- delay (ms) and requests of the hour; kept 90 days.
CREATE TABLE system_samples (
  time INTEGER PRIMARY KEY,
  db_bytes INTEGER NOT NULL,
  free_bytes INTEGER NOT NULL,
  wal_bytes INTEGER NOT NULL,
  rss INTEGER NOT NULL,
  heap_used INTEGER NOT NULL,
  loop_p99 REAL,
  loop_max REAL,
  requests INTEGER NOT NULL,
  slow INTEGER NOT NULL
);
