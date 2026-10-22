-- Discussion threads of an alliance on a player or on a planet/moon (exactly one of the two).
-- Deleted comments keep their row (deleted_at) and are no longer listed.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  g INTEGER,
  s INTEGER,
  p INTEGER,
  planet_type TEXT CHECK (planet_type IN ('planet', 'moon')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  edited_at INTEGER,
  deleted_at INTEGER,
  CHECK ((player_id IS NOT NULL) <> (g IS NOT NULL AND s IS NOT NULL AND p IS NOT NULL AND planet_type IS NOT NULL))
);
CREATE INDEX comments_player ON comments (player_id);
CREATE INDEX comments_planet ON comments (group_id, g, s, p, planet_type);
