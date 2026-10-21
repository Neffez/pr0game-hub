-- Honor points ranking (stat type 6), honor titles and alliance member counts.
-- SQLite cannot change a CHECK constraint: rebuild stat_snapshots (foreign keys are off during migrations).
CREATE TABLE stat_snapshots_new (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  who TEXT NOT NULL CHECK (who IN ('player', 'alliance')),
  type INTEGER NOT NULL CHECK (type BETWEEN 1 AND 6),
  stat_time INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, who, type, stat_time)
);
INSERT INTO stat_snapshots_new (id, group_id, who, type, stat_time, created_at)
  SELECT id, group_id, who, type, stat_time, created_at FROM stat_snapshots;
DROP TABLE stat_snapshots;
ALTER TABLE stat_snapshots_new RENAME TO stat_snapshots;
CREATE INDEX stat_snapshots_time ON stat_snapshots (group_id, who, type, stat_time);

ALTER TABLE player_scores ADD COLUMN title TEXT;
ALTER TABLE alliance_scores ADD COLUMN members INTEGER;
