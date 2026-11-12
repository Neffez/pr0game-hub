-- Units ranking (stat type 7).
-- SQLite cannot change a CHECK constraint: rebuild stat_snapshots (foreign keys are off during migrations).
DROP TRIGGER IF EXISTS player_scores_lookup;
CREATE TABLE stat_snapshots_new (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  who TEXT NOT NULL CHECK (who IN ('player', 'alliance')),
  type INTEGER NOT NULL CHECK (type BETWEEN 1 AND 7),
  stat_time INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, who, type, stat_time)
);
INSERT INTO stat_snapshots_new (id, group_id, who, type, stat_time, created_at)
  SELECT id, group_id, who, type, stat_time, created_at FROM stat_snapshots;
DROP TABLE stat_snapshots;
ALTER TABLE stat_snapshots_new RENAME TO stat_snapshots;
CREATE INDEX stat_snapshots_time ON stat_snapshots (group_id, who, type, stat_time);
CREATE TRIGGER player_scores_lookup AFTER INSERT ON player_scores WHEN NEW.stat_time IS NULL BEGIN
  UPDATE player_scores SET (type, stat_time) = (SELECT type, stat_time FROM stat_snapshots WHERE id = NEW.snapshot_id)
  WHERE rowid = NEW.rowid;
END;
