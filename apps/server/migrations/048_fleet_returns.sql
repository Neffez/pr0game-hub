-- Fleet return messages of attacks: what one fleet of a member carries home from the target (its loot, plus what it
-- carried on the way out). The loot settlement takes them as the loot of the participants' fleets.
CREATE TABLE fleet_returns (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  msg_id INTEGER,
  time INTEGER,
  -- the attacked planet or moon (the message does not tell which)
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  home_g INTEGER NOT NULL,
  home_s INTEGER NOT NULL,
  home_p INTEGER NOT NULL,
  metal INTEGER NOT NULL,
  crystal INTEGER NOT NULL,
  deuterium INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id, dedupe_key)
);
CREATE INDEX fleet_returns_target ON fleet_returns (group_id, g, s, p, time);
