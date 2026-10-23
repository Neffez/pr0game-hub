-- Attack plans against a player whose coordinates may follow later, and with a rough target time first
-- (a day, around an hour) until the exact impact is known. SQLite cannot drop NOT NULL: rebuild attack_plans
-- (foreign keys are off during migrations; attack_plan_fleets keeps referring to the table by name).
CREATE TABLE attack_plans_new (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- target player when known (else from the galaxy data of the coordinates)
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  -- target coordinates, NULL until known
  g INTEGER,
  s INTEGER,
  p INTEGER,
  planet_type TEXT NOT NULL DEFAULT 'planet' CHECK (planet_type IN ('planet', 'moon')),
  target_time INTEGER NOT NULL,
  -- day: only the date counts (target_time = start of the day), hour: around that time, exact: to the second
  time_precision TEXT NOT NULL DEFAULT 'exact' CHECK (time_precision IN ('day', 'hour', 'exact')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'launched', 'done', 'cancelled')),
  claim_id INTEGER REFERENCES target_claims(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (player_id IS NOT NULL OR g IS NOT NULL)
);
INSERT INTO attack_plans_new (id, group_id, user_id, g, s, p, planet_type, target_time, note, status, claim_id, created_at, updated_at)
  SELECT id, group_id, user_id, g, s, p, planet_type, target_time, note, status, claim_id, created_at, updated_at FROM attack_plans;
DROP TABLE attack_plans;
ALTER TABLE attack_plans_new RENAME TO attack_plans;
CREATE INDEX attack_plans_group ON attack_plans (group_id, target_time);
