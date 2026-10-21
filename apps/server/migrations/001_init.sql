-- Users & tenancy ---------------------------------------------------------

CREATE TABLE universes (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- galaxies, systems, positions, distance factors, fleet speed, timezone (see config.ts UNIVERSE_DEFAULTS)
  settings TEXT NOT NULL DEFAULT '{}',
  deck_config TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE groups (
  id INTEGER PRIMARY KEY,
  universe_id INTEGER NOT NULL REFERENCES universes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (universe_id, name)
);

CREATE TABLE group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  ingame_name TEXT,
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at INTEGER
);

-- Game data (always scoped to one group) ------------------------------------

CREATE TABLE alliances (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  ingame_id INTEGER,
  name TEXT NOT NULL,
  tag TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX alliances_ingame ON alliances (group_id, ingame_id) WHERE ingame_id IS NOT NULL;
CREATE INDEX alliances_name ON alliances (group_id, name);

CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  ingame_id INTEGER,
  name TEXT NOT NULL,
  alliance_id INTEGER REFERENCES alliances(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT '[]',
  first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
  note TEXT
);
CREATE UNIQUE INDEX players_ingame ON players (group_id, ingame_id) WHERE ingame_id IS NOT NULL;
CREATE INDEX players_name ON players (group_id, name COLLATE NOCASE);

CREATE TABLE player_aliases (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  seen_until INTEGER NOT NULL,
  PRIMARY KEY (player_id, name)
);

CREATE TABLE player_status_log (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX player_status_log_player ON player_status_log (player_id, seen_at);

CREATE TABLE stat_snapshots (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  who TEXT NOT NULL CHECK (who IN ('player', 'alliance')),
  type INTEGER NOT NULL CHECK (type BETWEEN 1 AND 5),
  stat_time INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, who, type, stat_time)
);
CREATE INDEX stat_snapshots_time ON stat_snapshots (group_id, who, type, stat_time);

CREATE TABLE player_scores (
  snapshot_id INTEGER NOT NULL REFERENCES stat_snapshots(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  rank_change INTEGER,
  points INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, player_id)
);
CREATE INDEX player_scores_player ON player_scores (player_id);

CREATE TABLE alliance_scores (
  snapshot_id INTEGER NOT NULL REFERENCES stat_snapshots(id) ON DELETE CASCADE,
  alliance_id INTEGER NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  rank_change INTEGER,
  points INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, alliance_id)
);

CREATE TABLE planets (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  name TEXT,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  has_moon INTEGER NOT NULL DEFAULT 0,
  destroyed INTEGER NOT NULL DEFAULT 0,
  debris TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, g, s, p)
);
CREATE INDEX planets_player ON planets (player_id);

CREATE TABLE galaxy_views (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (group_id, g, s)
);

CREATE TABLE spy_reports (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  msg_id INTEGER,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  planet_type TEXT NOT NULL,
  planet_name TEXT,
  player_name TEXT,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  report_time INTEGER NOT NULL,
  sections TEXT NOT NULL,
  destroy_chance INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, g, s, p, planet_type, report_time)
);
CREATE INDEX spy_reports_coords ON spy_reports (group_id, g, s, p, planet_type, report_time);
CREATE INDEX spy_reports_player ON spy_reports (player_id);

CREATE TABLE battle_reports (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  msg_id INTEGER,
  report_id TEXT,
  time INTEGER,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  planet_type TEXT NOT NULL,
  outcome TEXT,
  lost_attacker INTEGER NOT NULL,
  lost_defender INTEGER NOT NULL,
  loot_metal INTEGER NOT NULL,
  loot_crystal INTEGER NOT NULL,
  loot_deuterium INTEGER NOT NULL,
  debris_metal INTEGER NOT NULL,
  debris_crystal INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id, dedupe_key)
);
CREATE INDEX battle_reports_time ON battle_reports (group_id, time);

CREATE TABLE expeditions (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  msg_id INTEGER,
  time INTEGER,
  g INTEGER,
  s INTEGER,
  p INTEGER,
  event TEXT NOT NULL,
  size TEXT NOT NULL,
  factor INTEGER,
  depletion TEXT,
  found_resources TEXT NOT NULL DEFAULT '{}',
  found_ships TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id, dedupe_key)
);
CREATE INDEX expeditions_user_time ON expeditions (group_id, user_id, time);

CREATE TABLE deck_settings (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time INTEGER,
  initial_drawn TEXT NOT NULL DEFAULT '{}',
  unknown_depletion REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE hostile_spying (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  msg_id INTEGER,
  time INTEGER,
  from_player TEXT NOT NULL,
  from_planet TEXT,
  from_g INTEGER NOT NULL,
  from_s INTEGER NOT NULL,
  from_p INTEGER NOT NULL,
  from_type TEXT NOT NULL,
  target_planet TEXT,
  target_g INTEGER NOT NULL,
  target_s INTEGER NOT NULL,
  target_p INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  UNIQUE (group_id, dedupe_key)
);
CREATE INDEX hostile_spying_time ON hostile_spying (group_id, time);

CREATE TABLE empire_snapshots (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  data TEXT NOT NULL
);
CREATE INDEX empire_snapshots_user ON empire_snapshots (group_id, user_id, created_at);

CREATE TABLE raw_ingests (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  page_type TEXT NOT NULL,
  url TEXT,
  html_gz BLOB,
  text_gz BLOB,
  summary TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX raw_ingests_group ON raw_ingests (group_id, created_at);
