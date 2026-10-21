-- Activity log: noteworthy changes detected while syncing (new phalanx, new planet, point loss, ...).
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- when it happened in the game (report/stat/galaxy time)
  time INTEGER NOT NULL,
  kind TEXT NOT NULL,
  g INTEGER,
  s INTEGER,
  p INTEGER,
  planet_type TEXT,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  data TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, dedupe_key)
);
CREATE INDEX activity_log_time ON activity_log (group_id, time);
