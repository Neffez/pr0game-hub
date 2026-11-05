-- Access requests: usernames are unique regardless of case, like users.username (keeps the oldest of a clash).
CREATE TABLE access_requests_new (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'de',
  message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
INSERT INTO access_requests_new (id, username, password_hash, lang, message, created_at)
  SELECT id, username, password_hash, lang, message, created_at FROM access_requests a
  WHERE NOT EXISTS (SELECT 1 FROM access_requests b WHERE b.username = a.username COLLATE NOCASE AND b.id < a.id);
DROP TABLE access_requests;
ALTER TABLE access_requests_new RENAME TO access_requests;

-- Target claims: at most one unreleased claim per target. An older unreleased claim of a target that has a newer
-- one is closed at its expiry (it could no longer be active anyway: a new claim releases an active one).
UPDATE target_claims SET released_at = MIN(expires_at, unixepoch())
  WHERE released_at IS NULL AND EXISTS (
    SELECT 1 FROM target_claims n
    WHERE n.group_id = target_claims.group_id AND n.g = target_claims.g AND n.s = target_claims.s AND n.p = target_claims.p
      AND n.planet_type = target_claims.planet_type AND n.released_at IS NULL AND n.id > target_claims.id
  );
CREATE UNIQUE INDEX target_claims_unreleased ON target_claims (group_id, g, s, p, planet_type) WHERE released_at IS NULL;
