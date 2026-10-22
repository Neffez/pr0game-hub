-- Targets a member claimed for a while (farming, attack, espionage), so the others leave them alone.
-- Active while released_at is NULL and expires_at lies in the future.
CREATE TABLE target_claims (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  planet_type TEXT NOT NULL CHECK (planet_type IN ('planet', 'moon')),
  kind TEXT NOT NULL CHECK (kind IN ('farm', 'attack', 'spy')),
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  released_at INTEGER
);
CREATE INDEX target_claims_target ON target_claims (group_id, g, s, p, planet_type, expires_at);
