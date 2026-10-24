-- Game buildings page of one planet/moon (levels, cost and build time of the next level, resource bar); the newest
-- per planet is kept. Notifications for when the next level of a building is affordable (one per building and level).
CREATE TABLE building_snapshots (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  planet_type TEXT NOT NULL,
  page_time INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX building_snapshots_user ON building_snapshots (group_id, user_id, page_time);

CREATE TABLE building_alerts (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  planet_type TEXT NOT NULL,
  element_id INTEGER NOT NULL,
  -- the level to be notified about
  level INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id, g, s, p, planet_type, element_id)
);
