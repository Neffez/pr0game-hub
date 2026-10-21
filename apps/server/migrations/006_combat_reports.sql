-- Archived battle reports (the game deletes small ones after a while). Compact: fleets as JSON arrays.
CREATE TABLE combat_reports (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  report_id TEXT NOT NULL,
  time INTEGER,
  winner TEXT NOT NULL,
  rounds INTEGER NOT NULL,
  lost_attacker INTEGER NOT NULL,
  lost_defender INTEGER NOT NULL,
  debris_metal INTEGER NOT NULL,
  debris_crystal INTEGER NOT NULL,
  -- [[side 0=attacker/1=defender, name, [[elementId, before, after], …]], …]
  fleets TEXT NOT NULL,
  PRIMARY KEY (group_id, report_id)
) WITHOUT ROWID;

-- crawler state per battle hall entry
ALTER TABLE battle_hall ADD COLUMN report_status TEXT;
ALTER TABLE battle_hall ADD COLUMN report_tries INTEGER NOT NULL DEFAULT 0;
