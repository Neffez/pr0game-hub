-- Game shipyard page of one planet, one row per list (`mode`: fleet = ships, defense = defense and missiles): the unit
-- counts of that list, the planet's shipyard queue and its resource bar; the newest per planet and list is kept.
CREATE TABLE shipyard_snapshots (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  planet_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  page_time INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX shipyard_snapshots_user ON shipyard_snapshots (group_id, user_id, page_time);
