-- Comments on the loot settlement of a raid plan: a third thread target next to a player and a planet/moon (exactly
-- one of the three). The CHECK cannot be changed in place, so the table is rebuilt.
CREATE TABLE comments_new (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  g INTEGER,
  s INTEGER,
  p INTEGER,
  planet_type TEXT CHECK (planet_type IN ('planet', 'moon')),
  plan_id INTEGER REFERENCES attack_plans(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  edited_at INTEGER,
  deleted_at INTEGER,
  CHECK ((player_id IS NOT NULL) + (g IS NOT NULL AND s IS NOT NULL AND p IS NOT NULL AND planet_type IS NOT NULL) + (plan_id IS NOT NULL) = 1)
);
INSERT INTO comments_new (id, group_id, user_id, player_id, g, s, p, planet_type, body, created_at, edited_at, deleted_at)
  SELECT id, group_id, user_id, player_id, g, s, p, planet_type, body, created_at, edited_at, deleted_at FROM comments;
DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;
CREATE INDEX comments_player ON comments (player_id);
CREATE INDEX comments_planet ON comments (group_id, g, s, p, planet_type);
CREATE INDEX comments_plan ON comments (plan_id);
