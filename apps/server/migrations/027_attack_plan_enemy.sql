-- Retime: the hostile fleet an attack plan answers. Its return home (per speed candidate, @pr0hub/flight
-- retimeCandidates) plus a buffer gives the plan's target time; the inputs are shared by all participants.
CREATE TABLE attack_plan_enemy (
  plan_id INTEGER PRIMARY KEY REFERENCES attack_plans(id) ON DELETE CASCADE,
  -- member the fleet headed for (whose overview showed it)
  member_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  from_g INTEGER NOT NULL,
  from_s INTEGER NOT NULL,
  from_p INTEGER NOT NULL,
  from_type TEXT NOT NULL CHECK (from_type IN ('planet', 'moon')),
  to_g INTEGER NOT NULL,
  to_s INTEGER NOT NULL,
  to_p INTEGER NOT NULL,
  to_type TEXT NOT NULL CHECK (to_type IN ('planet', 'moon')),
  -- fleets of the hostile event, the lead first (one for a single attack): [{"mission": 1, "ships": {"207": 5}}]
  fleets TEXT NOT NULL,
  -- index in fleets whose return the plan follows
  follow INTEGER NOT NULL DEFAULT 0,
  -- arrival as last seen, and as first seen (a later arrival means the ACS was delayed)
  arrival INTEGER NOT NULL,
  first_seen INTEGER NOT NULL,
  -- owner's drive research {"115": 10, "117": 8, "118": 6}, where it came from and how old it is
  drives TEXT NOT NULL DEFAULT '{}',
  drives_source TEXT CHECK (drives_source IN ('spy', 'manual')),
  drives_time INTEGER,
  departure_from INTEGER,
  departure_to INTEGER,
  recall_from INTEGER,
  recall_to INTEGER,
  -- recall of the ACS lead (all fleets come back with the lead) or of the followed fleet alone
  recall_lead INTEGER NOT NULL DEFAULT 1,
  -- chosen speed candidate (10-100), NULL while open
  percent INTEGER CHECK (percent IS NULL OR (percent BETWEEN 10 AND 100 AND percent % 10 = 0)),
  -- seconds after the return the own fleets shall land
  buffer INTEGER NOT NULL DEFAULT 5,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
