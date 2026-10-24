-- Notifications for the arrival of one of the user's own fleet movements (overview), optionally `lead` minutes before.
-- Fleets have no id in the game: `data` holds the movement as last seen (JSON StoredFleet), matched again against
-- each newer fleet list by mission, phase, start, target and an arrival within a few seconds.
CREATE TABLE fleet_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  arrival INTEGER NOT NULL,
  -- minutes before the arrival
  lead INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX fleet_alerts_user ON fleet_alerts (group_id, user_id);
