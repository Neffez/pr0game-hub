-- Game research page of one planet (account wide research levels and queue, cost and time of the next levels on that
-- planet, its resource bar); the newest per planet is kept.
CREATE TABLE research_snapshots (
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
CREATE INDEX research_snapshots_user ON research_snapshots (group_id, user_id, page_time);
