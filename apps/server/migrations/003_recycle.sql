-- Recycling reports (transport messages): collected debris per user.
CREATE TABLE recycle_reports (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  msg_id INTEGER,
  time INTEGER,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  metal INTEGER NOT NULL,
  crystal INTEGER NOT NULL,
  total_metal INTEGER NOT NULL,
  total_crystal INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id, dedupe_key)
);
CREATE INDEX recycle_reports_time ON recycle_reports (group_id, time);
