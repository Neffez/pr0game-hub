-- Fleet movements of the game overview ("Ereignisse"), also pasted on their own; only the newest per member is kept.
CREATE TABLE fleet_snapshots (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_time INTEGER NOT NULL,
  -- fleets with their arrival (unix seconds)
  data TEXT NOT NULL
);
CREATE INDEX fleet_snapshots_user ON fleet_snapshots (group_id, user_id, page_time);
