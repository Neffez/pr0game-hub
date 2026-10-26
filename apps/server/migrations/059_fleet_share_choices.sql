-- Per fleet choice of its member whether the movement is shared (1) or not (0), ahead of their account setting
-- (`users.fleet_share`), like `player_messages.share`. Fleets have no id in the game: `data` holds the movement as
-- chosen (JSON StoredFleet), matched against the fleet lists by mission, phase, start, target and arrival.
CREATE TABLE fleet_share_choices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  arrival INTEGER NOT NULL,
  share INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX fleet_share_choices_user ON fleet_share_choices (group_id, user_id);
