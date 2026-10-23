-- Raid planner: own attacks of one or more members landing on one target at one time (one fleet = solo attack,
-- several = ACS). Launch times, lead and delays are computed (@pr0hub/flight planAttack), not stored.
CREATE TABLE attack_plans (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- creator; edits the plan together with the group admins
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  planet_type TEXT NOT NULL CHECK (planet_type IN ('planet', 'moon')),
  target_time INTEGER NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'launched', 'done', 'cancelled')),
  -- the "attack" claim of the target made for this plan
  claim_id INTEGER REFERENCES target_claims(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX attack_plans_group ON attack_plans (group_id, target_time);

-- Fleets of a plan, one row per fleet (a member may send several).
CREATE TABLE attack_plan_fleets (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES attack_plans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- start planet/moon; NULL while only invited
  g INTEGER,
  s INTEGER,
  p INTEGER,
  planet_type TEXT CHECK (planet_type IN ('planet', 'moon')),
  -- element id -> amount (JSON)
  ships TEXT NOT NULL DEFAULT '{}',
  speed INTEGER NOT NULL DEFAULT 100 CHECK (speed BETWEEN 10 AND 100 AND speed % 10 = 0),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('invited', 'ready', 'launched', 'withdrawn')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX attack_plan_fleets_plan ON attack_plan_fleets (plan_id);
