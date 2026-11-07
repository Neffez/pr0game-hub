-- Debris fields can be claimed for recycling (debris finder): target type 'debris' next to planet and moon, kind
-- 'recycle'. A debris claim and a farm claim on the planet at the same position don't block each other. The CHECKs
-- cannot be changed in place, so the table is rebuilt (ids kept: raid plans reference them).
CREATE TABLE target_claims_new (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  planet_type TEXT NOT NULL CHECK (planet_type IN ('planet', 'moon', 'debris')),
  kind TEXT NOT NULL CHECK (kind IN ('farm', 'attack', 'spy', 'recycle')),
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  released_at INTEGER
);
INSERT INTO target_claims_new (id, group_id, user_id, g, s, p, planet_type, kind, note, created_at, expires_at, released_at)
  SELECT id, group_id, user_id, g, s, p, planet_type, kind, note, created_at, expires_at, released_at FROM target_claims;
DROP TABLE target_claims;
ALTER TABLE target_claims_new RENAME TO target_claims;
CREATE INDEX target_claims_target ON target_claims (group_id, g, s, p, planet_type, expires_at);
CREATE UNIQUE INDEX target_claims_unreleased ON target_claims (group_id, g, s, p, planet_type) WHERE released_at IS NULL;
