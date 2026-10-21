-- Game overview page: build/research/shipyard queues with remaining time (Imperium live view).
CREATE TABLE overview_snapshots (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- server time of the page; queue end = page_time + seconds
  page_time INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX overview_snapshots_user ON overview_snapshots (group_id, user_id, page_time);
