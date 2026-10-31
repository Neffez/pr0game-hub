-- Messages the loot settlement takes beyond battles, each kept per member who synced it.
-- Transports: a fleet delivered resources between planets (`side` own: the sender's copy, foreign: the receiver's copy
-- of a peaceful fleet); they tick off the deliveries of a finalized settlement.
CREATE TABLE transports (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  msg_id INTEGER,
  time INTEGER,
  side TEXT NOT NULL CHECK (side IN ('own', 'foreign')),
  from_g INTEGER NOT NULL,
  from_s INTEGER NOT NULL,
  from_p INTEGER NOT NULL,
  to_g INTEGER NOT NULL,
  to_s INTEGER NOT NULL,
  to_p INTEGER NOT NULL,
  to_type TEXT CHECK (to_type IN ('planet', 'moon')),
  metal INTEGER NOT NULL,
  crystal INTEGER NOT NULL,
  deuterium INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id, dedupe_key)
);
CREATE INDEX transports_time ON transports (group_id, time);

-- Interplanetary missile impacts (the sender's copy names the planet they were fired from): the missiles of a settlement.
CREATE TABLE missile_impacts (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  msg_id INTEGER,
  time INTEGER,
  count INTEGER NOT NULL,
  from_g INTEGER NOT NULL,
  from_s INTEGER NOT NULL,
  from_p INTEGER NOT NULL,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id, dedupe_key)
);
CREATE INDEX missile_impacts_target ON missile_impacts (group_id, g, s, p, time);

-- Recyclers coming home (their home planet and cargo): with the recycling report, the recyclers' flight distance.
CREATE TABLE recycle_returns (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  msg_id INTEGER,
  time INTEGER,
  home_g INTEGER NOT NULL,
  home_s INTEGER NOT NULL,
  home_p INTEGER NOT NULL,
  metal INTEGER NOT NULL,
  crystal INTEGER NOT NULL,
  deuterium INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id, dedupe_key)
);
CREATE INDEX recycle_returns_user ON recycle_returns (group_id, user_id, time);
