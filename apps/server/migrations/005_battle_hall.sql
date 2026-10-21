-- Battle Hall archive: every report seen in the game's hall of fame (which only lists the top 100).
CREATE TABLE battle_hall (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  report_id TEXT NOT NULL,
  time INTEGER,
  attackers TEXT NOT NULL,
  defenders TEXT NOT NULL,
  winner TEXT,
  units INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, report_id)
);
CREATE INDEX battle_hall_units ON battle_hall (group_id, units);
CREATE INDEX battle_hall_time ON battle_hall (group_id, time);
