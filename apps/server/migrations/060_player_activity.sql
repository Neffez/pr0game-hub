-- Evidence of when a player was online that is otherwise lost or entered by hand: activity marks of the galaxy view,
-- launches and recalls of hostile fleets, manual reports of members. `time` is the best estimate, `spread` the half
-- width of its uncertainty in seconds. Shown as the player's activity pattern together with the stored reports.
CREATE TABLE player_activity (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  time INTEGER NOT NULL,
  spread INTEGER NOT NULL DEFAULT 0,
  -- galaxy | fleet | recall | manual
  source TEXT NOT NULL,
  g INTEGER,
  s INTEGER,
  p INTEGER,
  planet_type TEXT,
  -- member who reported it (manual)
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, dedupe_key)
);
CREATE INDEX player_activity_player ON player_activity (player_id, time);
