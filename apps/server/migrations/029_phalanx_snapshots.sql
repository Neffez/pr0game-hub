-- Phalanx results pasted into the raid planner: the fleet movements at the scanned planet (attacks on it, and the
-- scanned player's own attacks from it with their return). A source of hostile attacks next to the members'
-- overviews; kept for a day.
CREATE TABLE phalanx_snapshots (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- member who pasted it
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  page_time INTEGER NOT NULL,
  -- fleets with their arrival (unix seconds), like fleet_snapshots
  data TEXT NOT NULL
);
CREATE INDEX phalanx_snapshots_group ON phalanx_snapshots (group_id, page_time);
